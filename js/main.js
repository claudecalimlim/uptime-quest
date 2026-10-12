/*
 * Uptime Quest: screen flow and hub controls.
 * Screens: title -> hub -> zone (ha / ft / dr), plus the manual.
 * URL hash jumps straight to a screen: #hub, #ha, #ft, #dr, #manual
 */
(function () {
  var ZONES = {
    ha: { title: "HA ZONE · HIGH AVAILABILITY" },
    ft: { title: "FT ZONE · FAULT TOLERANCE" },
    dr: { title: "DR ZONE · DISASTER RECOVERY" }
  };
  var ZONE_ORDER = ["ha", "ft", "dr"];

  var ANDY_LINES = [
    "Hi! I'm Andy Lim. My light company just moved to the cloud.",
    "The holiday sale starts soon, and every minute offline costs me orders.",
    "Pick a zone and help me keep the store running!"
  ];

  var current = "title";
  var selected = 0;
  var typingTimer = null;
  var mountedZone = null;
  var manualReturn = "title"; // where the manual's back button goes
  var manualPushed = false;   // did we add a browser-history entry for the manual?

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  // ---------- zones ----------
  function unmountZone() {
    if (mountedZone && window.Zones[mountedZone] && window.Zones[mountedZone].unmount) {
      try { window.Zones[mountedZone].unmount(); } catch (e) { console.error(e); }
    }
    mountedZone = null;
    $("#zone-stage").innerHTML = "";
  }

  function mountZone(id) {
    var stage = $("#zone-stage");
    stage.innerHTML = "";
    stage.className = "zone-stage zone-" + id;
    var zone = window.Zones[id];
    if (zone && zone.mount) {
      zone.mount(stage);
      mountedZone = id;
    } else {
      stage.appendChild(UQ.h("div", { class: "construction px-box" },
        UQ.img("ui_warning", "zone-icon"),
        UQ.h("p", { class: "construction-title", text: "UNDER CONSTRUCTION" }),
        UQ.h("p", { class: "construction-text", text: "This zone is coming in the next build." }),
        UQ.h("button", { class: "px-btn", "data-action": "hub", type: "button" }, UQ.img("ui_back", "icon-sm"), " BACK TO ZONES")));
    }
  }

  // ---------- screens ----------
  function show(screen, zoneId) {
    $$(".screen").forEach(function (s) { s.classList.remove("active"); });
    if (current === "zone") unmountZone();
    if (current === "hub") clearTimeout(typingTimer);
    if (current === "manual" && screen !== "manual") manualPushed = false;
    current = screen;

    if (screen === "title") {
      $("#screen-title").classList.add("active");
      setHash("");
    } else if (screen === "hub") {
      $("#screen-hub").classList.add("active");
      setHash("hub");
      highlight(selected);
      typeAndy();
    } else if (screen === "zone") {
      $("#zone-title").textContent = ZONES[zoneId].title;
      $("#screen-zone").classList.add("active");
      $("#screen-zone").setAttribute("data-zone", zoneId);
      mountZone(zoneId);
      setHash(zoneId);
    } else if (screen === "manual") {
      $("#screen-manual").classList.add("active");
    }
    window.scrollTo(0, 0);
  }

  function setHash(h) {
    var url = h ? "#" + h : location.pathname + location.search;
    try { history.replaceState(null, "", url); } catch (e) { /* not allowed on some file:// setups */ }
  }

  // ---------- manual ----------
  function openManual() {
    if (current === "manual") return;
    if (aboutOpen()) $("#about-modal").hidden = true;
    manualReturn = current === "hub" ? "hub" : "title";
    Sound.sfx("select");
    show("manual");
    // a real history entry, so the browser's Back button returns to the game
    try { history.pushState({ uq: "manual" }, "", "#manual"); manualPushed = true; }
    catch (e) { manualPushed = false; }
  }

  function closeManual() {
    Sound.sfx("back");
    if (manualPushed) { manualPushed = false; history.back(); } // popstate brings us back
    else show(manualReturn);
  }

  function jumpTo(id) {
    var el = document.getElementById(id);
    if (!el) return;
    Sound.sfx("move");
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // numbered badges on the manual screenshots
  function placeCallouts() {
    var data = window.CALLOUTS || {};
    $$("#screen-manual figure.shot[data-shot]").forEach(function (fig) {
      var pts = data[fig.getAttribute("data-shot")];
      if (!pts || fig.classList.contains("phone") || fig.querySelector(".shot-wrap")) return;
      var wrap = document.createElement("div");
      wrap.className = "shot-wrap";
      var im = fig.querySelector("img");
      fig.insertBefore(wrap, im);
      wrap.appendChild(im);
      pts.forEach(function (p) {
        var b = document.createElement("span");
        b.className = "badge";
        b.textContent = p.n;
        b.style.left = p.x + "%";
        b.style.top = p.y + "%";
        wrap.appendChild(b);
      });
    });
  }

  // ---------- Andy's typewriter dialog ----------
  function typeAndy() {
    var el = $("#andy-text");
    clearTimeout(typingTimer);
    el.classList.remove("done");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var full = ANDY_LINES.join(" ");
    if (reduce) { el.textContent = full; el.classList.add("done"); return; }

    var lineIdx = 0, charIdx = 0;
    el.textContent = "";
    (function step() {
      var line = ANDY_LINES[lineIdx];
      if (charIdx <= line.length) {
        el.textContent = line.slice(0, charIdx);
        if (charIdx % 3 === 0 && line[charIdx] !== " ") Sound.sfx("type");
        charIdx++;
        typingTimer = setTimeout(step, 28);
      } else if (lineIdx < ANDY_LINES.length - 1) {
        lineIdx++; charIdx = 0;
        typingTimer = setTimeout(step, 1400);
      } else {
        el.classList.add("done");
      }
    })();
  }

  // ---------- hub selection ----------
  function highlight(i) {
    selected = (i + ZONE_ORDER.length) % ZONE_ORDER.length;
    $$(".zone-card").forEach(function (card, idx) {
      card.classList.toggle("selected", idx === selected);
    });
  }

  function openZone(id) {
    Sound.sfx("select");
    show("zone", id);
  }

  // ---------- about modal ----------
  function openAbout() { $("#about-modal").hidden = false; $("#about-modal .px-btn").focus(); Sound.sfx("select"); }
  function closeAbout() { $("#about-modal").hidden = true; Sound.sfx("back"); }
  function aboutOpen() { return !$("#about-modal").hidden; }

  function startGame() {
    Sound.sfx("start");
    show("hub");
  }

  // ---------- events ----------
  document.addEventListener("click", function (e) {
    // mouse/touch clicks shouldn't leave focus on a button, or Enter would re-press it
    var anyBtn = e.target.closest("button, a");
    if (anyBtn && e.detail > 0) anyBtn.blur();

    var jump = e.target.closest("[data-jump]");
    if (jump) { e.preventDefault(); return jumpTo(jump.getAttribute("data-jump")); }

    var t = e.target.closest("[data-action], [data-toggle], [data-zone], #btn-start");
    if (!t) {
      if (e.target === $("#about-modal")) closeAbout();
      else if (current === "manual" && anyBtn) Sound.sfx("select"); // e.g. DOWNLOAD PDF
      return;
    }
    if (t.id === "btn-start") return startGame();
    if (t.hasAttribute("data-toggle")) { Sound.toggle(t.getAttribute("data-toggle")); return; }
    if (t.hasAttribute("data-zone") && t.classList.contains("zone-card")) {
      highlight(ZONE_ORDER.indexOf(t.getAttribute("data-zone")));
      return openZone(t.getAttribute("data-zone"));
    }
    var action = t.getAttribute("data-action");
    if (t.tagName === "A") e.preventDefault();
    if (action === "home") { Sound.sfx("back"); show("title"); }
    if (action === "hub") { Sound.sfx("back"); show("hub"); }
    if (action === "about") openAbout();
    if (action === "close-about") closeAbout();
    if (action === "manual") openManual();
    if (action === "close-manual") closeManual();
  });

  document.addEventListener("mouseover", function (e) {
    var card = e.target.closest(".zone-card");
    if (card && current === "hub") {
      var i = ZONE_ORDER.indexOf(card.getAttribute("data-zone"));
      if (i !== selected) { highlight(i); Sound.sfx("move"); }
    }
  });

  document.addEventListener("keydown", function (e) {
    if (aboutOpen()) {
      if (e.key === "Escape") { e.preventDefault(); closeAbout(); }
      return;
    }
    if (current === "manual") {
      // reading: keep arrows/space for scrolling, only Esc does something
      if (e.key === "Escape") { e.preventDefault(); closeManual(); }
      return;
    }
    if (current === "title") {
      // let a focused link or sound toggle handle its own Enter
      var ae = document.activeElement;
      if (ae && (ae.tagName === "A" || (ae.tagName === "BUTTON" && ae.id !== "btn-start"))) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startGame(); }
      return;
    }
    if (current === "hub") {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); highlight(selected + 1); Sound.sfx("move"); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); highlight(selected - 1); Sound.sfx("move"); }
      else if (e.key === "Enter") {
        // let Enter on a focused toolbar button or link do its own job
        if (document.activeElement && document.activeElement.closest(".topbar, .footer")) return;
        e.preventDefault(); openZone(ZONE_ORDER[selected]);
      }
      else if (e.key === "Escape") { e.preventDefault(); Sound.sfx("back"); show("title"); }
      return;
    }
    if (current === "zone" && e.key === "Escape") { e.preventDefault(); Sound.sfx("back"); show("hub"); }
  });

  // ---------- routing (address bar, Back / Forward buttons) ----------
  function routeFromHash() {
    var h = location.hash.replace("#", "");
    var zoneNow = $("#screen-zone").getAttribute("data-zone");
    if (h === "manual") {
      if (current !== "manual") { manualReturn = current === "hub" ? "hub" : "title"; show("manual"); }
    } else if (h === "hub") {
      if (current !== "hub") show("hub");
    } else if (ZONES[h]) {
      if (!(current === "zone" && zoneNow === h)) { selected = ZONE_ORDER.indexOf(h); show("zone", h); }
    } else if (h === "") {
      if (current !== "title") show("title");
    }
  }

  // ---------- boot ----------
  Sound.refreshButtons(); // everything starts OFF
  placeCallouts();
  routeFromHash();
  window.addEventListener("hashchange", routeFromHash);
  window.addEventListener("popstate", routeFromHash);
})();
