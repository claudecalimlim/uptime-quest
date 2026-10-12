/*
 * Small shared helpers for the zones.
 * Each zone registers itself as window.Zones.<id> = { title, mount(stage), unmount() }.
 */
(function () {
  window.Zones = window.Zones || {};

  function icon(name) { return "assets/icons/" + name + ".png"; }

  // h("div", {class: "x", onclick: fn}, child, "text", ...)
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
  }

  function img(name, cls, alt) { return h("img", { src: icon(name), class: cls || "", alt: alt || "" }); }

  // Timers that belong to one zone, so leaving the zone stops everything.
  function scope() {
    var timeouts = [], intervals = [], frames = [], alive = true;
    return {
      after: function (ms, fn) { var id = setTimeout(function () { if (alive) fn(); }, ms); timeouts.push(id); return id; },
      every: function (ms, fn) { var id = setInterval(function () { if (alive) fn(); }, ms); intervals.push(id); return id; },
      frame: function (fn) {
        var last = performance.now();
        function loop(now) {
          if (!alive) return;
          var dt = Math.min(0.1, (now - last) / 1000); last = now;
          fn(dt, now);
          frames.push(requestAnimationFrame(loop));
        }
        frames.push(requestAnimationFrame(loop));
      },
      cancel: function (id) { clearTimeout(id); clearInterval(id); },
      clear: function () {
        alive = false;
        timeouts.forEach(clearTimeout); intervals.forEach(clearInterval); frames.forEach(cancelAnimationFrame);
        timeouts = []; intervals = []; frames = [];
      }
    };
  }

  // minutes -> "8 h", "45 min", "30 sec"
  function duration(min) {
    if (min <= 0) return "0 sec";
    if (min < 1) return Math.max(1, Math.round(min * 60)) + " sec";
    if (min < 60) return Math.round(min) + " min";
    var hrs = Math.floor(min / 60), m = Math.round(min % 60);
    return hrs + " h" + (m ? " " + m + " min" : "");
  }

  function clock(min) {
    var totalSec = Math.round(min * 60);
    var hh = Math.floor(totalSec / 3600), mm = Math.floor((totalSec % 3600) / 60), ss = totalSec % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(hh) + ":" + p(mm) + ":" + p(ss);
  }

  function coins(n, max) {
    var wrap = h("span", { class: "coins", title: n + " of " + max });
    for (var i = 0; i < max; i++) wrap.appendChild(img("ui_coin", i < n ? "coin on" : "coin off"));
    return wrap;
  }

  window.UQ = { icon: icon, h: h, img: img, scope: scope, duration: duration, clock: clock, coins: coins };
})();
