/*
 * HA ZONE: customers -> load balancer -> servers spread over three availability zones.
 * Click servers to crash them, knock out a whole zone, or turn on chaos mode,
 * then compare redundancy models (Endo et al., 2016): none, 2N, N+M, N-way active.
 * Timings and request rates are illustrative and sped up.
 */
(function () {
  var h = UQ.h, img = UQ.img;

  var RATE = 6;            // requests per second
  var CHECK_EVERY = 1.0;   // health check interval (s)
  var FAILOVER_DELAY = 1.5; // standby promotion / warm-pool join (s)

  var MODELS = {
    none: {
      name: "NO REDUNDANCY", short: "None", example: "One server, no backup",
      desc: "A single server runs the whole store. If it fails, nothing takes over.",
      cap: 1.0,
      servers: [{ az: 0, role: "active" }]
    },
    "2n": {
      name: "2N", short: "2N", example: "Like Amazon RDS Multi-AZ",
      desc: "One active server and one full standby in another zone. The standby is promoted when the active one fails.",
      cap: 1.0,
      servers: [{ az: 0, role: "active" }, { az: 1, role: "standby" }]
    },
    nm: {
      name: "N+M", short: "N+M", example: "Like EC2 Auto Scaling warm pools",
      desc: "N = 2 active servers carry the load, M = 1 spare waits in a warm pool and joins when an active one fails.",
      cap: 0.5,
      servers: [{ az: 0, role: "active" }, { az: 1, role: "active" }, { az: 2, role: "standby", pool: true }]
    },
    nway: {
      name: "N-WAY ACTIVE", short: "N-way", example: "Like Netflix active-active",
      desc: "All three servers serve traffic at once. If one fails, the others simply absorb its share.",
      cap: 0.5,
      servers: [{ az: 0, role: "active" }, { az: 1, role: "active" }, { az: 2, role: "active" }]
    }
  };
  var ORDER = ["none", "2n", "nm", "nway"];

  var scoreboard = {}; // best result per model while the page is open

  var t, stage, ui, sim, keyHandler;

  function mount(el) {
    stage = el;
    t = UQ.scope();
    ui = {};
    render();
    setModel("2n");
    t.frame(tick);
    keyHandler = function (e) {
      if (e.target.closest && e.target.closest(".topbar")) return;
      var n = parseInt(e.key, 10);
      if (n >= 1 && n <= 4) setModel(ORDER[n - 1]);
      else if (e.key === "c" || e.key === "C") toggleChaos();
      else if (e.key === "r" || e.key === "R") repairAll();
    };
    document.addEventListener("keydown", keyHandler);
  }

  function unmount() {
    saveScore();
    if (t) t.clear();
    document.removeEventListener("keydown", keyHandler);
    stage = null;
  }

  // ---------------- layout ----------------
  function render() {
    stage.innerHTML = "";
    stage.appendChild(h("div", { class: "zone-intro px-box" }, img("ha_shop"),
      h("p", { html: "Andy's store runs behind a <strong>load balancer</strong>. <strong>Click a server</strong> to crash it, knock out a whole zone, or turn on <strong>chaos mode</strong>. Then switch redundancy models and compare." })));

    ui.models = {};
    var picker = h("div", { class: "ha-models" });
    ORDER.forEach(function (id, i) {
      var m = MODELS[id];
      var b = h("button", { class: "ha-model", type: "button", onclick: function () { setModel(id); } },
        h("span", { class: "strat-key", text: String(i + 1) }),
        h("span", { class: "ha-model-name", text: m.name }),
        h("span", { class: "ha-model-ex", text: m.example }));
      ui.models[id] = b;
      picker.appendChild(b);
    });
    stage.appendChild(picker);
    ui.desc = h("p", { class: "ha-desc" });
    stage.appendChild(ui.desc);

    // arena
    ui.arena = h("div", { class: "ha-arena px-box" });
    ui.customers = h("div", { class: "ha-node ha-customers" }, img("ha_customer"), img("ha_customer", "second"), h("span", { text: "CUSTOMERS" }));
    ui.lb = h("div", { class: "ha-node ha-lb" }, img("ha_load_balancer"), h("span", { text: "LOAD BALANCER" }), ui.lbPulse = img("ha_health", "ha-pulse"));
    ui.azWrap = h("div", { class: "ha-azs" });
    ui.azs = [];
    for (var z = 0; z < 3; z++) {
      (function (zi) {
        var body = h("div", { class: "ha-az-body" });
        var btn = h("button", { class: "ha-outage", type: "button", title: "Knock out this whole zone", onclick: function () { zoneOutage(zi); } },
          img("ha_power"), "OUTAGE");
        var az = h("div", { class: "ha-az" }, h("div", { class: "ha-az-head" }, h("span", { text: "ZONE " + (zi + 1) }), btn), body);
        ui.azs.push({ el: az, body: body, btn: btn });
        ui.azWrap.appendChild(az);
      })(z);
    }
    ui.packets = h("div", { class: "ha-packets" });
    ui.arena.appendChild(ui.customers);
    ui.arena.appendChild(ui.lb);
    ui.arena.appendChild(ui.azWrap);
    ui.arena.appendChild(ui.packets);
    stage.appendChild(ui.arena);

    // controls
    ui.chaosBtn = h("button", { class: "px-btn ghost", type: "button", onclick: toggleChaos }, img("ft_chaos", "icon-sm"), h("span", { text: "CHAOS MODE: OFF" }));
    stage.appendChild(h("div", { class: "ha-controls" },
      h("button", { class: "px-btn", type: "button", onclick: repairAll }, img("ft_self_heal", "icon-sm"), "REPAIR ALL"),
      ui.chaosBtn,
      h("button", { class: "px-btn ghost", type: "button", onclick: function () { setModel(sim.model); } }, img("ft_retry", "icon-sm"), "RESET"),
      h("span", { class: "ha-keys", text: "Keys: 1-4 model · C chaos · R repair" })));

    // stats + log
    ui.store = h("div", { class: "dr-store-status" });
    ui.avail = h("div", { class: "ha-big" });
    ui.nines = h("div", { class: "ha-nines" });
    ui.served = h("span"); ui.dropped = h("span");
    ui.log = h("ul", { class: "log ha-log" });
    ui.board = h("div");
    stage.appendChild(h("div", { class: "ha-bottom" },
      h("div", { class: "px-box ha-stats" },
        ui.store,
        h("p", { class: "section-label", text: "AVAILABILITY" }),
        ui.avail, ui.nines,
        h("p", { class: "metric-sub" }, "Served: ", ui.served, " · Dropped: ", ui.dropped),
        h("p", { class: "illustrative", text: "Five nines (99.999%) allows less than 5.25 minutes of downtime a year (Endo et al., 2016). This demo is sped up, so the numbers are illustrative." })),
      h("div", { class: "px-box ha-events" }, h("p", { class: "section-label", text: "EVENT LOG" }), ui.log)));
    stage.appendChild(ui.board);
  }

  // ---------------- simulation ----------------
  function setModel(id) {
    if (sim) saveScore();
    var m = MODELS[id];
    sim = {
      model: id, cap: m.cap, time: 0, spawnAcc: 0, checkAcc: 0, rr: 0,
      served: 0, dropped: 0, recent: [], chaos: sim ? sim.chaos : false, chaosNext: 2.5,
      servers: m.servers.map(function (s, i) {
        return { id: "S" + (i + 1), az: s.az, role: s.role, pool: !!s.pool, healthy: true, lbUp: s.role === "active", load: 0, el: null, pending: null, repairAt: null };
      }),
      packets: []
    };
    Object.keys(ui.models).forEach(function (k) { ui.models[k].classList.toggle("selected", k === id); });
    ui.desc.textContent = m.desc;
    ui.packets.innerHTML = "";
    ui.log.innerHTML = "";
    log("info", "Model set to " + m.name + ".");
    drawServers();
    drawStats();
    drawBoard();
    Sound.sfx("move");
  }

  function drawServers() {
    ui.azs.forEach(function (az) { az.body.innerHTML = ""; });
    sim.servers.forEach(function (s) {
      s.loadBar = h("i");
      s.stateEl = h("span", { class: "ha-srv-state" });
      s.iconEl = img("ha_server_ok", "ha-srv-icon");
      s.el = h("button", { class: "ha-srv", type: "button", title: "Click to crash / repair", onclick: function () { clickServer(s); } },
        s.iconEl, h("span", { class: "ha-srv-name", text: s.id + (s.pool ? " · POOL" : "") }), s.stateEl, h("span", { class: "ha-load" }, s.loadBar));
      ui.azs[s.az].body.appendChild(s.el);
    });
    ui.azs.forEach(function (az, i) {
      var has = sim.servers.some(function (s) { return s.az === i; });
      az.el.classList.toggle("empty", !has);
      if (!has) az.body.appendChild(h("span", { class: "ha-az-empty", text: "unused" }));
      az.btn.disabled = !has;
    });
    refreshServers();
  }

  function refreshServers() {
    var routable = routableServers();
    sim.servers.forEach(function (s) {
      var load = routable.indexOf(s) >= 0 ? (1 / routable.length) / sim.cap : 0;
      s.load = load;
      var icon = !s.healthy ? "ha_server_down" : s.role === "standby" ? "ha_server_standby" : "ha_server_ok";
      if (s.iconEl.getAttribute("src") !== UQ.icon(icon)) s.iconEl.src = UQ.icon(icon);
      var label, cls;
      if (!s.healthy) { label = s.lbUp ? "CRASHED · LB UNAWARE" : "DOWN"; cls = "bad"; }
      else if (s.role === "standby") { label = s.pending ? "JOINING..." : s.pool ? "WARM POOL" : "STANDBY"; cls = "idle"; }
      else if (!s.lbUp) { label = "WAITING FOR CHECK"; cls = "idle"; }
      else if (load > 1.001) { label = "OVERLOADED"; cls = "warn"; }
      else { label = "SERVING"; cls = "ok"; }
      if (s.stateEl.textContent !== label) s.stateEl.textContent = label;
      var want = "ha-srv " + cls + (s.shakeUntil && sim.time < s.shakeUntil ? " shake" : "");
      if (s.el.className !== want) s.el.className = want;
      s.loadBar.style.width = Math.min(100, load * 100) + "%";
      s.loadBar.className = load > 1.001 ? "over" : "";
    });
  }

  function routableServers() {
    return sim.servers.filter(function (s) { return s.role === "active" && s.lbUp; });
  }

  function tick(dt) {
    if (!stage) return;
    sim.time += dt;

    // spawn requests
    sim.spawnAcc += dt * RATE;
    while (sim.spawnAcc >= 1) { sim.spawnAcc -= 1; spawn(); }

    // health checks
    sim.checkAcc += dt;
    if (sim.checkAcc >= CHECK_EVERY) { sim.checkAcc = 0; healthCheck(); }

    // pending failovers / repairs
    sim.servers.forEach(function (s) {
      if (s.pending && sim.time >= s.pending.at) { var p = s.pending; s.pending = null; p.fn(); }
      if (s.repairAt && sim.time >= s.repairAt) { s.repairAt = null; if (!s.healthy) { s.healthy = true; log("ok", s.id + " repaired by the chaos crew."); } }
    });

    // chaos mode
    if (sim.chaos) {
      sim.chaosNext -= dt;
      if (sim.chaosNext <= 0) {
        sim.chaosNext = 3 + Math.random() * 2.5;
        var alive = sim.servers.filter(function (s) { return s.healthy; });
        if (alive.length) {
          var v = alive[Math.floor(Math.random() * alive.length)];
          crash(v, "Chaos mode crashed " + v.id + "!");
          v.repairAt = sim.time + 6;
        }
      }
    }

    movePackets(dt);
    // trim the 3-second success window
    while (sim.recent.length && sim.recent[0].t < sim.time - 3) sim.recent.shift();
    refreshServers();
    drawStats();
  }

  function centerOf(el) {
    var a = ui.arena.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
  }

  function spawn() {
    var routable = routableServers();
    var target = null;
    if (routable.length) { sim.rr = (sim.rr + 1) % routable.length; target = routable[sim.rr]; }
    var dot = h("i", { class: "pkt" });
    ui.packets.appendChild(dot);
    var from = centerOf(ui.customers), mid = centerOf(ui.lb);
    sim.packets.push({ el: dot, from: from, mid: mid, target: target, p: 0, stage: 0 });
  }

  function movePackets(dt) {
    var keep = [];
    sim.packets.forEach(function (pk) {
      pk.p += dt / 0.35;
      if (pk.p >= 1) {
        pk.p = 0; pk.stage++;
        if (pk.stage === 1 && !pk.target) { finishPacket(pk, false, pk.mid); return; }
        if (pk.stage === 1) pk.to = centerOf(pk.target.el);
        if (pk.stage === 2) {
          var s = pk.target;
          var ok = s.healthy && s.role === "active";
          if (ok && s.load > 1.001 && Math.random() > 1 / s.load) ok = false; // overloaded
          finishPacket(pk, ok, pk.to);
          return;
        }
      }
      var a = pk.stage === 0 ? pk.from : pk.mid, b = pk.stage === 0 ? pk.mid : pk.to;
      var x = a.x + (b.x - a.x) * pk.p, y = a.y + (b.y - a.y) * pk.p;
      pk.el.style.transform = "translate(" + x + "px," + y + "px)";
      keep.push(pk);
    });
    sim.packets = keep;
  }

  function finishPacket(pk, ok, at) {
    sim.recent.push({ t: sim.time, ok: ok });
    if (ok) { sim.served++; pk.el.remove(); return; }
    sim.dropped++;
    pk.el.className = "pkt drop";
    pk.el.style.transform = "translate(" + at.x + "px," + at.y + "px)";
    t.after(450, function () { pk.el.remove(); });
    if (sim.dropped % 4 === 1) Sound.sfx("error");
  }

  function healthCheck() {
    ui.lbPulse.classList.remove("beat"); void ui.lbPulse.offsetWidth; ui.lbPulse.classList.add("beat");
    sim.servers.forEach(function (s) {
      if (s.role !== "active") return;
      if (!s.healthy && s.lbUp) {
        s.lbUp = false;
        log("bad", "Health check: " + s.id + " not responding. Load balancer stops sending it traffic.");
        startFailover(s);
      } else if (s.healthy && !s.lbUp) {
        s.lbUp = true;
        log("ok", "Health check: " + s.id + " is healthy again. Back in rotation.");
      }
    });
    // repaired servers that were demoted rejoin as standby / pool
    sim.servers.forEach(function (s) {
      if (s.role === "failed" && s.healthy) {
        s.role = "standby"; s.lbUp = false;
        log("info", s.id + " repaired and is now the " + (sim.model === "nm" ? "warm pool spare." : "standby."));
      }
    });
  }

  function startFailover(failed) {
    if (sim.model !== "2n" && sim.model !== "nm") {
      if (!routableServers().length) log("bad", "No server left to take over. The store is DOWN.");
      else if (sim.model === "nway") log("info", "Remaining servers absorb " + failed.id + "'s share.");
      return;
    }
    var spare = sim.servers.filter(function (s) { return s.role === "standby" && s.healthy && !s.pending; })[0];
    if (!spare) { log("bad", "No healthy " + (sim.model === "nm" ? "spare in the warm pool" : "standby") + " left!"); return; }
    log("info", (sim.model === "2n" ? "Promoting standby " : "Warm pool spare ") + spare.id + (sim.model === "2n" ? " to primary..." : " joining..."));
    spare.pending = {
      at: sim.time + FAILOVER_DELAY,
      fn: function () {
        if (!spare.healthy) { log("bad", spare.id + " failed before it could take over."); return; }
        spare.role = "active"; spare.lbUp = true; spare.pool = false;
        failed.role = "failed"; failed.lbUp = false;
        log("ok", sim.model === "2n" ? spare.id + " is the new primary (DNS flipped)." : spare.id + " joined. Capacity restored.");
        Sound.sfx("success");
      }
    };
  }

  // ---------------- player actions ----------------
  function clickServer(s) {
    if (s.healthy) crash(s, "You crashed " + s.id + "!");
    else { s.healthy = true; s.repairAt = null; log("ok", "You repaired " + s.id + ". The next health check will notice."); Sound.sfx("select"); }
  }

  function crash(s, msg) {
    if (!s.healthy) return;
    s.healthy = false;
    s.shakeUntil = sim.time + 0.9;
    log("bad", msg);
    Sound.sfx("alarm");
  }

  function zoneOutage(zi) {
    var hit = sim.servers.filter(function (s) { return s.az === zi && s.healthy; });
    if (!hit.length) return;
    ui.azs[zi].el.classList.remove("flash-red"); void ui.azs[zi].el.offsetWidth; ui.azs[zi].el.classList.add("flash-red");
    hit.forEach(function (s) { s.healthy = false; s.shakeUntil = sim.time + 0.9; });
    log("bad", "Zone " + (zi + 1) + " outage! " + hit.map(function (s) { return s.id; }).join(", ") + " went down.");
    Sound.sfx("alarm");
  }

  function repairAll() {
    var n = 0;
    sim.servers.forEach(function (s) { if (!s.healthy) { s.healthy = true; s.repairAt = null; n++; } });
    if (n) { log("ok", "Repaired " + n + " server" + (n > 1 ? "s" : "") + ". Waiting for the next health check."); Sound.sfx("select"); }
  }

  function toggleChaos() {
    sim.chaos = !sim.chaos;
    sim.chaosNext = 1.5;
    ui.chaosBtn.querySelector("span").textContent = "CHAOS MODE: " + (sim.chaos ? "ON" : "OFF");
    ui.chaosBtn.classList.toggle("chaos-on", sim.chaos);
    log(sim.chaos ? "bad" : "info", sim.chaos ? "Chaos mode ON: random servers will crash." : "Chaos mode OFF.");
    Sound.sfx(sim.chaos ? "alarm" : "back");
  }

  // ---------------- readouts ----------------
  function drawStats() {
    var total = sim.served + sim.dropped;
    var avail = total ? sim.served / total : 1;
    ui.avail.textContent = (avail * 100).toFixed(avail === 1 ? 0 : 2) + "%";
    ui.avail.className = "ha-big " + (avail >= 0.99 ? "good" : avail >= 0.9 ? "warn" : "bad");
    var nines = avail >= 1 ? "No drops yet" : avail < 0.9 ? "Under one nine" : Math.floor(-Math.log10(1 - avail)) + " nine" + (Math.floor(-Math.log10(1 - avail)) > 1 ? "s" : "");
    ui.nines.textContent = nines;
    ui.served.textContent = sim.served;
    ui.dropped.textContent = sim.dropped;

    var okRecent = sim.recent.filter(function (r) { return r.ok; }).length;
    var ratio = sim.recent.length ? okRecent / sim.recent.length : 1;
    var status = ratio > 0.9 ? "online" : ratio > 0.25 ? "degraded" : "down";
    if (status !== sim.lastStatus) {
      sim.lastStatus = status;
      ui.store.innerHTML = "";
      ui.store.appendChild(img(status === "online" ? "ha_shop" : status === "degraded" ? "ui_warning" : "ui_cross"));
      ui.store.appendChild(h("span", { class: status === "online" ? "online" : "offline", text: "ANDY'S STORE: " + status.toUpperCase() }));
    }
  }

  function log(kind, text) {
    var icon = kind === "bad" ? "ui_warning" : kind === "ok" ? "ui_check" : "ha_health";
    var li = h("li", { class: kind === "bad" ? "bad" : kind === "ok" ? "ok" : "" }, img(icon), h("span", { text: text }));
    ui.log.insertBefore(li, ui.log.firstChild);
    while (ui.log.children.length > 6) ui.log.removeChild(ui.log.lastChild);
  }

  function saveScore() {
    if (!sim) return;
    var total = sim.served + sim.dropped;
    if (total < 20) return;
    var avail = sim.served / total;
    var prev = scoreboard[sim.model];
    if (!prev || total > prev.total) scoreboard[sim.model] = { avail: avail, total: total, chaos: sim.chaos };
  }

  function drawBoard() {
    ui.board.innerHTML = "";
    var ids = ORDER.filter(function (id) { return scoreboard[id]; });
    if (!ids.length) return;
    ui.board.appendChild(h("div", { class: "dr-compare px-box ha-board" },
      h("p", { class: "section-label", text: "YOUR RUNS PER MODEL" }),
      h("table", {},
        h("thead", {}, h("tr", {}, h("th", { text: "MODEL" }), h("th", { text: "AVAILABILITY" }), h("th", { text: "REQUESTS" }), h("th", { text: "CHAOS" }))),
        h("tbody", {}, ids.map(function (id) {
          var r = scoreboard[id];
          return h("tr", {}, h("td", { text: MODELS[id].name }), h("td", { text: (r.avail * 100).toFixed(2) + "%" }), h("td", { text: String(r.total) }), h("td", { text: r.chaos ? "ON" : "OFF" }));
        })))));
  }

  window.Zones.ha = { title: "HA ZONE · HIGH AVAILABILITY", mount: mount, unmount: unmount };
})();
