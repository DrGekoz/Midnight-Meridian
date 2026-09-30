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
function setTheme(themeId, seasonId, opts){
  const o = opts || {};
  const T = resolveTheme(themeId, seasonId || (typeof UI !== "undefined" && UI.season) || "summer");
  ACTIVE_THEME = T;
  applyTheme(T);
  buildThemeStrips(T);
  /* Music follows the style; only parameters change, never the graph. */
  Audio_.setStyle(T.music);
  Audio_.setVerb(T.music.wet);
  /* Ambient bus: one clip per weather, one per season/daylight. */
  if (typeof AUDIO_B64 !== "undefined" && AUDIO_B64){
    const rainSlug = T.weather === "rain" ? "rain" : (T.weather === "snow" ? "snow" : null);
    const ambSlug  = T.tod === "day"
        ? (T.season === "Winter" ? "wind" : "birds")
        : (T.style === "cyberpunk" ? "city" : (T.season === "Winter" ? "snow" : "crickets"));
    Audio_.playRain(rainSlug);
    Audio_.playAmb(ambSlug);
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
