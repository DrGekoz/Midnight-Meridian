/* Per-pass frame cost, plus a back-to-back frame-time distribution.

   Reuses verify.js's DOM stub via require(), so there is exactly ONE definition
   of the fake DOM in this repo. A second copy (the old harness.js) went stale
   when the UI grew and made this profiler crash with a misleading error.

   Run: node diag-perf.js
*/
'use strict';
const vm = require('vm');
const { makeSandbox, CODE } = require('./verify.js');

const EXTRA = `
;globalThis.__P = (function(){
  const T = ACTIVE_THEME;
  const passes = [
    ['blitStrip:sky',   function(t){ blitStrip(S_SKY, 0, 0, true); }],
    ['stars',           function(t){ if (T.stars) drawStars(t); }],
    ['clouds',          function(t){ drawClouds(t, T); }],
    ['terrain(5)',      function(t){ blitStrip(S_MTNF,  MTNF_Y0,  SPD_MTNF  * t, false);
                                    blitStrip(S_MTNM,  MTNM_Y0,  SPD_MTNM  * t, false);
                                    blitStrip(S_PINEF, PINEF_Y0, SPD_PINEF * t, false);
                                    blitStrip(S_PINEN, PINEN_Y0, SPD_PINEN * t, false);
                                    drawSnowCaps(T); }],
    ['snowCaps',        function(t){ drawSnowCaps(T); }],
        ['embankment',      function(t){ blitStrip(S_EMB, EMB_Y0, SPD_EMB * t, false); }],
        ['snapshot',        function(t){ snapshotScene(); }],
        ['water',           function(t){ drawWater(t, T); }],
        ['ice',             function(t){ drawIce(T); }],
        ['train',           function(t){ drawTrain(t); }],
        ['trainLgt',        function(t){ drawTrainLight(t, T); }],
        ['smoke',           function(t){ drawSmoke(t); }],
        ['puddles',         function(t){ drawPuddles(t, T); }],
        ['groundLitter',    function(t){ drawGroundLitter(t, T); }],
        ['poles(blit)',     function(t){ blitStrip(S_POLES, POLES_Y0, SPD_POLES * t, false); }],
        ['foreground(3)',   function(t){ blitStrip(S_FPINE, FOREP_Y0, SPD_FORE * t, false);
                                        blitStrip(S_FORE,  FORE_Y0,  SPD_FORE * t, false);
                                        blitStrip(S_REEDS, FORE_Y0,  SPD_FORE * t, false); }],
        ['springDetail',    function(t){ drawSpringDetail(t, T); }],
        ['leafFall',        function(t){ drawLeafFall(t, T); }],
        ['lightShafts',     function(t){ drawLightShafts(t, T); }],
        ['torii',           function(t){ drawTorii(T); }],
        ['neon',            function(t){ drawNeon(T, t); }],
        ['heatHaze',        function(t){ drawHeatHaze(t, T); }],
        ['precip',          function(t){ drawPrecip(t, T); }],
        ['motes',           function(t){ drawMotes(t, T); }],
        ['vignette',        function(t){ drawVignette(); }]
      ];
  const time = (fn, n) => {
    for (let i = 0; i < 30; i++) fn(i * 0.37);       // warm up + JIT
    const a = performance.now();
    for (let i = 0; i < n; i++) fn(i * 0.37);
    return (performance.now() - a) / n;
  };
  function bench(n){
    const out = [];
    for (const [name, fn] of passes) out.push([name, time(fn, n)]);
    return out;
  }
  function frames(n, spb){
    for (let i = 0; i < 20; i++) render(i * 0.37);
    const out = [];
    for (let i = 0; i < n; i++){ const a = performance.now(); render(i * spb); out.push(performance.now() - a); }
    return out;
  }
  return { bench, frames, passCount: passes.length };
})();`;

const sb = makeSandbox();
vm.runInContext(CODE, sb);
vm.runInContext(EXTRA, sb);
const P = sb.__P;

const THEME = process.argv[2] || 'midnight-night-clear';
const SEASON = process.argv[3] || 'autumn';

sb.__X.setTheme(THEME, SEASON);
const T = sb.__X.ACTIVE_THEME;

console.log(`MIDNIGHT MERIDIAN — per-pass profile`);
console.log(`theme ${THEME} / ${SEASON}  (bpm ${T.music.bpm}, groove ${T.music.groove || '-'}, scale ${T.music.scale})\n`);
console.log('  pass'.padEnd(20) + 'ms'.padStart(9) + '   share');
console.log('  ' + '-'.repeat(38));

const res = P.bench(220);
const sum = res.reduce((a, [, v]) => a + v, 0);
for (const [name, ms] of res.sort((a, b) => b[1] - a[1])){
  const bar = '#'.repeat(Math.max(0, Math.round((ms / Math.max(sum, 0.001)) * 200)));
  console.log('  ' + name.padEnd(20) + ms.toFixed(3).padStart(9) + '   ' +
              bar.slice(0, 40));
}
console.log('  ' + '-'.repeat(38));
console.log('  ' + 'SUM'.padEnd(20) + sum.toFixed(3).padStart(9));

console.log('\n  frame time, back to back (ms)');
for (const [label, spb, n] of [['summer loop', 0.05, 200]]){
  const f = P.frames(n, spb).slice().sort((a, b) => a - b);
  const med = f[n >> 1];
  console.log(`    ${label}: median ${med.toFixed(2)}  p90 ${f[Math.floor(n*0.9)].toFixed(2)}` +
              `  max ${f[n-1].toFixed(2)}   budget 16.67` +
              (med < 16.67 ? '  PASS' : '  FAIL'));
}
console.log(`\n  ${P.passCount} passes instrumented`);