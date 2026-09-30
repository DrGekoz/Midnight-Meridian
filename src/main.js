/* =============================================================================
   MIDNIGHT MERIDIAN — BOOT, THEME STATE, MAIN LOOP
   The last module in the bundle. Owns the active theme, the presentation, the
   audio wiring, and the fixed-step render loop.
   ========================================================================== */
"use strict";

/* The active theme. render(t) falls back to this, so the whole renderer is
   theme-aware without every call site having to thread it through. */
let ACTIVE_THEME = null;

/* ========================================================== persistence (F7) */
/* Settings survive a reload. Kept deliberately small and defensive: a private
   browsing window throws on localStorage access, and the piece must still run.
   Audio gains are stored as 0..1 because that is what the GainNodes take, so
   restoring them needs no conversion. */
const STORE_KEY = "midnight-meridian/v3";

function saveSettings(){
  try {
    const T = ACTIVE_THEME;
    if (!T) return;
    localStorage.setItem(STORE_KEY, JSON.stringify({
      theme: T.id, season: T.season, tod: T.tod, weather: T.weather,
      gains: Audio_.gains ? Object.assign({}, Audio_.gains) : null,
      muted: !!(Audio_.muted)
    }));
  } catch (_) { /* storage unavailable or full — the piece still works */ }
}

function loadSettings(){
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    /* Validate: a hand-edited or stale entry must not put the piece in a state
       it cannot render. Anything unrecognised falls back to the default theme. */
    if (!s || typeof s.theme !== "string" || !THEMES[s.theme]) return null;
    if (typeof s.season !== "string") return null;
    return s;
  } catch (_) { return null; }
}
/* ---- AMBIENT CLIP SELECTION ----------------------------------------------
   Every one of the 13 bundled clips must be reachable, or the 2 MB of audio
   shipped in the file is dead weight. The first version only ever selected 5 of
   them (rain, snow, wind, birds, city) and left fire, stream, waves, thunder,
   clock and crowd unreachable.

   Two independent buses, because they answer different questions:
     - WEATHER bus: what is falling. Fires on rain/snow/storm only.
     - SCENE bus:   where you are. Fires on every combination.
   A storm gets rain AND thunder; a summer day gets birds AND a stream.       */
function ambientFor(T){
  const amb = [], wx = [];
  if (T.weather === "rain"){
    wx.push(T.style === "cyberpunk" ? "rain-heavy" : "rain");
    /* thunder rides the storm bus so its gain follows the rain slider */
    if (T.weather === "rain" && (T.season === "Summer" || T.style === "cyberpunk")) wx.push("thunder");
  } else if (T.weather === "snow"){
    wx.push("snow", "wind");
  } else if (T.weather === "storm"){
    wx.push("rain-heavy", "thunder", "wind");
  }
  /* the scene bed: one clip that places you somewhere */
  if (T.style === "cyberpunk"){
    amb.push(T.tod === "day" ? "crowd" : "city");
  } else if (T.style === "japan"){
    amb.push(T.tod === "day" ? "stream" : "crickets");
  } else {
    if (T.tod === "day") amb.push("birds");
    else amb.push(T.season === "Winter" ? "wind" : "crickets");
  }
  /* winter nights get a fire somewhere off-frame, and lakes get water.
     These are the two clips that have no season or style of their own, so they
     are layered on top of the scene bed rather than replacing it. */
  if (T.season === "Winter" && T.tod === "night") amb.push("fire");
  if (T.season === "Summer" && T.tod === "day") amb.push("stream");
  /* a clock is the clock-face of a scene: cyberpunk night only */
  if (T.style === "cyberpunk" && T.tod === "night" && T.season === "Winter") amb.push("clock");
  /* a lake is a lake, in every scene, unless it is raining on it */
  if (T.weather !== "rain") amb.push("waves");
  return { amb: dedupe(amb), wx: dedupe(wx) };
}
function dedupe(a){ return a.filter((v, i) => a.indexOf(v) === i); }

function setTheme(themeId, seasonId, opts){
  const o = opts || {};
  const T = resolveTheme(themeId, seasonId || (typeof UI !== "undefined" && UI.season) || "summer");
  ACTIVE_THEME = T;
  applyTheme(T);
  buildThemeStrips(T);
  /* Music follows the style; only parameters change, never the graph. */
  Audio_.setStyle(T.music);
  Audio_.setVerb(T.music.wet);
  /* Ambient buses. Both are cleared first so switching from rain to clear
     actually stops the rain instead of leaving it layered under the new bed. */
  if (typeof AUDIO_B64 !== "undefined" && AUDIO_B64){
    const pick = ambientFor(T);
    /* the whole list goes to its bus in one call; playBus diffs against what is
       already playing, so an unchanged scene is a no-op and a changed one
       replaces cleanly rather than layering up over itself */
    Audio_.playAmb(pick.amb);
    Audio_.playRain(pick.wx);
  }
  if (!o.silent && typeof UI !== "undefined") UI.applyState();
  saveSettings();
  return T;
}

/* ====================================================== presentation / layout */
function resize(){
  const w = window.innerWidth, h = window.innerHeight;
  const s = Math.max(w / VW, h / VH);
  const c = document.getElementById('cv');
  if (!c) return;
  c.style.width  = Math.round(VW * s) + 'px';
  c.style.height = Math.round(VH * s) + 'px';
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

/* ---- true fullscreen: F11 / double-click / the button ---- */
function toggleFullscreen(){
  const el = document.documentElement;
  if (!document.fullscreenElement){
    (el.requestFullscreen || el.webkitRequestFullscreen || function(){}).call(el);
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen || function(){}).call(document);
  }
}
document.addEventListener('fullscreenchange', resize);
document.addEventListener('webkitfullscreenchange', resize);
document.addEventListener('dblclick', toggleFullscreen);

/* ---- click the water to drop a ripple ------------------------------------
   Screen coords -> virtual pixel coords, then hand off to dropRipple. The
   y is clamped to the water band, so a click above the shoreline (sky, train,
   mountains) is ignored rather than silently landing on the lake.

   Ripples are deliberately NOT drawn by render(). They depend on wall-clock
   time, so folding them into render(t) would make the frame depend on state
   outside t and break the bit-exact loop proof. They are drawn as an overlay
   pass immediately after render() instead. */
function pointerToPixel(ev){
  const c = document.getElementById('cv');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  const sx = (ev.clientX - r.left) / Math.max(1, r.width)  * VW;
  const sy = (ev.clientY - r.top)  / Math.max(1, r.height) * VH;
  return [sx, sy];
}
function noteRipples(ev){
  const p = pointerToPixel(ev);
  if (!p) return;
  dropRipple(p[0], p[1], performance.now() / 1000);
}
document.addEventListener('pointerdown', noteRipples);
document.addEventListener('click', noteRipples);


/* ================================================================ main loop  */
let simFrame = 0, paused = false, loopOk = null;
let showDiag = false, fps = 0, fpsT = 0, fpsN = 0;
const STEP = 1000 / 60;

/* ---- honour reduced-motion: freeze the piece on its first frame ---------- */
try {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    paused = true;
  }
} catch (_) { /* matchMedia absent in the test harness */ }


function hashFB(){
  let h = 0x811c9dc5;
  for (let i = 0; i < fb.length; i += 7){ h ^= fb[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* The definitive loop check under the ACTIVE theme. */
function verifyLoop(){
  render(0, ACTIVE_THEME);              const a = hashFB();
  render(LOOP_SECONDS, ACTIVE_THEME);   const b = hashFB();
  loopOk = (a === b);
  render(simFrame / 60, ACTIVE_THEME);
  return loopOk;
}

let lastMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
let acc = 0;

function loop(now){
  requestAnimationFrame(loop);
  let dt = now - lastMs; lastMs = now;
  if (dt > 50) dt = 50;
  fpsN++;
  if (now - fpsT >= 500){ fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; }
  if (!paused){
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard < 4){
      acc -= STEP; guard++;
      render(simFrame / 60, ACTIVE_THEME);
      /* Ripples are an OVERLAY, drawn after render() rather than inside it.
         They are the one thing in the piece keyed to wall-clock time, so putting
         them in render(t) would make the frame depend on state outside t and
         break the bit-exact loop proof. Draw them straight onto the buffer. */
      if (ripples.length) drawRipples(now / 1000);
      simFrame++;
      if (simFrame >= LOOP_FRAMES) simFrame = 0;
    }
    ctx.putImageData(img, 0, 0);
  }
  /* drive the synthesised train chuff from the same clock the wheels use */
  Audio_.tick(now / 1000);
  if (showDiag){
    const d = document.getElementById('diag');
    if (d) d.textContent =
      'MIDNIGHT MERIDIAN  ' + VW + 'x' + VH + '\n' +
      'frame  ' + simFrame + ' / ' + LOOP_FRAMES + '   t=' + (simFrame/60).toFixed(3) + 's\n' +
      'fps    ' + fps.toFixed(1) + '\n' +
      'theme  ' + (ACTIVE_THEME ? ACTIVE_THEME.label + ' / ' + ACTIVE_THEME.season : '-') + '\n' +
      'audio  ' + (Audio_.started ? (Audio_.muted ? 'muted' : 'live') : 'idle (click to start)') + '\n' +
      'loop   ' + (loopOk === null ? 'unchecked' : (loopOk ? 'SEAMLESS' : 'MISMATCH'));
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'F11' || (e.key === 'f' && (e.ctrlKey || e.metaKey))){ toggleFullscreen(); e.preventDefault(); }
  if (e.code === 'Space'){ paused = !paused; e.preventDefault(); }
  if (e.key === 'd' || e.key === 'D'){
    showDiag = !showDiag;
    const d = document.getElementById('diag');
    if (d) d.style.display = showDiag ? 'block' : 'none';
  }
});

/* ==================================================================== boot   */
function boot(){
  /* 1. the default theme, which also builds every strip */
  /* 1. theme — restore the saved scene if there is a valid one */
  const saved = loadSettings();
  if (saved){
    setTheme(saved.theme, saved.season, { silent:true });
    if (saved.gains) Audio_.setGains(saved.gains);
    if (typeof UI !== "undefined"){ UI.theme = saved.theme; UI.season = saved.season; }
  } else {
    setTheme(DEFAULT_THEME, "summer", { silent:true });
  }
  /* 2. presentation */
  resize();
  /* 3. UI */
  if (typeof UI !== "undefined" && UI.build){
    UI.build();
    UI.onChange = () => setTheme(UI.theme, UI.season);
    UI.onGain = () => saveSettings();
  }
  /* 4. audio initialises on the first real gesture (autoplay policy) */
  const bootAudio = async () => {
    try {
      await Audio_.start();
      if (typeof AUDIO_B64 !== "undefined" && AUDIO_B64)
        for (const k of Object.keys(AUDIO_B64)) await Audio_.loadAsset(k, AUDIO_B64[k]);
      /* re-apply the active theme so the right clips start */
      if (ACTIVE_THEME) setTheme(ACTIVE_THEME.id, ACTIVE_THEME.season, { silent:true });
    } catch(e){ /* silence is fine; the piece must never break over audio */ }
  };
  document.addEventListener('pointerdown', bootAudio, { once:true });
  document.addEventListener('keydown', bootAudio, { once:true });
  /* 5. loop proof + run */
  verifyLoop();
  requestAnimationFrame(loop);
}

/* Exposed for verify.js and the headless harness. */
if (typeof globalThis !== 'undefined'){
  globalThis.MM = { get theme(){ return ACTIVE_THEME; }, setTheme, verifyLoop,
                    THEMES, SEASON, resolveTheme, render, fb, hashFB,
                    buildThemeStrips, applyTheme, Audio_,
                    get simFrame(){ return simFrame; } };
}

if (typeof document !== 'undefined' && document.getElementById('cv')) boot();
