/*
 * FT ZONE: the same failing node, two playbooks side by side.
 * Proactive techniques work only BEFORE the failure; reactive ones only AFTER it
 * (Kumari & Kaur, 2018). Fault -> error -> failure chain shown on each panel.
 * Timings are illustrative and sped up.
 */
(function () {
  var h = UQ.h, img = UQ.img;

  var JOB_SECONDS = 16;      // job length on a healthy node
  var STRESS_SECONDS = 8;    // node A goes from healthy to crashed
  var WARN_AT = 30;          // monitoring spots warning signs (fault)
  var ERROR_AT = 65;         // incorrect internal state (error)
  var CHECKPOINT_EVERY = 20; // job saves state every 20%

  var PROACTIVE = [
    { id: "self_heal", name: "Self-healing", icon: "ft_self_heal", tip: "Auto-detects and fixes the problem" },
    { id: "rejuvenate", name: "Software rejuvenation", icon: "ft_rejuvenate", tip: "Planned restart to a clean state" },
    { id: "preempt", name: "Pre-emptive migration", icon: "ft_preempt", tip: "Move the job before the node fails" },
    { id: "balance", name: "Load balancing", icon: "ft_balance", tip: "Share the load so the node cools down" }
  ];
  var REACTIVE = [
    { id: "checkpoint", name: "Checkpointing", icon: "ft_checkpoint", tip: "Resume from the last saved state" },
    { id: "replicate", name: "Replication", icon: "ft_replicate", tip: "A copy of the job takes over" },
    { id: "migrate", name: "Job migration", icon: "ft_migrate", tip: "Move the failed job to a healthy node" },
    { id: "retry", name: "Retry", icon: "ft_retry", tip: "Run it again until it succeeds" },
    { id: "resubmit", name: "Task resubmission", icon: "ft_resubmit", tip: "Send it back to the queue" }
  ];

  var tried = {}; // techniques tried while the page is open

  var t, stage, ui, run, keyHandler;

  function mount(el) {
    stage = el;
    t = UQ.scope();
    ui = {};
    render();
    reset();
    t.frame(tick);
    keyHandler = function (e) {
      if (e.target.closest && e.target.closest(".topbar")) return;
      if ((e.key === "Enter" || e.key === " ") && run.phase === "idle") { e.preventDefault(); start(); }
    };
    document.addEventListener("keydown", keyHandler);
  }

  function unmount() {
    if (t) t.clear();
    document.removeEventListener("keydown", keyHandler);
    stage = null;
  }

  // ---------------- layout ----------------
  function render() {
    stage.innerHTML = "";
    stage.appendChild(h("div", { class: "zone-intro px-box" }, img("ft_heat"),
      h("p", { html: "Node A is processing <strong>Andy's holiday orders</strong>, and it's starting to overheat. Both panels get the <strong>same failing node</strong>. On the left you act <strong>before</strong> it fails, on the right <strong>after</strong>." })));

    ui.startBtn = h("button", { class: "big-btn yellow", type: "button", onclick: function () { if (run.phase === "idle") start(); else { reset(); start(); } } },
      img("ui_play"), h("span", { text: "START SCENARIO" }));
    ui.hint = h("span", { class: "note", text: "Press START (or Enter). Watch Node A's temperature." });
    stage.appendChild(h("div", { class: "dr-controls" }, ui.startBtn, ui.hint));

    ui.left = panel("proactive");
    ui.right = panel("reactive");
    stage.appendChild(h("div", { class: "ft-panels" }, ui.left.el, ui.right.el));

    ui.summary = h("div");
    stage.appendChild(ui.summary);

    ui.tracker = h("div");
    stage.appendChild(ui.tracker);
    drawTracker();
  }

  function panel(kind) {
    var p = { kind: kind };
    var list = kind === "proactive" ? PROACTIVE : REACTIVE;
    p.chain = h("div", { class: "ft-chain" },
      p.cFault = h("span", { class: "ft-link" }, img("ft_bug"), "FAULT"),
      h("span", { class: "ft-arrow", text: "▶" }),
      p.cError = h("span", { class: "ft-link" }, img("ui_warning"), "ERROR"),
      h("span", { class: "ft-arrow", text: "▶" }),
      p.cFail = h("span", { class: "ft-link" }, img("ft_crash"), "FAILURE"));

    p.heatFill = h("i");
    p.heatTxt = h("span", { class: "ft-heat-txt", text: "0%" });
    p.nodeA = h("div", { class: "ft-node" }, p.nodeAIcon = img("ha_server_ok"), h("b", { text: "NODE A" }), p.nodeAState = h("span", { text: "Idle" }),
      h("div", { class: "ft-heat" }, img("ft_heat"), h("span", { class: "ft-heat-bar" }, p.heatFill), p.heatTxt));
    p.nodeB = h("div", { class: "ft-node" }, p.nodeBIcon = img("ha_server_standby"), h("b", { text: "NODE B" }), p.nodeBState = h("span", { text: "Spare" }));

    p.jobFill = h("i");
    var bar = h("div", { class: "ft-job-bar" }, p.jobFill);
    for (var c = CHECKPOINT_EVERY; c < 100; c += CHECKPOINT_EVERY) bar.appendChild(h("span", { class: "ft-cp", style: { left: c + "%" }, title: "checkpoint" }));
    p.jobTxt = h("span", { class: "ft-job-txt", text: "0%" });

    p.btns = {};
    var grid = h("div", { class: "ft-techs" });
    list.forEach(function (tech) {
      var b = h("button", { class: "ft-tech", type: "button", disabled: true, title: tech.tip, onclick: function () { use(p, tech); } },
        img(tech.icon), h("span", { class: "ft-tech-name", text: tech.name }), h("span", { class: "ft-tech-tip", text: tech.tip }));
      p.btns[tech.id] = b;
      grid.appendChild(b);
    });

    p.status = h("p", { class: "ft-status" });
    p.result = h("div");
    p.el = h("section", { class: "ft-panel px-box " + kind },
      h("div", { class: "ft-panel-head" },
        h("span", { class: "chip " + (kind === "proactive" ? "mint" : "coral"), text: kind === "proactive" ? "PROACTIVE FT" : "REACTIVE FT" }),
        h("span", { class: "ft-when", text: kind === "proactive" ? "Acts BEFORE the failure" : "Acts AFTER the failure" })),
      p.chain,
      h("div", { class: "ft-nodes" }, p.nodeA, p.nodeB),
      h("p", { class: "section-label", text: "JOB: HOLIDAY ORDERS BATCH" }),
      h("div", { class: "ft-job" }, bar, p.jobTxt),
      p.status,
      grid,
      p.result,
      h("p", { class: "ft-real", text: kind === "proactive" ? "Real world: Netflix's Chaos Monkey crashes servers on purpose so weaknesses are fixed before a real outage." : "Real world: Netflix's Hystrix trips a circuit breaker after a service starts failing and returns a fallback." }));
    return p;
  }

  // ---------------- run state ----------------
  function freshPanel(p) {
    p.s = { phase: "idle", stress: 0, progress: 0, node: "A", pauseLeft: 0, cool: null, lost: 0, delay: 0, tech: null, aDown: false, retryStage: 0, stressFrozen: false };
  }

  function reset() {
    run = { phase: "idle", time: 0 };
    [ui.left, ui.right].forEach(function (p) {
      freshPanel(p);
      p.result.innerHTML = "";
      Object.keys(p.btns).forEach(function (k) { p.btns[k].disabled = true; p.btns[k].classList.remove("used"); });
      p.el.classList.remove("won", "lost");
    });
    ui.summary.innerHTML = "";
    ui.startBtn.querySelector("span").textContent = "START SCENARIO";
    ui.hint.textContent = "Press START (or Enter). Watch Node A's temperature.";
    status(ui.left, "Waiting to start.", "");
    status(ui.right, "Waiting to start.", "");
    paint();
  }

  function start() {
    run.phase = "running";
    [ui.left, ui.right].forEach(function (p) { p.s.phase = "running"; });
    ui.startBtn.querySelector("span").textContent = "RESTART";
    ui.hint.textContent = "Proactive buttons unlock when monitoring spots warning signs. Reactive ones unlock after the crash.";
    status(ui.left, "Monitoring Node A...", "");
    status(ui.right, "No failure yet. Reactive techniques can't do anything until something breaks.", "");
    Sound.sfx("start");
  }

  function status(p, text, cls) {
    p.status.textContent = text;
    p.status.className = "ft-status " + (cls || "");
  }

  // ---------------- simulation ----------------
  function tick(dt) {
    if (!stage || run.phase !== "running") return;
    run.time += dt;
    [ui.left, ui.right].forEach(function (p) { step(p, dt); });
    paint();
    if (ui.left.s.phase !== "running" && ui.right.s.phase !== "running" && ui.left.s.phase !== "crashed" && ui.right.s.phase !== "crashed") {
      if (run.phase === "running") { run.phase = "over"; summary(); }
    }
  }

  function step(p, dt) {
    var s = p.s;
    if (s.phase === "done" || s.phase === "toolate") return;

    // node A stress
    if (!s.aDown && !s.stressFrozen) {
      if (s.cool !== null) {
        s.stress += (s.cool - s.stress) * Math.min(1, dt * 3);
      } else {
        s.stress = Math.min(100, s.stress + dt * 100 / STRESS_SECONDS);
      }
    }
    if (!s.aDown && s.stress >= 100) crashA(p);

    // proactive buttons unlock on warning signs
    if (p.kind === "proactive" && s.phase === "running" && !s.tech) {
      var unlock = s.stress >= WARN_AT && !s.aDown;
      Object.keys(p.btns).forEach(function (k) { p.btns[k].disabled = !unlock; });
      if (unlock && !s.warned) { s.warned = true; status(p, "Warning signs! Node A is overheating. Act now, before it fails.", "warn"); Sound.sfx("move"); }
    }

    if (s.phase !== "running") return;
    if (s.pauseLeft > 0) { s.pauseLeft -= dt; s.delay += dt; return; }
    // the job only advances if its node is alive
    if (s.node === "A" && s.aDown) return;
    s.progress = Math.min(100, s.progress + dt * 100 / JOB_SECONDS);
    if (s.progress >= 100) finishPanel(p);
  }

  function crashA(p) {
    var s = p.s;
    s.aDown = true;
    s.stress = 100;
    p.nodeA.classList.add("shake");
    t.after(900, function () { p.nodeA.classList.remove("shake"); });
    if (s.node === "A" && s.phase === "running") {
      if (p.kind === "proactive") {
        s.phase = "toolate";
        Object.keys(p.btns).forEach(function (k) { p.btns[k].disabled = true; });
        status(p, "Too late! Node A crashed. Proactive techniques only work before the failure.", "bad");
        p.el.classList.add("lost");
        p.result.innerHTML = "";
        p.result.appendChild(h("div", { class: "ft-outcome bad pop" }, img("ui_cross"),
          h("p", {}, h("b", { text: "FAILURE NOT PREVENTED" }), "Press RESTART and act while the warning signs are showing.")));
      } else {
        s.phase = "crashed";
        Object.keys(p.btns).forEach(function (k) { p.btns[k].disabled = false; });
        status(p, "Node A crashed at " + Math.floor(s.progress) + "% done! Pick a reactive technique to recover.", "bad");
      }
      Sound.sfx("alarm");
    } else if (p.kind === "proactive" && s.tech === "preempt") {
      status(p, "Node A crashed, but the job had already moved to Node B. Nothing lost.", "ok");
      Sound.sfx("error");
    }
  }

  function use(p, tech) {
    var s = p.s;
    if (s.tech) return;
    s.tech = tech.id;
    tried[tech.id] = true;
    Object.keys(p.btns).forEach(function (k) { p.btns[k].disabled = true; });
    p.btns[tech.id].classList.add("used");
    Sound.sfx("select");

    if (p.kind === "proactive") {
      if (tech.id === "self_heal") { s.pauseLeft = 0.8; s.cool = 10; status(p, "Self-healing: the system spotted the problem and fixed Node A by itself.", "ok"); }
      if (tech.id === "rejuvenate") { s.pauseLeft = 1.5; s.stress = 0; s.cool = 5; status(p, "Rejuvenation: Node A restarted to a clean state on schedule, then picked the job back up.", "ok"); }
      if (tech.id === "preempt") { s.pauseLeft = 0.5; s.node = "B"; status(p, "Pre-emptive migration: the job moved to Node B before Node A failed.", "ok"); }
      if (tech.id === "balance") { s.cool = 45; status(p, "Load balancing: Node B takes half the work, so Node A cools down.", "ok"); }
      return;
    }

    // reactive: we are past the crash
    var at = s.progress;
    var lastCp = Math.floor(at / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    s.phase = "running";
    if (tech.id === "checkpoint") {
      s.lost = at - lastCp; s.progress = lastCp; s.pauseLeft = 1.4;
      restartA(p, 1.4);
      status(p, "Checkpointing: Node A restarts and resumes from the " + lastCp + "% checkpoint, not from zero.", "ok");
    }
    if (tech.id === "replicate") {
      s.lost = 0; s.node = "B"; s.pauseLeft = 0.3;
      status(p, "Replication: a copy of the job was already running on Node B, so it takes over at once. (Costs double the resources.)", "ok");
    }
    if (tech.id === "migrate") {
      s.lost = at; s.progress = 0; s.node = "B"; s.pauseLeft = 0.6;
      status(p, "Job migration: the failed job moves to healthy Node B and starts over there.", "ok");
    }
    if (tech.id === "retry") {
      s.lost = at; s.progress = 0; s.pauseLeft = 3.2;
      status(p, "Retry: Node A restarts and runs the job again. Attempt 1...", "warn");
      restartA(p, 1.2);
      t.after(1300, function () {
        if (!stage) return;
        p.nodeA.classList.add("shake");
        status(p, "Attempt 1 failed (Node A still unstable). Retrying... attempt 2", "bad");
        Sound.sfx("error");
        s.aDown = true;
        restartA(p, 1.8);
      });
      t.after(3300, function () { if (stage) status(p, "Attempt 2 succeeded. The job restarted from zero.", "ok"); });
    }
    if (tech.id === "resubmit") {
      s.lost = at; s.progress = 0; s.node = "B"; s.pauseLeft = 1.6;
      status(p, "Task resubmission: the job goes back to the queue, waits for a slot, and starts over on Node B.", "ok");
    }
  }

  function restartA(p, secs) {
    var s = p.s;
    s.stressFrozen = true;
    t.after(secs * 1000, function () {
      if (!stage) return;
      s.aDown = false; s.stress = 15; s.cool = 15; s.stressFrozen = false;
    });
  }

  function finishPanel(p) {
    var s = p.s;
    s.phase = "done";
    p.el.classList.add("won");
    var tech = (p.kind === "proactive" ? PROACTIVE : REACTIVE).filter(function (x) { return x.id === s.tech; })[0];
    var name = tech ? tech.name : "No technique";
    var good = s.lost === 0;
    p.result.innerHTML = "";
    p.result.appendChild(h("div", { class: "ft-outcome pop " + (good ? "ok" : "warn") }, img(good ? "ui_check" : "ft_checkpoint"),
      h("p", {}, h("b", { text: "JOB COMPLETE · " + name.toUpperCase() }),
        "Work lost: " + Math.round(s.lost) + "% · Extra time: " + s.delay.toFixed(1) + "s" +
        (p.kind === "proactive" ? " · Failure prevented" : " · Recovered after the failure"))));
    Sound.sfx("success");
    drawTracker();
  }

  // ---------------- drawing ----------------
  function paint() {
    [ui.left, ui.right].forEach(function (p) {
      var s = p.s;
      var stress = Math.max(0, Math.min(100, s.stress));
      p.heatFill.style.width = stress + "%";
      p.heatFill.className = stress >= ERROR_AT ? "hot" : stress >= WARN_AT ? "warm" : "";
      p.heatTxt.textContent = Math.round(stress) + "%";
      // fault -> error -> failure
      p.cFault.classList.toggle("lit", stress >= WARN_AT || s.aDown);
      p.cError.classList.toggle("lit", stress >= ERROR_AT || s.aDown);
      // a failure is what the user sees, so it only lights if the job was hit
      p.cFail.classList.toggle("lit", s.aDown && (p.kind === "reactive" || s.phase === "toolate"));

      setIcon(p.nodeAIcon, s.aDown ? "ha_server_down" : "ha_server_ok");
      p.nodeAState.textContent = s.aDown ? "CRASHED" : s.phase === "idle" ? "Idle" : s.node === "A" ? (s.pauseLeft > 0 ? "Restarting..." : "Running job") : (s.cool === 45 ? "Sharing load" : "Idle");
      var bBusy = s.node === "B" || (s.cool === 45 && s.phase !== "idle");
      setIcon(p.nodeBIcon, bBusy ? "ha_server_ok" : "ha_server_standby");
      p.nodeBState.textContent = s.node === "B" ? "Running job" : bBusy ? "Sharing load" : "Spare";
      p.nodeA.classList.toggle("active", s.node === "A" && !s.aDown && s.phase !== "idle");
      p.nodeB.classList.toggle("active", bBusy);
      p.nodeA.classList.toggle("dead", s.aDown);

      p.jobFill.style.width = s.progress + "%";
      p.jobFill.className = (s.phase === "crashed" || s.phase === "toolate") ? "stuck" : s.phase === "done" ? "done" : "";
      p.jobTxt.textContent = Math.floor(s.progress) + "%";
    });
  }

  function setIcon(el, name) { var src = UQ.icon(name); if (el.getAttribute("src") !== src) el.src = src; }

  function summary() {
    var L = ui.left.s, R = ui.right.s;
    ui.summary.innerHTML = "";
    var lname = L.phase === "toolate" ? "Missed the window" : (PROACTIVE.filter(function (x) { return x.id === L.tech; })[0] || {}).name;
    var rname = (REACTIVE.filter(function (x) { return x.id === R.tech; })[0] || {}).name;
    ui.summary.appendChild(h("div", { class: "px-box ft-summary pop" },
      h("p", { class: "section-label", text: "SAME FAILURE, TWO PLAYBOOKS" }),
      h("div", { class: "dr-result-grid ft-sum-grid" },
        h("div", { class: "dr-stat" }, h("span", { class: "k", text: "PROACTIVE · " + (lname || "-").toUpperCase() }),
          h("span", { class: "v", text: L.phase === "toolate" ? "Node crashed" : "Lost " + Math.round(L.lost) + "% · failure prevented" })),
        h("div", { class: "dr-stat" }, h("span", { class: "k", text: "REACTIVE · " + (rname || "-").toUpperCase() }),
          h("span", { class: "v", text: "Lost " + Math.round(R.lost) + "% · recovered" }))),
      h("div", { class: "dr-andy" }, img("ha_shop"), h("p", {}, h("b", { text: "THE TAKEAWAY" }),
        "Proactive FT tries to stop the failure from happening. Reactive FT limits the damage when one gets through. Real systems run both at the same time.")),
      h("div", { class: "dr-result-actions" },
        h("button", { class: "px-btn", type: "button", onclick: function () { reset(); start(); window.scrollTo({ top: 0, behavior: "smooth" }); } }, img("ft_retry", "icon-sm"), "TRY OTHER TECHNIQUES"),
        h("button", { class: "px-btn ghost", type: "button", "data-action": "hub" }, img("ui_back", "icon-sm"), "BACK TO ZONES"))));
    t.after(50, function () { ui.summary.scrollIntoView({ behavior: "smooth", block: "nearest" }); });
  }

  function drawTracker() {
    ui.tracker.innerHTML = "";
    var all = PROACTIVE.concat(REACTIVE);
    var n = all.filter(function (x) { return tried[x.id]; }).length;
    var box = h("div", { class: "px-box ft-tracker" },
      h("p", { class: "section-label", text: "TECHNIQUES TRIED: " + n + "/9" }),
      h("div", { class: "ft-badges" }, all.map(function (x) {
        return h("span", { class: "ft-badge " + (tried[x.id] ? "on" : ""), title: x.name }, img(x.icon), h("span", { text: x.name }));
      })));
    if (n === all.length) box.appendChild(h("div", { class: "dr-question pop" }, img("ui_trophy"),
      h("p", { text: "You've tried all nine techniques from Kumari & Kaur (2018)! Which pair would you run together for Andy's store?" })));
    ui.tracker.appendChild(box);
  }

  window.Zones.ft = { title: "FT ZONE · FAULT TOLERANCE", mount: mount, unmount: unmount };
})();
