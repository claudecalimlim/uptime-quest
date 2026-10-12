/*
 * DR ZONE: pick an AWS disaster recovery strategy, trigger a disaster, watch the recovery.
 * Concepts: RTO / RPO (AWS whitepaper 2021, Khoshkholghi et al. 2014), the four AWS strategies.
 * All numbers are illustrative, chosen to follow the ordering in the AWS whitepaper
 * (Backup & Restore slowest and cheapest ... Active/Active fastest and most expensive).
 */
(function () {
  var h = UQ.h, img = UQ.img;

  var ORDERS_PER_HOUR = 30; // Andy's holiday-sale order rate (illustrative)

  var STRATEGIES = [
    {
      id: "br", name: "Backup & Restore", icon: "dr_backup", cost: 1, tier: "Cold",
      rpo: 240, rto: 480,
      regionB: [{ icon: "dr_backup", label: "Backups only", cls: "" }, { icon: "ha_server_standby", label: "No servers", cls: "off" }],
      bServes: false,
      steps: ["Disaster detected", "Provision new servers in Region B", "Restore data from the last backup", "Deploy Andy's store app", "Switch DNS to Region B"],
      andy: "We're back, but the last 4 hours of orders are gone and the store was down most of the day. During the holiday sale, that hurts."
    },
    {
      id: "pl", name: "Pilot Light", icon: "dr_pilot", cost: 2, tier: "Warm",
      rpo: 10, rto: 40,
      regionB: [{ icon: "ha_database", label: "Data replicating", cls: "" }, { icon: "ha_server_standby", label: "App servers off", cls: "off" }],
      bServes: false,
      steps: ["Disaster detected", "Data already in Region B", "Start the app servers", "Scale up to full capacity", "Switch DNS to Region B"],
      andy: "Down for under an hour, and only about 10 minutes of orders lost. It's cheap to keep running, too. Not bad!"
    },
    {
      id: "ws", name: "Warm Standby", icon: "dr_warm", cost: 3, tier: "Modified Hot",
      rpo: 1, rto: 10,
      regionB: [{ icon: "ha_database", label: "Data replicating", cls: "" }, { icon: "dr_warm", label: "Small copy running", cls: "small" }],
      bServes: false,
      steps: ["Disaster detected", "Standby copy already running", "Scale up to full capacity", "Switch DNS to Region B"],
      andy: "Back in about 10 minutes with almost nothing lost. It costs more every month than Pilot Light, though."
    },
    {
      id: "aa", name: "Multi-Site Active/Active", icon: "dr_multisite", cost: 4, tier: "Hot",
      rpo: 0.05, rto: 0.5,
      regionB: [{ icon: "ha_database", label: "Data replicating", cls: "" }, { icon: "ha_server_ok", label: "Full site, live", cls: "" }, { icon: "ha_server_ok", label: "Full site, live", cls: "" }],
      bServes: true,
      steps: ["Disaster detected", "Region B already serving customers", "Send all traffic to Region B"],
      andy: "My customers didn't even notice! But I'm paying for two full sites, and my small IT team has to run both."
    }
  ];

  var DISASTERS = [
    { icon: "dr_storm", text: "A typhoon knocks out Region A's data center!" },
    { icon: "dr_power_cut", text: "Power lines are cut at Region A!" },
    { icon: "dr_breach", text: "A security breach forces Region A offline!" }
  ];

  // remembered while the page is open, so classmates can compare runs
  var history = {};

  var t = null, stage = null, keyHandler = null;
  var state, ui;

  function strat(id) { return STRATEGIES.filter(function (s) { return s.id === id; })[0]; }

  function mount(el) {
    stage = el;
    t = UQ.scope();
    state = { strategy: null, phase: "pick", orders: 1280, disasterIdx: 0 };
    ui = {};
    render();
    // the store keeps taking orders while it's online
    t.every(900, function () {
      if (state.phase !== "running") { state.orders += 1; if (ui.orders) ui.orders.textContent = state.orders.toLocaleString(); }
    });
    keyHandler = function (e) {
      if (e.target.closest && e.target.closest(".topbar")) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4 && state.phase !== "running") { pick(STRATEGIES[n - 1].id); }
      else if ((e.key === "Enter" || e.key === " ") && state.phase === "ready") { e.preventDefault(); trigger(); }
    };
    document.addEventListener("keydown", keyHandler);
  }

  function unmount() {
    if (t) t.clear();
    document.removeEventListener("keydown", keyHandler);
    stage = null;
  }

  function render() {
    stage.innerHTML = "";

    stage.appendChild(h("div", { class: "zone-intro px-box" },
      img("ha_shop"),
      h("p", { html: "Andy's servers live in <strong>Region A</strong>. If disaster hits, can <strong>Region B</strong> save the store? Every strategy trades <strong>recovery speed</strong> against <strong>monthly cost</strong>." })));

    ui.strip = h("ol", { class: "steps-strip" },
      h("li", { text: "1 · PICK A STRATEGY" }), h("li", { text: "2 · TRIGGER A DISASTER" }), h("li", { text: "3 · WATCH THE RECOVERY" }));
    stage.appendChild(ui.strip);

    // strategy cards
    ui.cards = {};
    var cards = h("div", { class: "dr-strats" });
    STRATEGIES.forEach(function (s, i) {
      var card = h("button", { class: "dr-strat", type: "button", onclick: function () { pick(s.id); } },
        h("span", { class: "strat-key", text: String(i + 1) }),
        history[s.id] ? img("ui_check", "strat-tested", "Tested") : null,
        img(s.icon, "strat-icon"),
        h("span", { class: "strat-name", text: s.name }),
        UQ.coins(s.cost, 4),
        h("span", { class: "chip dark", text: "TIER: " + s.tier.toUpperCase() }));
      ui.cards[s.id] = card;
      cards.appendChild(card);
    });
    stage.appendChild(cards);

    // arena: customers -> region A | region B
    ui.regionA = h("div", { class: "dr-region px-box" });
    ui.regionB = h("div", { class: "dr-region px-box" });
    stage.appendChild(h("div", { class: "dr-arena" },
      h("div", { class: "dr-users" }, img("ha_customer"), img("dr_dns"), h("span", { class: "lbl", text: "CUSTOMERS\n→ DNS" })),
      ui.regionA, ui.regionB));
    drawRegions();

    // store status
    ui.storeStatus = h("div", { class: "dr-store-status" });
    ui.orders = h("b", { text: state.orders.toLocaleString() });
    stage.appendChild(h("div", { class: "dr-store px-box" }, ui.storeStatus, h("span", { class: "dr-orders" }, "Orders today:", ui.orders)));
    setStore(true);

    // controls
    ui.trigger = h("button", { class: "big-btn", type: "button", disabled: true, onclick: trigger }, img("dr_alarm"), "TRIGGER DISASTER");
    ui.note = h("span", { class: "note", text: "Pick a strategy first (or press 1-4)." });
    stage.appendChild(h("div", { class: "dr-controls" }, ui.trigger, ui.note));

    ui.recovery = h("div");
    ui.result = h("div");
    ui.compare = h("div");
    stage.appendChild(ui.recovery);
    stage.appendChild(ui.result);
    stage.appendChild(ui.compare);
    drawCompare();
    updateStrip();
  }

  function drawRegions(downA) {
    var s = state.strategy ? strat(state.strategy) : null;

    ui.regionA.innerHTML = "";
    ui.regionA.classList.toggle("down", !!downA);
    ui.flowA = h("div", { class: "flow dr-region-flow " + (downA ? "dead" : "on") });
    ui.regionA.appendChild(h("div", { class: "dr-region-head" },
      h("span", { class: "dr-region-name", text: "REGION A · PRIMARY" }),
      h("span", { class: "chip " + (downA ? "coral" : "mint"), text: downA ? "DOWN" : "ONLINE" })));
    ui.regionA.appendChild(ui.flowA);
    ui.regionA.appendChild(h("div", { class: "dr-region-body" },
      unit(downA ? "ha_server_down" : "ha_server_ok", "Web servers"),
      unit(downA ? "ha_server_down" : "ha_server_ok", "App servers"),
      unit("ha_database", downA ? "Unreachable" : "Database", downA ? "off" : "")));

    ui.regionB.innerHTML = "";
    var serving = s && s.bServes;
    ui.flowB = h("div", { class: "flow dr-region-flow " + (serving ? "on" : "") });
    ui.chipB = h("span", { class: "chip " + (s ? (serving ? "mint" : "sky") : "dark"), text: s ? (serving ? "ONLINE" : "STANDBY") : "EMPTY" });
    ui.regionB.appendChild(h("div", { class: "dr-region-head" }, h("span", { class: "dr-region-name", text: "REGION B · RECOVERY" }), ui.chipB));
    ui.regionB.appendChild(ui.flowB);
    ui.bodyB = h("div", { class: "dr-region-body" });
    if (s) s.regionB.forEach(function (u) { ui.bodyB.appendChild(unit(u.icon, u.label, u.cls)); });
    else ui.bodyB.appendChild(h("span", { class: "metric-sub", text: "Choose a strategy to see what runs here." }));
    ui.regionB.appendChild(ui.bodyB);
  }

  function unit(icon, label, cls) {
    return h("div", { class: "dr-unit " + (cls || "") }, img(icon), h("span", { text: label }));
  }

  function setStore(online) {
    ui.storeStatus.innerHTML = "";
    ui.storeStatus.appendChild(img(online ? "ha_shop" : "ui_cross"));
    ui.storeStatus.appendChild(h("span", { class: online ? "online" : "offline", text: online ? "ANDY'S STORE: ONLINE" : "ANDY'S STORE: DOWN" }));
  }

  function updateStrip() {
    var li = ui.strip.querySelectorAll("li");
    var step = state.phase === "pick" ? 0 : state.phase === "ready" ? 1 : 2;
    li.forEach(function (el, i) {
      el.className = i < step ? "done" : i === step ? "now" : "";
    });
  }

  function pick(id) {
    if (state.phase === "running") return;
    Sound.sfx("move");
    state.strategy = id;
    state.phase = "ready";
    Object.keys(ui.cards).forEach(function (k) { ui.cards[k].classList.toggle("selected", k === id); });
    drawRegions(false);
    setStore(true);
    ui.recovery.innerHTML = "";
    ui.result.innerHTML = "";
    ui.trigger.disabled = false;
    ui.note.textContent = strat(id).name + " is ready. Press TRIGGER DISASTER (or Enter).";
    updateStrip();
  }

  function trigger() {
    if (state.phase !== "ready") return;
    var s = strat(state.strategy);
    var d = DISASTERS[state.disasterIdx++ % DISASTERS.length];
    state.phase = "running";
    updateStrip();
    ui.trigger.disabled = true;
    Object.keys(ui.cards).forEach(function (k) { ui.cards[k].disabled = true; });
    ui.note.textContent = d.text;
    Sound.sfx("alarm");

    // Region A goes dark
    drawRegions(true);
    ui.regionA.classList.add("shake", "flash-red");
    ui.regionA.appendChild(h("div", { class: "dr-disaster-icon pop" }, img(d.icon)));
    setStore(s.bServes); // active/active never goes dark

    // recovery panel
    var log = h("ul", { class: "log" });
    var items = s.steps.map(function (text, i) {
      var li = h("li", { class: "pending" }, img("ui_timer"), h("span", { text: text }));
      log.appendChild(li);
      return li;
    });
    ui.clock = h("div", { class: "dr-clock", text: "00:00:00" });
    var rtoBar = h("i"), rpoBar = h("i");
    ui.recovery.innerHTML = "";
    ui.recovery.appendChild(h("div", { class: "dr-recovery" },
      h("div", { class: "px-box" }, h("p", { class: "section-label", text: "RECOVERY STEPS" }), log),
      h("div", { class: "px-box" },
        h("p", { class: "section-label", text: "RTO · DOWNTIME CLOCK" }),
        ui.clock,
        h("div", { class: "dr-meter rto" }, rtoBar),
        h("p", { class: "section-label", text: "RPO · DATA LOST" }),
        h("p", { class: "metric-sub", text: "Orders placed after the last copy of the data reached Region B are lost." }),
        h("div", { class: "dr-meter" }, rpoBar))));

    // RPO bar fills right away: the lost data window is fixed by the strategy
    t.after(400, function () { rpoBar.style.width = Math.max(2, Math.min(100, s.rpo / 240 * 100)) + "%"; });

    var stepMs = 1100;
    var totalMs = stepMs * s.steps.length;
    var start = performance.now();
    var clockTimer = t.every(60, function () {
      var p = Math.min(1, (performance.now() - start) / totalMs);
      ui.clock.textContent = UQ.clock(s.rto * p);
      rtoBar.style.width = (Math.min(100, (s.rto * p) / 480 * 100)) + "%";
    });

    items.forEach(function (li, i) {
      t.after(i * stepMs + 200, function () {
        if (i > 0) { items[i - 1].className = "ok"; items[i - 1].querySelector("img").src = UQ.icon("ui_check"); }
        li.className = i === 0 ? "bad" : "active";
        li.querySelector("img").src = UQ.icon(i === 0 ? "ui_warning" : "ft_task");
        Sound.sfx(i === 0 ? "error" : "move");
      });
    });

    t.after(totalMs + 200, function () {
      t.cancel(clockTimer);
      items[items.length - 1].className = "ok";
      items[items.length - 1].querySelector("img").src = UQ.icon("ui_check");
      ui.clock.textContent = UQ.clock(s.rto);
      ui.clock.classList.add("stopped");
      rtoBar.style.width = Math.max(2, Math.min(100, s.rto / 480 * 100)) + "%";
      // Region B takes over
      ui.flowB.className = "flow dr-region-flow on";
      ui.chipB.className = "chip mint";
      ui.chipB.textContent = "ONLINE";
      ui.bodyB.innerHTML = "";
      ui.bodyB.appendChild(unit("ha_database", "Database"));
      ui.bodyB.appendChild(unit("dr_restored", "Full capacity"));
      ui.bodyB.appendChild(unit("dr_restored", "Full capacity"));
      ui.bodyB.classList.add("pop");
      setStore(true);
      Sound.sfx("success");
      finish(s);
    });
  }

  function finish(s) {
    var lost = Math.round(ORDERS_PER_HOUR * s.rpo / 60);
    var missed = Math.round(ORDERS_PER_HOUR * s.rto / 60);
    history[s.id] = { rto: s.rto, rpo: s.rpo, lost: lost, missed: missed, cost: s.cost };
    state.phase = "done";
    updateStrip();
    ui.strip.querySelectorAll("li").forEach(function (el) { el.className = "done"; });
    Object.keys(ui.cards).forEach(function (k) { ui.cards[k].disabled = false; });
    if (!ui.cards[s.id].querySelector(".strat-tested")) ui.cards[s.id].appendChild(img("ui_check", "strat-tested", "Tested"));
    ui.note.textContent = "Recovered! Try another strategy to compare.";

    ui.result.innerHTML = "";
    ui.result.appendChild(h("div", { class: "dr-result px-box pop" },
      h("p", { class: "section-label", text: "RESULT · " + s.name.toUpperCase() }),
      h("div", { class: "dr-result-grid" },
        stat("DOWNTIME (RTO)", UQ.duration(s.rto)),
        stat("DATA LOST (RPO)", UQ.duration(s.rpo)),
        stat("ORDERS LOST + MISSED", (lost + missed).toLocaleString()),
        h("div", { class: "dr-stat" }, h("span", { class: "k", text: "MONTHLY COST" }), UQ.coins(s.cost, 4))),
      h("div", { class: "dr-andy" }, img("ha_shop"), h("p", {}, h("b", { text: "ANDY LIM" }), s.andy)),
      h("p", { class: "illustrative", text: "Illustrative numbers at " + ORDERS_PER_HOUR + " orders/hour during the holiday sale. The ordering of the four strategies follows the AWS DR whitepaper (2021)." }),
      h("div", { class: "dr-result-actions" },
        h("button", { class: "px-btn", type: "button", onclick: function () { pick(nextUntested(s.id)); stage.scrollIntoView({ behavior: "smooth" }); } },
          img("ui_play", "icon-sm"), "TRY ANOTHER STRATEGY"),
        h("button", { class: "px-btn ghost", type: "button", "data-action": "hub" }, img("ui_back", "icon-sm"), "BACK TO ZONES"))));
    drawCompare();
    t.after(50, function () { ui.result.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
  }

  function nextUntested(after) {
    var order = STRATEGIES.map(function (s) { return s.id; });
    var start = order.indexOf(after);
    for (var i = 1; i <= order.length; i++) {
      var id = order[(start + i) % order.length];
      if (!history[id]) return id;
    }
    return order[(start + 1) % order.length];
  }

  function stat(k, v) {
    return h("div", { class: "dr-stat" }, h("span", { class: "k", text: k }), h("span", { class: "v", text: v }));
  }

  function drawCompare() {
    ui.compare.innerHTML = "";
    var tested = STRATEGIES.filter(function (s) { return history[s.id]; });
    if (tested.length < 2) return;
    var rows = tested.map(function (s) {
      var r = history[s.id];
      return h("tr", {},
        h("td", { text: s.name }), h("td", { text: UQ.duration(r.rto) }), h("td", { text: UQ.duration(r.rpo) }),
        h("td", { text: (r.lost + r.missed).toLocaleString() }), h("td", {}, UQ.coins(r.cost, 4)));
    });
    var box = h("div", { class: "dr-compare px-box" },
      h("p", { class: "section-label", text: "COMPARE YOUR RUNS (" + tested.length + "/4 TESTED)" }),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "STRATEGY" }), h("th", { text: "DOWNTIME" }), h("th", { text: "DATA LOST" }), h("th", { text: "ORDERS HIT" }), h("th", { text: "COST" }))),
        h("tbody", {}, rows)));
    if (tested.length === 4) {
      box.appendChild(h("div", { class: "dr-question pop" }, img("ui_trophy"),
        h("p", { text: "All four strategies tested! Andy runs a mid-sized, budget-conscious business with a small IT team and seasonal spikes. Which one would you recommend, and why?" })));
    }
    ui.compare.appendChild(box);
  }

  window.Zones.dr = { title: "DR ZONE · DISASTER RECOVERY", mount: mount, unmount: unmount };
})();
