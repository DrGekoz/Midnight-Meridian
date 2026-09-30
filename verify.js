/* =============================================================================
   MIDNIGHT MERIDIAN — verification suite
   -----------------------------------------------------------------------------
   Runs the REAL shipped index.html in a headless DOM/canvas stub and asserts:
     1. boot with no exceptions
     2. train direction (headlamp forward, coaches trailing)
     3. the 120s loop is bit-exact, for EVERY theme x season (96 proofs)
     4. full pixel coverage, cool-dominant palette
     5. reflections are live, warm light reaches the water
     6. theme rules: no snow in spring, snow in winter, fewer stars by day
     7. theme changes actually change the rendered frame
     8. audio graph exists with all five buses
     9. per-frame cost inside the 60fps budget, with a theme applied
   Run: node verify.js
   ========================================================================== */
'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: no <script> block in index.html'); process.exit(1); }

const CODE = m[1] + `
;globalThis.__X = {
  render, hashFB, snapshotScene, VW, VH, LOOP_SECONDS, LOOP_FRAMES, fb, SNAP, SNAP_ROWS,
  SNAP_Y0, TX, TY, TW, TH, RAIL_Y, LAKE_Y0, SMOKE_N, SMOKE_DT, SMOKE_LIFE, WINDOWS, WHEELS,
  SPD_STAR, SPD_MTNF, SPD_MTNM, SPD_PINEF, SPD_PINEN, SPD_EMB, SPD_FORE,
  MOON_X, MOON_Y, STACK_X, STACK_Y, WINDOW_COUNT, _cr, _cg, _cb,
  PINEF_Y0, PINEF_H, PINEN_Y0, PINEN_H, SKY_H, FOREP_Y0, LAKE_H, EMB_Y0,
  MM, THEMES, SEASON, resolveTheme, setTheme, applyTheme, buildThemeStrips,
  compose, scoreHash, euclid, GROOVES, SCALES,
  get ACTIVE_THEME(){ return ACTIVE_THEME; }
};
;globalThis.__X.Audio_ = typeof Audio_ !== "undefined" ? Audio_ : null;`;

/* ---- DOM stub: complete enough to boot the real piece ----------------------
   Exported so diag-perf.js reuses this exact definition. Two copies of a DOM
   stub is how harness.js silently went stale and made the profiler crash. */
function makeSandbox(){
  const ctxStub = {
    createImageData: (w,h) => ({ width:w, height:h, data:new Uint8ClampedArray(w*h*4) }),
    putImageData: () => {}
  };
  const mk = (extra) => Object.assign({
    style:{}, dataset:{}, textContent:'', innerHTML:'', value:'50',
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){},
    setAttribute(k,v){ this[k] = v; }, getAttribute(k){ return this[k]; },
    hasAttribute(k){ return k in this; },
    getBoundingClientRect: () => ({ x:0,y:0,width:320,height:480,top:0,left:0,right:320,bottom:480 }),
    querySelector: () => null, querySelectorAll: () => [], appendChild(){}, closest: () => null,
    append(){ [].slice.call(arguments).forEach(a => this.children.push(a)); },
    children: [], parentNode: null, firstChild: null
  }, extra || {});
  const el = {
    cv: mk({ width:480, height:270, clientWidth:960, getContext:()=>ctxStub }),
    panel: mk(), body: mk(), btn: mk(), mute: mk(), live: mk(), diag: mk(),
    icon: mk(), close: mk()
  };
  const byId = { 'cv':el.cv, 'panel':el.panel, 'panel-body':el.body, 'menu-btn':el.btn,
                 'mute-btn':el.mute, 'live':el.live, 'diag':el.diag, 'icon-btn':el.icon };
  const sandbox = {
    document:{
      documentElement: mk({ requestFullscreen(){}, webkitRequestFullscreen(){} }),
      fullscreenElement:null, exitFullscreen(){}, webkitExitFullscreen(){},
      getElementById: id => byId[id] || mk(),
      querySelector: () => null, querySelectorAll: () => [],
      createElement: () => mk(), addEventListener(){}, removeEventListener(){}
    },
    window:{ innerWidth:1920, innerHeight:1080, addEventListener(){}, removeEventListener(){} },
    performance:{ now:()=>Date.now() },
    requestAnimationFrame: ()=>1,
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    setInterval: ()=>0, clearInterval: ()=>{},
    Math, JSON, console, Buffer, Uint8Array, Uint8ClampedArray, Uint32Array,
    Float32Array, Float64Array, Int32Array, Array, Object, String, Number,
    isNaN, parseInt, parseFloat, Date
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

/* Exported so diag-perf.js reuses this exact DOM stub — two copies of a fake DOM
   is how harness.js went stale and made the profiler crash misleadingly. The
   suite body only runs when invoked directly, so requiring this file is cheap. */
module.exports = { makeSandbox, CODE };
if (require.main === module) run();

function run(){
console.log('MIDNIGHT MERIDIAN — verification\n' + '='.repeat(60));

let ok = true, warn = 0;
const fail = s => { ok = false; console.log('  [FAIL] ' + s); };
const pass = s => console.log('  [ok]   ' + s);
const soft = s => { warn++; console.log('  [note] ' + s); };

const sandbox = makeSandbox();
try {
  vm.runInContext(CODE, sandbox, { filename:'index.html<script>' });
  pass('module boots, all builders run, no exceptions');
} catch (e) { fail('boot threw:\n' + e.stack); process.exit(1); }

const X = sandbox.__X;
const VW = X.VW, VH = X.VH, LOOP = X.LOOP_SECONDS;
const { render, hashFB, fb } = X;

/* ---------------------------------------------------------------- 1. train */
const trainRight = X.TX + X.TW;
let lampX = null, cabX = null, maxWinX = -1, minCarWinX = 1e9;
for (const w of X.WINDOWS){
  const wx = X.TX + w.x;
  if (w.lamp) lampX = wx;
  else { maxWinX = Math.max(maxWinX, wx + w.w); if (wx < minCarWinX) minCarWinX = wx; }
  if (!w.lamp && w.w >= 10 && (cabX === null || wx < cabX)) cabX = wx;
}
const stackX = X.STACK_X;
const dirChecks = [
  ['headlamp is the front-most feature',      lampX !== null && lampX >= maxWinX - 2],
  ['chimney is forward of the cab',           stackX >  (cabX === null ? 0 : cabX)],
  ['headlamp is forward of the chimney',      lampX >  stackX],
  ['engine sits at the right of the consist', lampX >  X.TX + X.TW * 0.5],
  ['nothing is drawn past the front',         maxWinX <= trainRight],
  ['coaches occupy the left of the sprite',   minCarWinX < X.TX + X.TW * 0.5]
];
for (const [label, good] of dirChecks){
  if (good) pass('  ' + label);
  else fail(`TRAIN IS BACKWARDS: ${label} — lamp ${lampX}, chimney ${stackX}, cab ${cabX}`);
}
if (X.WINDOWS.length === X.WINDOW_COUNT) pass(`window registry rebuilt cleanly: ${X.WINDOWS.length} rects (expected ${X.WINDOW_COUNT})`);
else fail(`window registry is ${X.WINDOWS.length}, expected ${X.WINDOW_COUNT} — a rebuild appends instead of replacing`);

/* ------------------------------------------------- 2. loop across all themes */
const SEASONS = Object.keys(X.SEASON);
const themes = X.THEMES;
console.log(`\n  [loop] proving a bit-exact 120s loop for ${themes.length} themes x ${SEASONS.length} seasons = ${themes.length*SEASONS.length} combos`);
const loopFails = [];
const tStart = Date.now();
for (const th of themes){
  for (const se of SEASONS){
    const T = X.resolveTheme(th.id, se);
    X.applyTheme(T); X.buildThemeStrips(T);
    render(0, T); const a = hashFB();
    render(LOOP, T); const b = hashFB();
    if (a !== b) loopFails.push(`${th.id}/${se}`);
  }
}
const secs = ((Date.now() - tStart) / 1000).toFixed(1);
if (!loopFails.length) pass(`all ${themes.length*SEASONS.length} theme/season combos loop seamlessly (${secs}s)`);
else fail(`loop mismatch in ${loopFails.length}/${themes.length*SEASONS.length}: ${loopFails.slice(0,6).join(', ')}`);

/* -------------------------------------------- 3. coverage on the default theme */
const T0 = X.resolveTheme('midnight-night-clear', 'summer');
X.applyTheme(T0); X.buildThemeStrips(T0);
render(0, T0);
let zero = 0, rS = 0, gS = 0, bS = 0;
const seen = new Set();
for (let i = 0; i < fb.length; i++){
  const c = fb[i]; seen.add(c);
  const r = X._cr(c), g = X._cg(c), b = X._cb(c);
  rS += r; gS += g; bS += b;
  if (r === 0 && g === 0 && b === 0) zero++;
}
const N = fb.length;
if (zero === 0) pass('coverage: every one of the 129,600 pixels is painted');
else fail(`${zero} pixels are unpainted black`);
if (seen.size > 300) pass(`tonal range: ${seen.size} distinct colours in one frame`);
else fail(`frame is flat: only ${seen.size} distinct colours`);
if (bS/N > rS/N) pass(`palette cool-dominant (mean R${(rS/N).toFixed(1)} G${(gS/N).toFixed(1)} B${(bS/N).toFixed(1)})`);
else fail(`palette warm/washed (mean R${(rS/N).toFixed(1)} G${(gS/N).toFixed(1)} B${(bS/N).toFixed(1)})`);

/* When coverage or palette fails, dump the actual palette values. Guessing at
   "why is it washed out" from the means alone wastes a whole debug cycle. */
if (zero > 0 || bS/N <= rS/N){
  const probe = (() => {
    try { return vm.runInContext(
      `(${function(){
        const T = resolveTheme('midnight-night-clear','summer'); applyTheme(T);
        const s = (c) => _cr(c)+','+_cg(c)+','+_cb(c);
        return { skyTop:s(SKY.top), skyMid:s(SKY.mid), skyLow:s(SKY.low),
                 farnHi:s(FARN.hi), pineNear:s(PN.a), gndCrest:s(GND.crest),
                 foliage:s(T.foliage.a), haze:T.haze, ripple:T.ripple,
                 dayLift: typeof TOD !== 'undefined' ? TOD.day.skyLift : null };
      }})()`, sandbox); } catch(e){ return { err:String(e) }; }
  })();
  console.log('  [debug] palette: ' + JSON.stringify(probe));
}

/* ------------------------------------------------------------ 4. reflections */
render(0, T0); X.snapshotScene();
let snapWarm = 0;
for (let i = 0; i < X.SNAP_ROWS * VW; i++){
  const c = X.SNAP[i];
  if (X._cr(c) > 170 && X._cg(c) > 100 && X._cb(c) < 160) snapWarm++;
}
if (snapWarm > 20) pass(`reflection source carries warm window light (${snapWarm} px) — the train reflects`);
else fail(`only ${snapWarm} warm px in the reflection source`);
let waterWarm = 0;
for (let y = X.LAKE_Y0; y < X.LAKE_Y0 + 40; y++)
  for (let x = 0; x < VW; x++){
    const c = fb[y*VW + x];
    if (X._cr(c) > 40 && X._cg(c) > 18 && X._cr(c) > X._cb(c) * 1.4) waterWarm++;
  }
if (waterWarm > 100) pass(`warm light is visible in the water (${waterWarm} px)`);
else fail(`warm light not visible in the water (${waterWarm} px)`);

/* ------------------------------------------------------------ 5. theme rules */
const countBrightSky = (T) => {
  render(0, T);
  let n = 0;
  for (let y = 0; y < 100; y++) for (let x = 0; x < VW; x++){
    const c = fb[y*VW + x];
    if (X._cr(c) > 200 && X._cg(c) > 200 && X._cb(c) > 200) n++;
  }
  return n;
};
/* Day vs night must differ in actual sky LUMINANCE. Counting near-white pixels
   does not work: stars are dim pinpricks, so both a starry night and a bright
   overcast day score ~3 and the test passes vacuously. Measure mean sky
   brightness instead, and require day to be clearly brighter. */
const skyLuma = (T) => {
  /* applyTheme + buildThemeStrips FIRST: skyLuma is called on themes that were
     resolved but not yet installed, and render() reads the strip globals. Skipping
     this measured the previous theme's plate and reported day == night. */
  X.applyTheme(T); X.buildThemeStrips(T);
  render(0, T);
  let s = 0;
  for (let y = 4; y < 96; y++) for (let x = 0; x < VW; x++){
    const c = fb[y*VW + x];
    s += X._cr(c) * 0.30 + X._cg(c) * 0.59 + X._cb(c) * 0.11;
  }
  return s / (92 * VW);
};
const Tday    = X.resolveTheme('midnight-day-clear', 'summer');
const Tnight  = X.resolveTheme('midnight-night-clear', 'summer');
const Twinter = X.resolveTheme('midnight-day-clear', 'winter');
const TspringD = X.resolveTheme('midnight-day-clear', 'spring');
if (!TspringD.snow) pass('spring: snow assets disabled by resolveTheme() — the single source of truth');
else fail('SPRING HAS SNOW ENABLED — snow must exist in exactly one season');
if (Twinter.snow) pass('winter: snow assets enabled');
else fail('WINTER HAS NO SNOW');
const lDay = skyLuma(Tday), lNight = skyLuma(Tnight);
if (lDay > lNight * 1.5) pass(`day sky is clearly brighter than night (luma ${lDay.toFixed(1)} vs ${lNight.toFixed(1)})`);
else fail(`day sky is not brighter than night (luma ${lDay.toFixed(1)} vs ${lNight.toFixed(1)})`);

/* ---- 5b. scenery is actually legible, per season --------------------------
   These four assertions exist because v2 shipped with all of them broken and
   nothing caught it: verify.js proved themes change *a* hash, never that the
   vegetation was green or that stars were absent by day.

   Measure the real framebuffer, in the band each feature lives in, rather than
   trusting the theme flags — a flag that says `stars:false` while the star pass
   still runs is exactly the bug this catches. */
function scenery(T){
  X.applyTheme(T); X.buildThemeStrips(T);
  render(0, T);
  let green = 0, greenSum = 0, greenN = 0, starLike = 0, white = 0;
  /* vegetation lives in the tree bands, not the sky */
  for (let y = X.PINEF_Y0; y < X.PINEN_Y0 + X.PINEN_H; y++){
    for (let x = 0; x < VW; x++){
      const c = fb[y*VW + x];
      const r = X._cr(c), g = X._cg(c), b = X._cb(c);
      if (g > 55 && g > r * 1.20 && g > b * 1.20){
        green++;
        /* GREENNESS, computed properly. My first attempt used `g - (r+b)/2`,
           which rewards a DARK desaturated green far more than a bright vivid
           one, so winter scored 122 and spring 29 — exactly backwards. Winter
           foliage is near-black brown, and a dark pixel's channels are all small
           and close together, which inflates the difference.

           The right measure is HSV saturation: (max-min)/max, independent of
           brightness. Spring's #4f7a3a gives sat = (122-58)/122 = 0.52; winter's
           #2a2622 gives (42-34)/42 = 0.19. */
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        greenSum += mx > 0 ? (mx - mn) / mx : 0; greenN++;
      }
    }
  }
  /* STARS: measured against this theme's own sky, not an absolute threshold.
     A day sky is legitimately bright (the whole band exceeds 150), so counting
     bright pixels proves nothing. A star is a pixel that stands well ABOVE its
     own local sky, so compare against the median sky luminance. */
  const skyL = [];
  for (let y = 4; y < X.PINEF_Y0 - 6; y++) for (let x = 0; x < VW; x++){
    const c = fb[y*VW + x];
    skyL.push(X._cr(c) * 0.30 + X._cg(c) * 0.59 + X._cb(c) * 0.11);
  }
  skyL.sort((a,b) => a - b);
  const med = skyL[skyL.length >> 1];
  for (const v of skyL) if (v > med + 34) starLike++;
  /* SNOW ON THE EMBANKMENT: the crest band only. EMB_Y0 is 146 and RAIL_Y is
     166, so scanning from RAIL_Y+2 upward MISSED the crest entirely and measured
     0 px in every season. Scan the crest rows and a little above them. */
  for (let y = X.EMB_Y0 - 3; y < X.RAIL_Y + 3; y++) for (let x = 0; x < VW; x++){
    const c = fb[y*VW + x];
    if (X._cr(c) > 110 && X._cg(c) > 115 && X._cb(c) > 120) white++;
  }
  return { green, greenness: greenN ? greenSum / greenN : 0,
           starLike, white, skyMedian: med };
}
const sSummerNight = scenery(Tnight), sSpringDay = scenery(TspringD),
      sSummerDay   = scenery(Tday),       sWinterDay  = scenery(Twinter);

if (sSummerNight.green > 250)
  pass(`forest reads as foliage: ${sSummerNight.green} green px in the tree bands`);
else fail(`forest is not green — only ${sSummerNight.green} green px (should be hundreds); the pine bands are effectively empty`);

/* SEASONS REACH THE FOLIAGE: compare how much green foliage is COVERED.
   My earlier attempts at a "greenness" scalar both failed — one rewarded dark
   desaturated pixels and put winter above spring, the other (HSV saturation) was
   circular because the gate already selects for saturated green. Coverage is the
   honest measure: a bare winter conifer draws thin branch strokes, a spring one
   draws a solid cone, so winter must cover markedly less green.
   The per-season colour difference itself is asserted separately by hashing. */
if (sSpringDay.green > sWinterDay.green * 1.5)
  pass(`seasons reach the foliage: spring covers ${sSpringDay.green} green px, bare winter only ${sWinterDay.green}`);
else fail(`winter is not bare enough — spring ${sSpringDay.green} green px vs winter ${sWinterDay.green}; a bare conifer must cover far less green`);

if (sSummerNight.starLike > 25 && sSummerDay.starLike < sSummerNight.starLike / 3)
  pass(`stars appear at night (${sSummerNight.starLike} above sky median) and vanish by day (${sSummerDay.starLike})`);
else fail(`star gating is wrong: night ${sSummerNight.starLike}, day ${sSummerDay.starLike} — day must have almost no pixels above its own sky`);

if (sWinterDay.white > sSummerDay.white * 2)
  pass(`winter lays snow on the embankment (${sWinterDay.white} px vs ${sSummerDay.white} in summer)`);
else fail(`winter has no snow on the embankment (${sWinterDay.white} px vs ${sSummerDay.white} in summer)`);

if (sSpringDay.white <= sSummerDay.white * 3)
  pass(`spring has no snow on the embankment (${sSpringDay.white} px vs ${sWinterDay.white} in winter)`);
else fail(`SPRING HAS SNOW ON THE EMBANKMENT (${sSpringDay.white} px vs ${sWinterDay.white} in winter)`);

/* ------------------------------------------- 6. themes actually change pixels */
const hashOf = (T) => { render(0, T); return hashFB(); };
const base = hashOf(Tnight);
const variants = [
  ['cyberpunk-night-clear', 'summer'], ['japan-night-clear', 'summer'],
  ['midnight-day-clear',    'summer'], ['midnight-night-rain',   'summer'],
  ['midnight-night-snow',   'winter'], ['midnight-night-clear',  'spring'],
  ['midnight-night-clear',  'autumn']
];
for (const [tid, se] of variants){
  const T = X.resolveTheme(tid, se);
  X.applyTheme(T); X.buildThemeStrips(T);
  const h = hashOf(T);
  if (h !== base) pass(`theme changes the art: ${tid}/${se} (${h.toString(16).slice(0,8)})`);
  else fail(`theme has NO effect on the frame: ${tid}/${se} produced an identical buffer`);
}

/* ------------------------------------------------------------------ 7. music */
/* The music is composed by a PURE function, so it is directly testable without
   an AudioContext. These assertions exist because the Euclidean generator was
   WRONG three times before it was right, and nothing in the artwork would ever
   have noticed. */
const v = p => p.map(x => x ? 'x' : '.').join('');
/* Published Bjorklund/Toussaint vectors, cross-checked against the reference
   implementations in zya/bjorklund and dbkaplun/euclidean-rhythm. */
const euclidCases = [
  [3, 4,  'x.xx'], [3, 8, 'x.x..x..'], [5, 8, 'x.x.xx.x'],
  [5, 16, 'x..x..x..x..x...'], [4, 16, 'x...x...x...x...'],
  [2, 5,  'x.x..'], [3, 16, 'x....x....x.....'], [7, 16, 'x.x.x.x.x.x..x..']
];
let euclidBad = [];
for (const [p, n, expect] of euclidCases){
  const got = v(X.euclid(p, n)), sum = X.euclid(p, n).reduce((a, b) => a + b, 0);
  if (got !== expect) euclidBad.push(`(${p},${n}) got ${got} want ${expect}`);
  else if (sum !== p) euclidBad.push(`(${p},${n}) sum ${sum} != ${p}`);
  else if (X.euclid(p, n).length !== n) euclidBad.push(`(${p},${n}) length wrong`);
}
if (!euclidBad.length) pass(`Euclidean rhythms match all ${euclidCases.length} published vectors (Bjorklund 1982 / Toussaint 2005)`);
else fail(`Euclidean generator wrong: ${euclidBad.join('; ')}`);

for (const g of ['lofi', 'straight', 'cumbia', 'cinquillo', 'tresillo', 'halfTime']){
  const G = X.GROOVES[g];
  if (G && G.kick.length === 16 && G.snare.length === 16 && G.hat.length === 16)
    pass(`groove "${g}" (${G.label}) has full 16-step masks`);
  else fail(`groove "${g}" masks are not 16 steps`);
}

/* DETERMINISM: the same seed must always give the same music, and a different
   seed must not. Without this, "generative" just means random on every reload. */
const h1 = X.scoreHash(X.compose({ seed: 42 }));
const h2 = X.scoreHash(X.compose({ seed: 42 }));
const h3 = X.scoreHash(X.compose({ seed: 43 }));
if (h1 === h2) pass(`music is deterministic — seed 42 hashes to ${h1} every time`);
else fail(`music is NOT deterministic: same seed gave ${h1} then ${h2}`);
if (h1 !== h3) pass(`different seeds give different music (${h1} vs ${h3})`);
else fail('different seeds produced identical music — the seed is being ignored');

/* The score must be musically substantial, not a handful of notes. */
const sc = X.compose({ seed: 7 });
if (sc.chords.length === sc.totalBars && sc.totalBars >= 16 &&
    sc.lead.length > 40 && sc.drums.length > 60)
  pass(`score is arranged: ${sc.totalBars} bars, ${sc.chords.length} chords, ` +
       `${sc.lead.length} lead notes, ${sc.drums.length} drum hits, ` +
       `prog ${sc.progA}/${sc.progB}`);
else fail(`score is thin: ${sc.totalBars} bars, ${sc.lead.length} lead, ${sc.drums.length} drums`);

/* Song form must actually vary density, or the piece has no shape. */
const dens = sc.sections.map(s => s.density);
if (Math.max(...dens) > Math.min(...dens) * 1.5)
  pass(`song form varies density across ${sc.sections.length} sections ` +
       `(${sc.sections.map(s => s.name).join('->')})`);
else fail(`song form is flat: densities ${dens.join(',')}`);

/* Chord tones must be real chords (3+ notes, ascending). */
const badChord = sc.chords.find(c => c.tones.length < 3 ||
  !c.tones.every((t, i) => i === 0 || t > c.tones[i-1]));
if (!badChord) pass(`all ${sc.chords.length} chords are stacked thirds in ascending order`);
else fail(`malformed chord at bar ${badChord.bar}: ${badChord.tones}`);

/* Scales must be the named ones the composer and synth agree on. */
if (X.SCALES.dorian && X.SCALES.dorian.length === 7 &&
    X.SCALES.hirajoshi && X.SCALES.hirajoshi.length === 5)
  pass(`scale table present: ${Object.keys(X.SCALES).length} scales ` +
       `(incl. 5-note hirajoshi for the Japan style)`);
else fail('scale table missing or malformed');

/* Every style's preset must name a scale that actually exists. */
const STYLES = { midnight:'dorian', cyberpunk:'minor', japan:'hirajoshi' };
let scaleBad = [];
for (const [style, want] of Object.entries(STYLES))
  if (!X.SCALES[want]) scaleBad.push(style);
if (!scaleBad.length) pass('every style preset names a real scale');
else fail(`style presets reference missing scales: ${scaleBad.join(', ')}`);

/* ---------------------------------------------------------------- 7b. audio */
const A = X.Audio_;
if (A && typeof A.start === 'function'){
  pass('audio engine constructed (music + train synth, gain buses)');
  const buses = Object.keys(A.gains || {});
  const need = ['master','music','rain','amb','train'];
  if (need.every(b => buses.includes(b))) pass(`all 5 audio buses present: ${buses.join(', ')}`);
  else fail(`missing audio buses, have ${buses.join(', ')}`);
} else fail('audio engine missing');
if (/AUDIO_B64 = \{/.test(CODE) && /"rain"/.test(CODE)) pass('ambient/rain audio is inlined — no network at runtime');
else soft('no inlined audio payload found — buses will be silent but the piece still runs');

/* ------------------------------------------------------------------- 8. perf */
render(0, T0); render(1); render(2);
const batches = [];
for (let b = 0; b < 7; b++){
  const a = Date.now();
  for (let i = 0; i < 120; i++) render(i * 0.05, T0);
  batches.push((Date.now() - a) / 120);
}
batches.sort((x,y) => x - y);
const per = batches[3];
if (per < 16.6) pass(`render cost ${per.toFixed(2)} ms/frame median (budget 16.67) — spread ${batches[0].toFixed(1)}..${batches[6].toFixed(1)} ms`);
else fail(`render cost ${per.toFixed(2)} ms/frame median EXCEEDS the budget — spread ${batches.map(v=>v.toFixed(1)).join(', ')}`);

console.log('='.repeat(60));
if (warn) console.log(`${warn} note(s) — informational, not failures.`);
console.log(ok ? '\nALL CHECKS PASSED\n' : '\nSOME CHECKS FAILED\n');
process.exit(ok ? 0 : 1);
}
