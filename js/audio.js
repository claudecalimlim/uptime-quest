/*
 * Sound for Uptime Quest.
 * - BGM: the music file, looped.
 * - SFX: generated 8-bit beeps (no audio files needed).
 * Both start OFF every time the page opens, so the buttons always match what you hear.
 * The manual lives in the same page, so music keeps playing while you read it.
 */
(function () {
  var BGM_SRC = "assets/audio/bgm.mp3";
  var BGM_VOLUME = 0.45;

  var state = { bgm: false, sfx: false };
  var bgm = null;
  var ctx = null;

  function getBgm() {
    if (!bgm) {
      bgm = new Audio(BGM_SRC);
      bgm.loop = true;
      bgm.preload = "auto";
      bgm.volume = BGM_VOLUME;
    }
    return bgm;
  }

  function getCtx() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // one 8-bit tone: frequency (Hz), start offset (s), duration (s)
  function tone(freq, at, dur, opts) {
    var c = getCtx();
    if (!c) return;
    opts = opts || {};
    var t0 = c.currentTime + at;
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = opts.type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    var vol = opts.vol || 0.08;
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function arp(notes, step, opts) {
    notes.forEach(function (f, i) { tone(f, i * step, step * 1.6, opts); });
  }

  var effects = {
    move:    function () { tone(660, 0, 0.06, { slideTo: 880 }); },
    select:  function () { arp([523, 659, 784], 0.06); },
    back:    function () { tone(440, 0, 0.14, { slideTo: 220 }); },
    start:   function () { arp([392, 523, 659, 784, 1046], 0.07); },
    type:    function () { tone(1200 + Math.random() * 300, 0, 0.02, { vol: 0.03 }); },
    error:   function () { tone(160, 0, 0.3, { type: "sawtooth", vol: 0.07 }); },
    success: function () { arp([523, 659, 784, 1046], 0.09, { vol: 0.07 }); },
    alarm:   function () {
      for (var i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, i * 0.16, 0.15, { vol: 0.06 });
    },
    coin:    function () { tone(988, 0, 0.07); tone(1319, 0.07, 0.25); }
  };

  // Point every [data-toggle="bgm"|"sfx"] button at the current state.
  function refreshButtons() {
    ["bgm", "sfx"].forEach(function (kind) {
      var on = state[kind];
      document.querySelectorAll('[data-toggle="' + kind + '"]').forEach(function (btn) {
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        var im = btn.querySelector("img");
        if (im) im.src = on ? "assets/icons/ui_sound_on.png" : "assets/icons/ui_sound_off.png";
        var sp = btn.querySelector("span");
        if (sp) sp.textContent = kind.toUpperCase() + (on ? " ON" : " OFF");
        btn.title = (on ? "Turn off " : "Turn on ") + (kind === "bgm" ? "background music" : "sound effects");
      });
    });
  }

  window.Sound = {
    isOn: function (kind) { return state[kind]; },
    musicPlaying: function () { return !!(bgm && !bgm.paused); },
    musicTime: function () { return bgm ? bgm.currentTime : 0; },
    refreshButtons: refreshButtons,

    // Called from a click or key press (browsers block sound otherwise).
    toggle: function (kind) {
      state[kind] = !state[kind];
      if (kind === "bgm") {
        if (state.bgm) {
          getBgm().play().catch(function () {
            // the browser refused to play: show the real state instead of a false "ON"
            state.bgm = false;
            refreshButtons();
          });
        } else if (bgm) {
          bgm.pause();
        }
      }
      if (kind === "sfx" && state.sfx) effects.coin();
      refreshButtons();
      return state[kind];
    },

    sfx: function (name) {
      if (!state.sfx || !effects[name]) return;
      try { effects[name](); } catch (e) {}
    }
  };
})();
