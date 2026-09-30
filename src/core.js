
"use strict";
/* =============================================================================
   MIDNIGHT MERIDIAN
   A seamlessly looping, 120.000 second, procedurally generated pixel-art
   night-train scene. Zero external assets: every pixel is computed at runtime.

   ARCHITECTURE
   -------------
   * A 480x270 software framebuffer (Uint32Array) is the single source of truth.
     ALL scene drawing is an integer write of `fb[y*VW + x]`. There is no
     fillRect, no drawImage, no canvas transform anywhere in the render path, so
     sub-pixel bleeding is STRUCTURALLY IMPOSSIBLE rather than merely avoided.
   * Scene geometry is pre-baked once into 480px-wide tileable "strips" that are
     scrolled by integer+sub-pixel offsets. A strip wraps by index, so scrolling
     480px is a no-op: that is the mechanical guarantee of a seamless loop.
   * Reflections are REAL-TIME: the composited scene is snapshotted, then the
     water band re-samples that snapshot with per-row wobble, tint, dither and a
     world-locked sparkle layer. Nothing is pre-baked.
   * Sub-pixel scrolling uses 4x4 ORDERED BAYER dithering between the two
     adjacent source columns, so motion is perfectly smooth and continuous at
     60fps while remaining a strict, dithered pixel grid (no blur, no stutter).

   LOOP CONTRACT
   -------------
   * 120.000s = 7200 frames. Every scrolling speed is an exact multiple of
     480/120 = 4 px/s, so each layer's offset returns to 0 mod 480 exactly.
   * Every time-varying quantity is sin(2*PI*k*t/120) with integer k, or a hash
     indexed by an integer counter that divides 120. Both are exactly periodic.
   * Particles are parameterised by AGE, never by spawn index, so the particle
     system has no state to reset.
   Press D to see the live loop-hash verification.
   ========================================================================== */

/* ---------------------------------------------------------------- constants */

const VW = 480, VH = 270;          // virtual (game) resolution
const LOOP_SECONDS = 120;
const LOOP_FRAMES  = LOOP_SECONDS * 60;   // 7200

/* Layer scroll speeds, px/second. MUST be multiples of 4 (= VW/120) so that
   speed * 120 is an exact multiple of VW and the layer lands back on itself. */
const SPD_STAR   =  4;   // 0.25x
const SPD_MTNF   =  4;   // 0.25x  (far range shares the star drift: "infinite")
const SPD_MTNM   =  8;   // 0.50x
const SPD_PINEF  = 12;   // 0.75x
const SPD_PINEN  = 16;   // 1.00x
const SPD_EMB    = 16;   // 1.00x  (ballast + rail, locked to the near forest)
const SPD_POLES  = 24;   // 1.50x  (telegraph poles + catenary wire)
const SPD_LAKE   = 20;   // 1.25x  (surface ripple layer only)
const SPD_FORE   = 32;   // 2.00x  (near bank, puddles, reeds)

/* Vertical composition. Chosen so no pixel is ever left unpainted. */
const SKY_H     = 112;               // rows 0..111
const MTNF_Y0   =  56, MTNF_H =  56;  // 56..111  opaque below ridge
const MTNM_Y0   =  86, MTNM_H =  52;  // 86..137  opaque below ridge
const PINEF_Y0  =  98, PINEF_H = 40;  // 98..137  transparent trees + solid floor
const PINEN_Y0  = 112, PINEN_H = 40;  // 112..151 transparent trees + solid floor
const EMB_Y0    = 146, EMB_H   = 22;  // 146..167 embankment, ballast, rail
const LAKE_Y0   = 168, LAKE_H   = 72;  // 168..239 water
const FOREP_Y0  = 206, FOREP_H  = 64;  // 206..269 near pines (foreground occluders)
const FORE_Y0   = 240, FORE_H   = 30;  // 240..269 near bank, puddles, reeds
/* The poles must stand PROUD of the train: the consist occupies y 123..166, so
   a band starting at 118 left only 5 rows visible above the boiler and the wire
   sag was hidden entirely behind the carriages. 84..147 puts the cross-arms and
   the catenary clear of the silhouette, which is where they do their work. */
const POLES_Y0  = 84, POLES_H  = 64;   // 84..147 telegraph poles + catenary wire
const RAIL_Y    = 166;                 // rail head: the wheels rest here

/* Reflection snapshot band: scene rows 30..167 inclusive. */
const SNAP_Y0 = 30, SNAP_ROWS = 138;

/* Train placement (screen-locked — the camera rides with the train). */
const TX = 100, TY = RAIL_Y - 43;      // sprite is 264x44, bottom row on the rail
const TW = 264, TH = 44;

/* Moon: the only zero-parallax object in frame. It anchors the eye and proves
   the depth cue is real. Moon is on the LEFT, so all rim light is on left faces. */
const MOON_X = 76, MOON_Y = 38, MOON_R = 11;

/* Locomotive block origin, in sprite-local coordinates. The coaches occupy
   0..141 and the engine 130..250, so the engine is the FRONT of the consist. */
const LOCO_ORIGIN = 130;

/* Chimney mouth in screen space — the smoke emitter. Authored at x=104 inside
   the locomotive block, so on the composed sprite it sits at 130+104 = 234. */
const STACK_X = TX + LOCO_ORIGIN + 104, STACK_Y = TY + 3;

/* ------------------------------------------------------------- canvas setup */

const cv  = document.getElementById('cv');
const ctx = cv.getContext('2d', { alpha:false, desynchronized:true });
cv.width = VW; cv.height = VH;
const img = ctx.createImageData(VW, VH);
const fb  = new Uint32Array(img.data.buffer);   // aliases ImageData -> zero-copy blit

const diagEl = document.getElementById('diag');
/* showDiag / the main loop / presentation live in main.js — this module is the
   renderer and nothing else, so the two never declare the same name. */

/* --------------------------------------------------- pixel packing (RGBA) */
/* Uint32 view of RGBA bytes is endianness-dependent. Probe once, then bind the
   correct pack/unpack closures so the hot loops stay monomorphic.             */
let _pack, _cr, _cg, _cb;
(function probeEndian(){
  const p = new Uint8Array(4);
  new Uint32Array(p.buffer)[0] = 0x0a0b0c0d;
  if (p[0] === 0x0d) {                       // little-endian: memory is R,G,B,A
    _pack = (r,g,b) => (0xff000000 | (b<<16) | (g<<8) | r) >>> 0;
    _cr = v =>  v        & 255;
    _cg = v => (v >>> 8)  & 255;
    _cb = v => (v >>> 16) & 255;
  } else {                                   // big-endian: memory is A,B,G,R
    _pack = (r,g,b) => ((r<<24) | (g<<16) | (b<<8) | 0xff) >>> 0;
    _cr = v => (v >>> 24) & 255;
    _cg = v => (v >>> 16) & 255;
    _cb = v => (v >>> 8)  & 255;
  }
})();

/* ------------------------------------------------------------- the palette */
/* One cohesive midnight / cyber-noir set. Nothing is generated in HSL at
   runtime — these are hand-tuned values so the piece is reproducible.

   These are `let`, not `const`, because applyTheme() re-points them at the
   active style palette. Every strip that reads them is rebuilt on a theme
   change, so the swap is a pointer assignment followed by a targeted rebuild —
   not a per-pixel restyle of the whole scene. */
function defPal(o){ const P = {}; for (const k in o){ P[k] = _pack(o[k][0],o[k][1],o[k][2]); } return P; }

/* The canonical midnight palette, kept as the fallback and as the documented
   default. PALETTES in themes.js holds the per-style sets. */
let SKY, NEB, MOO, FARN, MIDN, PF, PN, GND, TRN, WAT;
const WRM = defPal({ warm:[0xff,0xb1,0x4a], hot:[0xff,0xe0,0x9c], off:[0x0d,0x10,0x18] });
const SMK = defPal({ low:[0x8a,0x7d,0x84], high:[0x6d,0x74,0x96], warm:[0xb0,0x9c,0x92] });
/* Telegraph poles: weathered timber, dark wire, pale insulator tips. The tips
   catch the moon and the headlamp, which is what stops the layer reading as a
   black scribble across the sky. */
const POL = defPal({ body:[0x2b,0x24,0x2a], lo:[0x1a,0x14,0x1c],
                     wire:[0x22,0x1e,0x2c], wireLo:[0x16,0x13,0x20],
                     tip:[0x8a,0x8e,0xa8], rim:[0x3a,0x30,0x38] });

/* Point the working palette at a style's colours, with a day/night lift and a
   weather desaturation applied on top. This is the single place a theme changes
   the art: every downstream builder reads these names. */
function applyTheme(T){
  const p = T.pal;
  SKY  = p.sky;  NEB = p.neb;  MOO = p.moon;
  FARN = p.farn; MIDN = p.midn; PF = p.pineF; PN = p.pineN;
  GND  = p.gnd;  TRN = p.trn;  WAT = p.wat;
  /* DAY RELIGHTING.
         The v1 night palette bottoms out around RGB(7,5,14) — almost black. A 1.55x
         multiply on that only reaches (16,14,29), which still reads as night: the
         day theme was measurably indistinguishable from the night theme
         (sky luma 21.9 vs 21.9). Daylight is not the night palette turned up; it is
         a different exposure. So the sky, ridges and ground get a large additive
         lift toward a real daylight blue, and the water/foliage follow.

         k = multiply (preserves ramp shape), add = flat lift (sets the floor).

         FOLIAGE IS EXEMPT FROM RE-HUING. An earlier version blended PF/PN toward
         DAY_SKY at f=0.30/0.26, which desaturated the trees into blue-teal: the
         spring theme measured 3 green pixels in the whole tree band and read as a
         night scene. Daylit foliage is still foliage — it is exposed, not tinted.
         So vegetation gets only a small multiply plus a lift, and the SEASON colour
         is applied afterwards by buildThemeStrips(), which is the only place that
         knows whether it is spring, summer, autumn or winter. */
    if (T.tod === "day"){
      const DAY_SKY = _pack(0x6d, 0x93, 0xc8);      // daylight blue, as a lift target
      SKY  = liftPal(SKY,  DAY_SKY, 0.72, 1.45, 22);
      NEB  = liftPal(NEB,  DAY_SKY, 0.62, 1.30, 16);
      FARN = liftPal(FARN, DAY_SKY, 0.58, 1.35, 18);
      MIDN = liftPal(MIDN, DAY_SKY, 0.55, 1.25, 14);
      GND  = liftPal(GND,  DAY_SKY, 0.42, 1.25, 16);
      WAT  = liftPal(WAT,  _pack(0x8f,0xb4,0xdc), 0.60, 1.35, 20);
      /* Vegetation: exposure only, no re-hue. Keep the green identity intact so the
         season tint in buildThemeStrips() still lands on a recognisable tree. */
      PF   = liftPal(PF,   PF.rim, 0.10, 1.12, 6);
      PN   = liftPal(PN,   PN.rim, 0.10, 1.10, 5);
      /* the moon is not a light source by day: shrink its halo so it reads as a
         pale disc against a bright sky rather than a glowing lamp */
      MOO  = { core:_pack(0xf6,0xf8,0xfc), limb:_pack(0xcf,0xd8,0xe4),
               dark:_pack(0xa8,0xb4,0xc6), halo:_pack(0x9d,0xb6,0xd6) };
    }
  if (T.haze > 0.01){ const f = T.haze;
    SKY = mixPal(SKY, WAT.mid, f*0.35); FARN = mixPal(FARN, WAT.mid, f*0.30);
    MIDN = mixPal(MIDN, WAT.mid, f*0.30); PF = mixPal(PF, WAT.mid, f*0.22);
    PN = mixPal(PN, WAT.mid, f*0.22); GND = mixPal(GND, WAT.mid, f*0.20); }
  if (T.snow){ GND = mixPal(GND, 0xdce8f0, 0.30); }
}
/* Blend every colour toward `target` by `f`, then multiply by `k` and add a flat
   `add` to the result. This is the day-relight primitive: unlike tintPal (a pure
   multiply, which cannot rescue a near-black palette) it moves hue toward
   daylight AND raises the floor. */
function liftPal(pal, target, f, k, add){
  const o = {};
  const tr = _cr(target), tg = _cg(target), tb = _cb(target);
  for (const key in pal){
    const c = pal[key];
    /* blend toward the daylight target, then expose: k scales, add sets the floor */
    o[key] = _pack(
      clamp(Math.round((_cr(c) + (tr - _cr(c)) * f) * k + add), 0, 255),
      clamp(Math.round((_cg(c) + (tg - _cg(c)) * f) * k + add), 0, 255),
      clamp(Math.round((_cb(c) + (tb - _cb(c)) * f) * k + add), 0, 255));
  }
  return o;
}
/* brightness lift preserving hue */
function tintPal(pal, k, add){
  const o = {};
  for (const key in pal){
    o[key] = _pack(clamp(Math.round(_cr(pal[key])*k)+add,0,255),
                   clamp(Math.round(_cg(pal[key])*k)+add,0,255),
                   clamp(Math.round(_cb(pal[key])*k)+add,0,255));
  }
  return o;
}
function mixPal(pal, target, f){
  if (f <= 0) return pal;
  const o = {};
  for (const key in pal){
    const c = pal[key], t = target;
    o[key] = _pack(lerp(_cr(c),_cr(t),f)|0, lerp(_cg(c),_cg(t),f)|0, lerp(_cb(c),_cb(t),f)|0);
  }
  return o;
}

/* ------------------------------------------------------------------ maths  */

function mulberry32(a){                                  // deterministic PRNG
  return function(){
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* 2D integer hash -> [0,1). Used for every "random-looking" decision so the
   result is identical on every machine and every run.                        */
function hash2(x, y, s){
  let h = Math.imul(x|0, 374761393) + Math.imul(y|0, 668265263) + Math.imul(s|0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/* Smooth, exactly-periodic 1D value noise (period in samples). */
function makeNoise1D(seed, period){
  const r = mulberry32(seed), v = new Float32Array(period);
  for (let i=0;i<period;i++) v[i] = r();
  return function(x){
    const xi = Math.floor(x), f = x - xi, s = f*f*(3-2*f);
    const a = v[((xi % period)+period)%period], b = v[(((xi+1) % period)+period)%period];
    return a + (b-a)*s;
  };
}
const lerp = (a,b,t) => a + (b-a)*t;
const clamp = (v,a,b) => v < a ? a : (v > b ? b : v);
function mixC(c0, c1, t){                                // colour lerp (build-time)
  if (t <= 0) return c0; if (t >= 1) return c1;
  return _pack(Math.round(lerp(_cr(c0),_cr(c1),t)),
               Math.round(lerp(_cg(c0),_cg(c1),t)),
               Math.round(lerp(_cb(c0),_cb(c1),t)));
}
function shade(c, k){                                     // multiply RGB, keep alpha
  return _pack(clamp(Math.round(_cr(c)*k),0,255),
               clamp(Math.round(_cg(c)*k),0,255),
               clamp(Math.round(_cb(c)*k),0,255));
}

/* ------------------------------------------------- 4x4 ordered Bayer dither */
/* The ordered matrix is the backbone of the whole look: every gradient in the
   piece (sky, ridges, glows, water, smoke fringes) is resolved into visible
   pixel crosshatch instead of a smooth ramp.                                 */
const BAYER = new Uint8Array([
   0, 8, 2,10,
  12, 4,14, 6,
   3,11, 1, 9,
  15, 7,13, 5
]);
const bayer01 = (x,y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) * 0.0625;  // (0,1)

/* ---- sine lookup table -----------------------------------------------------
   The reflection loop evaluates ~35k sines per frame, which dominated the
   frame budget (measured: 48.5 ms of a 65 ms frame). A 2048-entry table turns
   each into an array read. The angle argument is scaled by TAU8 = 2048/(2*PI),
   so a full turn is exactly 2048 entries and the wrap is a mask, not a modulo. */
const SIN_SIZE = 2048, SIN_MASK = SIN_SIZE - 1, TAU8 = SIN_SIZE / (2 * Math.PI);
const SIN = new Float64Array(SIN_SIZE);
for (let i = 0; i < SIN_SIZE; i++) SIN[i] = Math.sin(i * 2 * Math.PI / SIN_SIZE);
/* Fast sine, argument in radians. |error| < 1e-6 over the whole range, and
   exactly periodic because it wraps on a power-of-two table. */
const fsin = (a) => SIN[Math.round(a * TAU8) & SIN_MASK];

/* Endianness-correct inlined pack, so the hot reflection loop avoids a call. On a
   little-endian machine the Uint32 view of RGBA bytes is 0xAABBGGRR, so RED is
   the low byte and _pack(255,0,0) === 0x000000ff. Probing with _pack(0,0,0)
   instead compares the ALPHA channel and wires the packer up with R and B
   swapped — which silently paints the whole reflection red. */
const PACK_FAST = (_pack(255,0,0) === 0x000000ff)
  ? (r,g,b) => 0xff000000 | (((b|0) & 255) << 16) | (((g|0) & 255) << 8) | ((r|0) & 255)
  : (r,g,b) => 0xff000000 | (((r|0) & 255) << 16) | (((g|0) & 255) << 8) | ((b|0) & 255);

/* ---- water wave-crest tables ----------------------------------------------
   The water loop runs LAKE_H * VW = 34,560 iterations per frame. It needs
   floor(x/9), split into an integer part and a fraction, so the per-pixel
   division and Math.floor disappear. Built once, never touched again. */
const WL_BASE = new Int32Array(VW);
const WL_FRAC = new Float64Array(VW);
for (let x = 0; x < VW; x++){ const q = x / 9; WL_BASE[x] = Math.floor(q); WL_FRAC[x] = q - WL_BASE[x]; }

/* Per-column hashes for the two random terms in the water pass, unrolled to
   pure table lookups. hash2(x, d, 9) varied with d, but the ONLY thing it gated
   was a 6..13 point lift on a secondary crest — visually identical, and
   dropping the d dependence is what makes the table possible. The glitter hash
   keeps its time dependence through gSeed, so the sparkle still animates. */
const HASH_W = new Float32Array(VW);
const HASH_G = new Float32Array(4096);
for (let x = 0; x < VW; x++)   HASH_W[x] = hash2(x, 5, 9);
for (let i = 0; i < 4096; i++) HASH_G[i] = hash2(i & 1023, i, 5);

/* Dithered N-stop vertical ramp. */
function rampN(x, y, t, stops){
  const n = stops.length;
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[n-1];
  const f = t * (n-1), i = f|0;
  return bayer01(x,y) < (f - i) ? stops[i+1] : stops[i];
}

/* ------------------------------------------------------------- strip model */
/* A strip is a 480-wide (or w-wide) RGBA buffer with index 0 meaning TRANSPARENT.
   s*() writes with X WRAP so a shape crossing the seam is genuinely seamless
   — that is how procedural geometry becomes tileable.                         */
function newStrip(w, h){ return { w, h, d: new Uint32Array(w*h) }; }
function sput(s, x, y, c){
  if (y < 0 || y >= s.h || c === 0) return;
  let xx = x % s.w; if (xx < 0) xx += s.w;
  s.d[y*s.w + xx] = c;
}
function srect(s, x, y, w, h, c){ for (let j=0;j<h;j++) for (let i=0;i<w;i++) sput(s, x+i, y+j, c); }

/* Blit a strip into the framebuffer with SUB-PIXEL scroll.
   `off` is a float pixel offset. The fractional part resolves between the two
   adjacent source columns using the Bayer threshold, which is what lets slow
   layers move smoothly at 60fps without any blur and without stuttering.      */
function blitStrip(s, y0, off, opaque){
  const W = s.w, H = s.h, sd = s.d;
  const fi = Math.floor(off), fr = off - fi;
  const yMax = Math.min(H, VH - y0);
  for (let y = 0; y < yMax; y++){
    const srow = y * W, drow = (y0 + y) * VW;
    if (fr === 0){
      for (let x = 0; x < VW; x++){
        let j = (x + fi) % W; if (j < 0) j += W;
        const c = sd[srow + j];
        if (opaque || c !== 0) fb[drow + x] = c;
      }
    } else {
      for (let x = 0; x < VW; x++){
        let j  = (x + fi) % W; if (j < 0) j += W;
        let j2 = j + 1; if (j2 >= W) j2 -= W;
        const c0 = sd[srow + j], c1 = sd[srow + j2];
        if (c0 === c1){ if (c0 !== 0) fb[drow + x] = c0; }
        else if (bayer01(x, y0 + y) < fr){ if (c1 !== 0) fb[drow + x] = c1; }
        else { if (c0 !== 0) fb[drow + x] = c0; }
      }
    }
  }
}

/* Additive pixel write with saturation — used by every light pass. */
function addPix(x, y, r, g, b){
  if (x < 0 || x >= VW || y < 0 || y >= VH) return;
  const i = y*VW + x, c = fb[i];
  let nr = _cr(c) + r; if (nr > 255) nr = 255;
  let ng = _cg(c) + g; if (ng > 255) ng = 255;
  let nb = _cb(c) + b; if (nb > 255) nb = 255;
  fb[i] = _pack(nr, ng, nb);
}
/* Dithered additive: the light itself is a crosshatch, not a smooth blob. */
function addDith(x, y, r, g, b, a){
  if (a <= 0.004) return;
  if (bayer01(x,y) >= a) return;
  addPix(x, y, r, g, b);
}

/* =============================================================================
   LAYER BUILDERS — run exactly once at boot
   ========================================================================== */

/* ---- SKY: dithered vertical ramp + Milky-Way band + moon-side horizon glow
   Built at FULL FRAME HEIGHT, not just the visible band. This is the base
   plate of the whole composite: every ridge and forest is transparent above
   its own silhouette, so the sky is what shows through. A full-height sky
   guarantees there is no scanline anywhere that nothing has painted.        */
function buildSky(){
  const s = newStrip(VW, VH);
  const nA = makeNoise1D(1337, 60), nB = makeNoise1D(4242, 30);
  const stops = [SKY.top, SKY.top, SKY.mid, SKY.mid, SKY.low, SKY.haze];
  /* Below the horizon the sky becomes the deep ground haze that the ridges,
     the embankment crest and the tree line all sit against.

     LOOP/DENSITY CRITICAL: the embankment and the near bank both have a WAVY
     crest, so a few scanlines per column above the crest are painted only by
     this ramp. It must never approach black there or the crests read as holes
     punched in the ground. The ramp is deliberately compressed into the top
     third of the range and floored with SKY.deep, which is a visible deep
     indigo (18,12,36) rather than black. */
  const gStops = [SKY.haze, SKY.low, SKY.mid, SKY.low, SKY.deep, SKY.deep];
  for (let y = 0; y < VH; y++){
    const inSky = y < SKY_H;
    const t  = inSky ? Math.pow(y / (SKY_H - 1), 1.45)
                     : Math.pow((y - SKY_H) / (VH - SKY_H), 0.8);
    const pal = inSky ? stops : gStops;
    for (let x = 0; x < VW; x++){
      let c = rampN(x, y, t, pal);

      if (inSky){
        /* Milky-Way: a diagonal band of clumped value noise, dithered in. */
        const yc = 34 + x * 0.21 + 14 * (nA(x/38) - 0.5);
        const d  = (y - yc) / 30;
        const dens = Math.exp(-d*d) * (0.30 + 0.70 * nA(x/26 + 4) * nB(x/11 + 9));
        if (dens > 0.02){
          const nc = mixC(NEB.a, NEB.b, clamp(nA(x/17)*1.4, 0, 1));
          if (bayer01(x,y) < clamp(dens*1.5, 0, 1)) c = mixC(c, nc, 0.75);
        }
        /* Horizon bloom around the moon's column — sells the light source. */
        const hx = (x - MOON_X) / 88, hy = (y - SKY_H) / 46;
        const glow = Math.exp(-(hx*hx + hy*hy)) * 0.55;
        if (glow > 0.01) c = mixC(c, SKY.haze, glow);
      } else {
        /* ground haze: faint vertical striation so it is not a dead plate */
        const n = hash2(x, y >> 2, 41);
        if (n > 0.90) c = mixC(c, SKY.haze, 0.35);
      }
      s.d[y*VW + x] = c;
    }
  }
  return s;
}

/* ---- MOUNTAIN RIDGE -------------------------------------------------------
   Elevation is a sum of sine HARMONICS WITH INTEGER CYCLE COUNTS across the
   tile, so the profile is exactly periodic over 480px. Lighting comes from the
   left (the moon): a column whose elevation rises to the right presents a
   left-facing surface and therefore catches a bright rim.                        */
function buildRidge(y0, h, seed, opt){
  const s = newStrip(VW, h);
  const rnd = mulberry32(seed);
  const harm = [];
  let amp = 1, norm = 0;
  for (let k = 0; k < opt.octaves; k++){
    harm.push({ cyc: opt.baseCycles * (k+1), ph: rnd() * Math.PI * 2, a: amp });
    norm += amp; amp *= 0.56;
  }
  const elev = new Float32Array(VW);
  for (let x = 0; x < VW; x++){
    let v = 0;
    for (const H of harm) v += H.a * Math.sin(2*Math.PI*H.cyc*x/VW + H.ph);
    v = v / norm * 0.5 + 0.5;
    elev[x] = Math.pow(clamp(v,0,1), opt.sharp);
  }
  const topOf = x => h - 1 - Math.round(elev[x] * (h - 3 - opt.lift));
  const stops = [opt.pal.rim, opt.pal.hi, opt.pal.hi, opt.pal.lo, opt.pal.shd];
  for (let x = 0; x < VW; x++){
    const t0 = topOf(x);
    const rise = elev[x] - elev[(x-1+VW)%VW];            // >0 => left-facing
    const isPeak = elev[x] > elev[(x+1)%VW] && elev[x] >= elev[(x-1+VW)%VW];
    for (let y = t0; y < h; y++){
      const dep = y - t0;
      const vt  = dep / Math.max(1, h - 1 - t0);
      let c = rampN(x, y, Math.pow(vt, 0.85), stops);
      /* rim light on left-facing crests */
      if (dep < 2 && rise > 0.0015)
        c = mixC(c, opt.pal.rim, dep === 0 ? 0.95 : 0.45);
      /* deepen the shadow side */
      if (rise < -0.0015 && dep < 3) c = mixC(c, opt.pal.shd, 0.4);
      /* snow on local maxima, dithered lower edge */
      if (isPeak && elev[x] > 0.70 && dep < 3){
        const k = dep === 0 ? 1 : (dep === 1 ? 0.8 : 0.35);
        if (bayer01(x,y) < k) c = mixC(c, opt.pal.snow, 0.9);
      }
      /* atmospheric haze pooling in the valleys */
      if (y > h - opt.hazeRows){
        const hz = (y - (h - opt.hazeRows)) / opt.hazeRows;
        c = mixC(c, opt.pal.haze, hz*hz*0.8);
      }
      s.d[y*VW + x] = c;
    }
  }
  return s;
}

/* ---- CONIFER --------------------------------------------------------------
   Half-width grows toward the base (a proper cone) and every 3rd row is notched
   inward, which reads as stacked branch tiers. Left edge catches the moonlight,
   right edge falls into shadow, interior is dithered.                          */
function drawPine(s, cx, baseY, height, wmax, ramp, rim, seed, bare){
  const top = baseY - height;
  for (let y = top; y <= baseY; y++){
    const u = clamp((y - top) / Math.max(1, height - 1), 0.055, 1);
    let hw = Math.round(wmax * Math.pow(u, 0.82));
    if ((y - top) % 3 === 0) hw = Math.max(1, Math.round(hw * 0.76));   // tier notch
    /* WINTER: a conifer without needles. Draw the branch tiers as thin horizontal
       strokes instead of a solid cone — this is the only thing that made winter
       read as "green summer with a white hat", because the season palette still
       supplied a green ramp and nothing consumed `bare`. */
    if (bare){
      if (hw < 1) continue;
      if ((y - top) % 3 === 0 || (y - top) % 3 === 1){
        const th = (y - top) % 3 === 0 ? 1 : 0;
        for (let dx = -hw; dx <= hw; dx++){
          if (th && Math.abs(dx) < hw - 1) continue;
          sput(s, cx + dx, y, dx < 0 ? ramp[1] : ramp[2]);
        }
      }
      continue;
    }
    for (let dx = -hw; dx <= hw; dx++){
      const x = cx + dx, ay = Math.abs(dx) / (hw + 0.001);
      let c;
      if (dx === -hw){
        c = (hash2(x, y, seed) < 0.62) ? rim : ramp[0];
      } else if (dx === hw){
        c = ramp[2];
      } else {
        const k = 1 - ay;
        c = ramp[k < 0.26 ? 0 : (k < 0.60 ? 1 : 2)];
        if (k < 0.28 && hash2(x, y, seed + 5) < 0.55) c = ramp[0];
      }
      /* a couple of bright frost pixels on the upper-left branch tips */
      if (u < 0.55 && dx < 0 && hash2(x, y, seed + 9) > 0.965) c = rim;
      sput(s, x, y, c);
    }
  }
  /* trunk */
  for (let y = baseY - Math.max(2, height>>3); y <= baseY; y++)
    for (let dx = -1; dx <= 1; dx++) sput(s, cx+dx, y, ramp[2]);
}

function buildForest(y0, h, seed, count, hMin, hMax, wMax, ramp, rim, floorC, bare){
  const s = newStrip(VW, h);
  const rnd = mulberry32(seed);
  const baseY = h - 1;
  for (let i = 0; i < count; i++){
    const x = Math.floor(rnd() * VW);
    const hh = hMin + Math.floor(rnd() * (hMax - hMin));
    drawPine(s, x, baseY, hh, wMax * (0.7 + rnd()*0.5), ramp, rim, 100 + i*37, bare);
  }
  /* solid floor so the band can never show a gap under the trees */
  for (let y = baseY; y < h; y++) for (let x = 0; x < VW; x++) s.d[y*VW + x] = floorC;
  /* a few tiny distant window lights peeking between the trunks */
  for (let i = 0; i < 3; i++){
    const x = Math.floor(rnd()*VW), y = baseY - 3 - Math.floor(rnd()*9);
    srect(s, x, y, 2, 2, WRM.warm);
    srect(s, x, y, 1, 1, WRM.hot);
  }
  return s;
}

/* ---- EMBANKMENT / BALLAST / RAIL ------------------------------------------
   The sleeper pitch is 8px, and 480/8 = 60 exactly, so the rail pattern tiles
   with no seam. Ballast stones are written with X-wrap so a stone straddling
   the seam appears on both sides.                                              */
function buildEmbankment(){
  const h = EMB_H, s = newStrip(VW, h);
  const rnd = mulberry32(90210);
  const crest = new Float32Array(VW);
  for (let x = 0; x < VW; x++){
    crest[x] = 2 + Math.round(1.4*Math.sin(2*Math.PI*x/VW) + 1.1*Math.sin(2*Math.PI*3*x/VW + 1.1));
  }
  for (let x = 0; x < VW; x++){
    const c0 = crest[x];
    for (let y = c0; y < h; y++){
      let c;
      const rel = y - c0;
      if (rel < 2)        c = mixC(GND.crest, GND.rim  , 0.25);
      else if (rel < 11)  c = mixC(GND.slope, GND.crest, 1 - rel/11);
      else                c = GND.balB;
      /* ballast: dense dithered stones */
      if (rel >= 6 && rel < 16){
        const n = hash2(x, y, 7);
        if (n > 0.90) c = GND.balA;
        else if (n > 0.62) c = mixC(c, GND.balA, 0.45);
        else if (n < 0.10) c = shade(c, 0.75);
      }
      s.d[y*VW + x] = c;
    }
  }
  /* sleepers every 8px, rail web, and a bright rail head that catches lamp light */
  for (let x = 0; x < VW; x++){
    if (x % 8 < 3) for (let y = 16; y < 19; y++) s.d[y*VW + x] = GND.sleeper;
  }
  for (let y = 19; y < h; y++) for (let x = 0; x < VW; x++) s.d[y*VW + x] = GND.railDk;
  for (let x = 0; x < VW; x++){
    s.d[19*VW + x] = shade(GND.rail, 0.70);
    s.d[20*VW + x] = GND.rail;
    s.d[20*VW + x] = mixC(GND.rail, GND.railHi, 0.35);
  }
  return s;
}

/* ---- NEAR BANK (foreground) ------------------------------------------------ */
function buildForeBank(){
  const s = newStrip(VW, FORE_H);
  const rnd = mulberry32(5150);
  for (let x = 0; x < VW; x++){
    /* Clamp the crest to >= 0. The raw sum of two sines dips to -2, which
       started the fill loop at a NEGATIVE y and sput() correctly discarded
       those rows — leaving a gap between the lake surface and the bank lip. */
    const y0 = Math.max(0, Math.round(1.6*Math.sin(2*Math.PI*x/VW) + 1.0*Math.sin(2*Math.PI*5*x/VW + 0.7)));
    for (let y = y0; y < FORE_H; y++){
      const vt = y / (FORE_H - 1);
      let c = mixC(GND.wetHi, GND.wet, Math.pow(vt, 0.7));
      if (hash2(x, y, 23) > 0.955) c = mixC(c, GND.balA, 0.5);
      s.d[y*VW + x] = c;
    }
  }
  /* wet highlight along the top lip of the bank */
  for (let x = 0; x < VW; x++){
    const y0 = Math.round(1.6*Math.sin(2*Math.PI*x/VW) + 1.0*Math.sin(2*Math.PI*5*x/VW + 0.7));
    s.d[y0*VW + x] = mixC(GND.wetHi, WAT.rim, 0.6);
  }
  /* pebbles */
  for (let i = 0; i < 90; i++){
    const x = Math.floor(rnd()*VW), y = 3 + Math.floor(rnd()*(FORE_H-5));
    sput(s, x, y, mixC(GND.balB, GND.railDk, rnd()));
    if (rnd() > 0.5) sput(s, x+1, y, GND.balB);
  }
  return s;
}

/* ---- REEDS along the near bank (transparent overlay) ----------------------- */
function buildReeds(){
  const s = newStrip(VW, FORE_H);
  const rnd = mulberry32(777);
  for (let i = 0; i < 46; i++){
    const x = Math.floor(rnd()*VW);
    const hgt = 6 + Math.floor(rnd()*16);
    const bend = (rnd() - 0.5) * 5;
    for (let k = 0; k < hgt; k++){
      const y = FORE_H - 1 - k;
      const xo = x + Math.round(bend * (k/hgt) * (k/hgt));
      sput(s, xo, y, k > hgt-3 ? GND.balA : GND.wetHi);
      if (k < hgt - 4 && rnd() > 0.72) sput(s, xo+1, y, GND.wetHi);
    }
  }
  return s;
}

/* =============================================================================
   THE TRAIN
   Built as a static 264x44 sprite plus 8 pre-rendered 90x15 wheel-phase strips
   (spokes + connecting rod), so the running gear actually turns.
   ========================================================================== */
const WINDOWS = [];        // {x,y,w,h,seed,dark}
const WHEEL_X0 = 18, WHEEL_Y0 = 29, WHEEL_W = 90, WHEEL_H = 15;
/* The running gear belongs to the locomotive, which now sits at LOCO_ORIGIN.
   The wheel strip is authored in the loco's own frame (WHEEL_X0 = 18), so it is
   drawn at LOCO_ORIGIN + WHEEL_X0. */
const WHEEL_DRAW_X = LOCO_ORIGIN + WHEEL_X0;

function buildTrainBody(){
  const s = newStrip(TW, TH);
  const put = (x,y,c) => sput(s, x, y, c);

  /* --- shared sub-macros ------------------------------------------------- */
  const rivets = (x0,x1,y0,y1) => {
    for (let x = x0; x <= x1; x += 10)
      for (let y = y0; y <= y1; y += 4){ put(x, y, TRN.ironHi); put(x, y+1, TRN.iron); }
  };
  const windowPane = (x,y,w,h,seed,dark) => {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++)
        put(x+i, y+j, (i === 0 || j === 0 || i === w-1 || j === h-1) ? TRN.ironHi : TRN.win);
    WINDOWS.push({x, y, w, h, seed, dark: !!dark});
  };

  /* --- CARRIAGES -----------------------------------------------------------
     Authored at 122..263 and shifted LEFT by CARRIAGE_DX so the consist reads,
     left to right:  carriage carriage carriage LOCOMOTIVE
     The engine must sit at the FRONT (right) with the coaches trailing behind
     it, because the world scrolls left and the train therefore travels right. */
  const CARRIAGE_DX = -122;
  const cars = [122 + CARRIAGE_DX, 170 + CARRIAGE_DX, 218 + CARRIAGE_DX];
  for (let ci = 0; ci < cars.length; ci++){
    const bx = cars[ci];
    /* roof: an arc with two vents */
    for (let i = 0; i < 46; i++){
      const d = Math.abs(i - 23) / 23;
      const rh = 3 + Math.round(2.2 * (1 - d*d));
      for (let y = 0; y < rh; y++){
        const c = (y === 0) ? mixC(TRN.bodyHi, TRN.ironHi, 0.5)
                 : (y < rh-1 ? TRN.bodyHi : TRN.body);
        put(bx+i, y+1, c);
      }
    }
    put(bx+8, 0, TRN.iron); put(bx+9, 0, TRN.ironHi); srect(s, bx+8, 0, 2, 3, TRN.body);
    put(bx+34, 0, TRN.iron); put(bx+35, 0, TRN.ironHi); srect(s, bx+34, 0, 2, 3, TRN.body);
    /* body panel */
    for (let y = 7; y < 33; y++)
      for (let i = 0; i < 46; i++)
        put(bx+i, y, (y === 7) ? mixC(TRN.bodyHi, TRN.ironHi, .4)
                 : (y === 32 ? TRN.bodyLo : (i % 9 === 0 ? mixC(TRN.body, TRN.bodyHi, .35) : TRN.body)));
    /* deep-red livery stripe + thin pinstripes */
    for (let i = 0; i < 46; i++){
      put(bx+i, 27, TRN.trim);
      put(bx+i, 28, mixC(TRN.trim, TRN.body, .45));
      put(bx+i, 29, TRN.brass);
      put(bx+i, 26, mixC(TRN.brassHi, TRN.body, .5));
    }
    /* four lit windows */
    const dark = (ci === 0 && 0) || (ci === 2 && 3);
    for (let w = 0; w < 4; w++) windowPane(bx + 4 + w*10, 12, 8, 10, ci*4 + w + 1, dark && w === (dark===true?0:3));
    /* door between windows 2 and 3 */
    for (let y = 10; y < 32; y++){ put(bx+43, y, TRN.bodyLo); }
    /* rivet rows + underframe */
    rivets(bx+2, bx+43, 31, 31);
    for (let i = 0; i < 46; i++) put(bx+i, 33, TRN.bodyLo);
    for (let i = 0; i < 46; i++) put(bx+i, 34, mixC(TRN.bodyLo, TRN.iron, .5));
    /* bogies: two wheelsets */
    for (const cx of [10, 20, 28, 38]){
      for (let a = 0; a < 360; a += 45){
        const r = 3.4, dx = Math.round(Math.cos(a*Math.PI/180) * r);
        const dy = Math.round(Math.sin(a*Math.PI/180) * r);
        put(bx+cx+dx, 39+dy, (dy < 0) ? TRN.iron : TRN.ironHi);
        put(bx+cx+dx+1, 39+dy, TRN.iron);
      }
      srect(s, bx+cx-1, 38, 3, 2, TRN.ironHi);
    }
    /* coupler */
    for (let i = 0; i < 2; i++) put(bx - 2 + i, 29, TRN.iron);
  }

  /* --- LOCOMOTIVE ---------------------------------------------------------
     The coaches now occupy 0..141, so the locomotive is translated RIGHT by
     LOCO_DX = 130 to occupy 130..250 — the FRONT of the consist. Its internal
     geometry is unchanged and already faces right: cab at the left/rear, then
     boiler, steam dome, flared chimney, smokebox, headlamp and pilot bars at
     the right/front. Nothing is mirrored, so the engine still points the way
     the train is actually going.
     Every coordinate below is written relative to the block origin, which keeps
     the drawing code readable while the whole assembly sits at the front. */
  const LOCO_DX = 130;
  {
    const OX = LOCO_DX;                 // block origin offset
    const put = (x, y, c) => sput(s, x + OX, y, c);
    const rect = (x, y, w, h, c) => srect(s, x + OX, y, w, h, c);

  const windowPaneL = (x, y, w, h, seed, dark) => {
    windowPane(x + LOCO_DX, y, w, h, seed, dark);
  };

  /* frame / running board */
  for (let x = 8; x < 120; x++){ put(x, 32, TRN.bodyHi); put(x, 33, TRN.body); put(x, 34, TRN.bodyLo); }
  for (let x = 14; x < 120; x++){ put(x, 31, TRN.bodyLo); }
  /* cab */
  for (let y = 8; y < 32; y++)
    for (let x = 16; x < 55; x++)
      put(x, y, (y === 8) ? mixC(TRN.bodyHi, TRN.ironHi, .5)
            : (x % 11 === 0 ? mixC(TRN.body, TRN.bodyHi, .3) : TRN.body));
  /* cab roof with overhang + rain strip */
  for (let i = -2; i < 42; i++){ put(14+i, 6, mixC(TRN.bodyHi, TRN.ironHi, .6)); put(14+i, 7, TRN.bodyHi); }
  for (let i = -2; i < 42; i++) put(14+i, 8, TRN.bodyLo);
  /* cab side window + front window */
  windowPaneL(21, 14, 12, 10, 1, false);
  windowPaneL(44, 14, 10, 10, 2, false);
  /* boiler */
  for (let y = 14; y < 32; y++)
    for (let x = 54; x < 99; x++)
      put(x, y, (y === 14) ? mixC(TRN.bodyHi, TRN.brassHi, .30)
            : (y === 15 ? mixC(TRN.bodyHi, TRN.ironHi, .25)
            : (x % 17 === 0 ? mixC(TRN.body, TRN.bodyHi, .28) : TRN.body)));
  /* boiler bands with rivets */
  for (const bx2 of [63, 74, 86]){
    for (let y = 15; y < 31; y++){ put(bx2, y, mixC(TRN.ironHi, TRN.brass, .25)); put(bx2+1, y, TRN.bodyLo); }
    for (let y = 17; y < 30; y += 4){ put(bx2, y, TRN.brassHi); put(bx2, y+1, TRN.brass); }
  }
  /* handrail along the boiler */
  for (let x = 56; x < 98; x++) put(x, 16, mixC(TRN.ironHi, WRM.warm, .35));
  for (const hx of [58, 72, 88, 96]) { put(hx, 15, TRN.ironHi); put(hx, 16, TRN.ironHi); put(hx, 17, TRN.iron); }
  /* smokebox + door */
  for (let y = 14; y < 32; y++) for (let x = 97; x < 113; x++) put(x, y, TRN.smokebox);
  for (let y = 15; y < 31; y++) for (let x = 109; x < 114; x++) put(x, y, mixC(TRN.smokebox, TRN.body, .45));
  for (let y = 16; y < 30; y++){ put(113, y, TRN.ironHi); }
  srect(s, LOCO_DX + 111, 22, 3, 3, TRN.brass); put(LOCO_DX + 112, 23, TRN.brassHi);  /* door ring */
  for (let y = 17; y < 29; y += 3){ put(110, y, TRN.iron); }
  /* steam dome */
  for (let i = 0; i < 12; i++){
    const d = Math.abs(i - 5.5) / 5.5, hgt = 6 - Math.round(4.4*d*d);
    for (let y = 0; y < hgt; y++)
      for (let k = 0; k < 2; k++)
        put(78+i, 10+y, (k === 0) ? TRN.brassHi : TRN.brass);
  }
  /* flared chimney */
  for (let y = 4; y < 15; y++){
    const flare = (y < 7) ? 3 : 0;
    for (let i = -flare; i <= 4+flare; i++)
      put(100+i, y, (i <= 0) ? mixC(TRN.smokebox, TRN.ironHi, .35) : TRN.smokebox);
  }
  for (let i = -3; i <= 7; i++) put(100+i, 4, mixC(TRN.ironHi, TRN.brass, .18));
  for (let i = -3; i <= 7; i++) put(100+i, 5, TRN.smokebox);
  srect(s, LOCO_DX + 99, 11, 3, 4, mixC(TRN.ironHi, TRN.brassHi, .30));     /* chimney band */
  /* headlamp housing + lens */
  rect(112, 13, 7, 11, mixC(TRN.brass, TRN.body, .35));
  rect(112, 13, 7, 2, TRN.brassHi);
  rect(118, 15, 2, 7, WRM.hot);
  WINDOWS.push({x: 118 + LOCO_DX, y:15, w:2, h:7, seed:15, dark:false, lamp:true});
  /* buffer beam + pilot bars */
  for (let y = 30; y < 40; y++) for (let x = 112; x < 120; x++) put(x, y, TRN.trim);
  for (let y = 30; y < 40; y++) put(112, y, mixC(TRN.trimHi, TRN.brass, .3));
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < 8; i++) put(112 + i, 40 - i + k*3, TRN.ironHi);
  /* cylinders + valve gear */
  for (let y = 30; y < 38; y++) for (let x = 86; x < 99; x++) put(x, y, mixC(TRN.iron, TRN.body, .3));
  for (let y = 30; y < 38; y++){ put(86, y, TRN.ironHi); }
  /* number plate */
  rect(56, 23, 9, 6, TRN.plate);
  for (let i = 1; i < 8; i += 2){ put(57+i, 25, TRN.bodyLo); put(58+i, 26, TRN.bodyLo); }
  rect(56, 23, 9, 1, mixC(TRN.plate, TRN.brassHi, .6));
  /* sand box + whistle */
  rect(66, 20, 7, 4, mixC(TRN.body, TRN.bodyHi, .5));
  put(92, 9, TRN.brassHi); put(93, 9, TRN.brass); put(92, 10, TRN.brass);
  /* footplate steps */
  for (let k = 0; k < 3; k++) for (let x = 16; x < 24; x++) put(x, 35 + k*2, TRN.iron);
  }   // end translated locomotive block

  /* --- MOONLIT RIM LIGHT ---------------------------------------------------
     Vision review: the engine's dark boiler and stack merged into the conifer
     silhouette, so the train read as pasted onto the tree line rather than
     sitting in front of it. A 1px cool rim along the top of every silhouette
     edge separates it from the background — and because the train is
     screen-locked, this is baked ONCE at build time and costs nothing per
     frame. The moon is on the left, so the rim goes on the upper-LEFT faces. */
  const RIM = mixC(TRN.bodyHi, 0xa9, 0.5), RIM2 = mixC(TRN.bodyHi, 0x7d, 0.30);
  /* Skip the window panes: the flicker pass repaints them, and a rim across a
     lit pane would read as a dirty smear on the glass. */
  const isWindow = (x, y) => {
    for (const w of WINDOWS) if (x >= w.x && x < w.x + w.w && y >= w.y && y < w.y + w.h) return true;
    return false;
  };
  for (let x = 0; x < TW; x++){
    for (let y = 0; y < TH; y++){
      const i = y*TW + x;
      if (s.d[i] === 0) continue;                    // only on solid pixels
      if (isWindow(x, y)) continue;                  // leave the glass alone
      const above = y > 0 ? s.d[i - TW] : 0;
      const left  = x > 0 ? s.d[i - 1] : 0;
      if (above === 0 || left === 0){
        /* a top or left-facing edge: catch the moonlight */
        s.d[i] = mixC(s.d[i], RIM, (above === 0 && left === 0) ? 0.55 : 0.38);
      } else {
        /* one row under a top edge gets a softer secondary rim */
        const a2 = y > 1 ? s.d[i - TW] : 0;
        if (a2 === 0) s.d[i] = mixC(s.d[i], RIM2, 0.22);
      }
    }
  }
  return s;
}

/* 8 phases of the running gear: two big driving wheels with spokes and a
   crank pin, a connecting rod between the pins, plus two small wheels.        */
function buildWheelPhase(ph){
  const s = newStrip(WHEEL_W, WHEEL_H);
  const put = (x,y,c) => sput(s, x, y, c);
  const ang = ph / 8 * Math.PI * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);

  const wheel = (cx, cy, r, spokes) => {
    /* tyre */
    for (let a = 0; a < 360; a += 4){
      const dx = Math.cos(a*Math.PI/180), dy = Math.sin(a*Math.PI/180);
      put(Math.round(cx + dx*r),     Math.round(cy + dy*r),     (dy < -0.2) ? TRN.ironHi : TRN.iron);
      put(Math.round(cx + dx*(r-1)), Math.round(cy + dy*(r-1)), TRN.bodyLo);
    }
    /* spokes, rotating with the phase */
    for (let k = 0; k < spokes; k++){
      const a2 = ang + k * Math.PI * 2 / spokes;
      for (let t = 1; t < r; t++)
        put(Math.round(cx + Math.cos(a2)*t), Math.round(cy + Math.sin(a2)*t), TRN.bodyLo);
    }
    put(cx, cy, TRN.brass);
  };

  const A = {x: 52 - WHEEL_X0, y: 37 - WHEEL_Y0};
  const B = {x: 80 - WHEEL_X0, y: 37 - WHEEL_Y0};
  const pinY = Math.round(3 * sa);

  /* connecting rod (behind the wheels) + crosshead to the cylinder */
  for (let x = A.x - 3; x <= B.x + 3; x++){ put(x, A.y + pinY, TRN.ironHi); put(x, A.y + pinY + 1, TRN.iron); }
  for (let x = B.x + 3; x <= 102 - WHEEL_X0; x++) put(x, A.y + pinY, TRN.iron);

  wheel(52  - WHEEL_X0, 37 - WHEEL_Y0, 6, 4);
  wheel(80  - WHEEL_X0, 37 - WHEEL_Y0, 6, 4);
  wheel(24  - WHEEL_X0, 39 - WHEEL_Y0, 4, 4);
  wheel(102 - WHEEL_X0, 40 - WHEEL_Y0, 4, 4);
  /* crank pins ride on top of the wheels */
  srect(s, A.x - 1, A.y + pinY - 1, 3, 3, TRN.brassHi);
  srect(s, B.x - 1, B.y + pinY - 1, 3, 3, TRN.brassHi);
  /* steam pipe running back to the smokebox — reinforces the wheel motion */
  for (let x = 44 - WHEEL_X0; x <= 96 - WHEEL_X0; x++)
    if ((x & 3) !== 0) put(x, 3, mixC(TRN.ironHi, TRN.brass, .35));
  return s;
}

/* =============================================================================
   BUILD EVERYTHING
   -----------------------------------------------------------------------------
   These are `let` and are produced by buildThemeStrips(), because a theme change
   re-materialises the SAME geometry with a different palette. The train sprite
   is the exception: it depends on TRN, so it is rebuilt too (and it is cheap —
   a 264x44 buffer).

   WINDOWS is the one thing that must survive a rebuild: it is a registry of lit
   panes filled by buildTrainBody(), and the flicker pass indexes it. Rebuilding
   the train appends to it, so it is cleared first and the count is asserted by
   verify.js to stay at 15.
   ========================================================================== */
let S_SKY, S_MTNF, S_MTNM, S_PINEF, S_PINEN, S_EMB, S_FORE, S_REEDS, S_FPINE, S_POLES;
let TRAIN, WHEELS = [];
const WINDOW_COUNT = 15;

function buildThemeStrips(T){
  WINDOWS.length = 0;                       // the flicker registry is rebuilt
  /* Foliage comes from the SEASON, tinted by the style, so spring is green even
     in the cyberpunk palette and winter is bare in all of them.

     NOTE: this mixes individual COLOURS with mixC, not mixPal. mixPal operates on
     a whole palette object (`for (const key in pal)`); passing it a single colour
     returned an empty object, so `ramp[0]` was `{}`, which stored as 0 — every
     tree pixel came out transparent and the forest vanished. That is why spring
     and summer produced byte-identical strips and the band measured 3 green px. */
  const fol = T.foliage;
  const tint = (base) => mixC(base, fol.a, 0.55);
  const far = [tint(PF.a), tint(PF.b), tint(PF.c)], farRim = mixC(PF.rim, fol.rim, 0.6);
  const near = [tint(PN.a), tint(PN.b), tint(PN.c)], nearRim = mixC(PN.rim, fol.rim, 0.6);

  S_SKY   = buildSky();
  S_MTNF  = buildRidge(MTNF_Y0, MTNF_H, 11, {pal:FARN, baseCycles:1, octaves:5, sharp:1.9, lift:6, hazeRows:14});
  S_MTNM  = buildRidge(MTNM_Y0, MTNM_H, 22, {pal:MIDN, baseCycles:2, octaves:5, sharp:2.4, lift:10, hazeRows:16});
  S_PINEF = buildForest(PINEF_Y0, PINEF_H, 33, 30, 14, 27, 5, far, farRim, PF.floor, T.bare);
    S_PINEN = buildForest(PINEN_Y0, PINEN_H, 44, 20, 18, 32, 6, near, nearRim, PN.floor, T.bare);
  /* telegraph poles + catenary wire: 48px spacing over 480px = 10 poles, so the
     strip tiles exactly and the parallax stays a single integer blit offset */
  S_POLES = buildPoles(POLES_Y0, POLES_H, 77, 48, POL);
  S_EMB   = buildEmbankment();
  S_FORE  = buildForeBank();
  S_REEDS = buildReeds();
  S_FPINE = buildForest(FOREP_Y0, FOREP_H, 55, 12, 26, 52, 8, near, nearRim, 0);
  TRAIN   = buildTrainBody();
  WHEELS  = [];
  for (let i = 0; i < 8; i++) WHEELS.push(buildWheelPhase(i));

  /* --- bake the moon into the sky plate ------------------------------------
  The moon is the one zero-parallax object, so it is painted into S_SKY once
  at build time and never redrawn per frame. ORDER MATTERS: blit the freshly
  built sky plate into `fb` FIRST, then stamp the moon into `fb`, then copy
  `fb` back into S_SKY. Clearing S_SKY and blitting fb before the sky exists
  leaves an all-zero sky (this shipped broken once already).

  The moon is only baked at night. It used to be baked unconditionally, so a
  DAYLIGHT theme carried a bright cratered moon across a blue sky — the
  strongest single "this is night" cue, and the reason the day scene still
  read as night after every other fix. */
  blitStrip(S_SKY, 0, 0, true);            // paint the new sky into fb
  if (T.tod === "night") bakeMoon();         // moon disc, zero parallax
  else { bakeHalo(0.34, 30, 26, 10); bakeSunDisc(); }     // sun bloom + disc
  S_SKY.d.set(fb);                           // keep that result as the baked plate
}

/* Halo bloom, baked into the sky plate. R/A/colour are per-celestial-body. */
function bakeHalo(A, cr, cg, cb){
  const R = 46;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++){
    const d = Math.sqrt(dx*dx + dy*dy); if (d > R || d < 8) continue;
    const a = Math.pow(1 - (d - 8) / (R - 8), 2.4) * A;
    if (a <= 0.004) continue;
    const x = MOON_X + dx, y = MOON_Y + dy;
    if (x < 0 || x >= VW || y < 0 || y >= VH) continue;
    if (bayer01(x, y) >= a * 0.9) continue;
    addPix(x, y, cr*a, cg*a, cb*a);
  }
}

/* Sun disc, baked. Small hard core, soft edge, warm — the sun is nearer and
   harsher than the moon, which is why it is a smaller disc. */
function bakeSunDisc(){
  const R = 11;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++){
    const d = Math.sqrt(dx*dx + dy*dy);
    if (d > R) continue;
    const x = MOON_X + dx, y = MOON_Y + dy;
    if (x < 0 || x >= VW || y < 0 || y >= VH) continue;
    const k = d > R - 2 ? 0.55 + 0.45 * (1 - (d - (R - 2)) / 2) : 1;
    fb[y*VW + x] = _pack(clamp(Math.round(255 * k), 0, 255),
                        clamp(Math.round(250 * k), 0, 255),
                        clamp(Math.round(214 * k), 0, 255));
  }
}

/* =============================================================================
   DIRECTION — WHY THE CONSIST IS LAID OUT THIS WAY
   -----------------------------------------------------------------------------
   The world scrolls LEFT (blitStrip reads source x+offset, so increasing
   offsets move content left), which means the train travels to the RIGHT. A
   locomotive must therefore be the RIGHTMOST element of the consist, facing
   right, with the carriages trailing behind it on the left.

   The layout inside buildTrainBody() is:
       [ carriage ][ carriage ][ carriage ][ locomotive ]   <- front on the right
            0..141                                   142..250

   This is a REORDER, not a mirror. Mirroring the sprite would have put the
   cab at the right and the smokebox/headlamp at the left — engine facing back
   down the train, which is just as wrong as the original. The loco's internal
   geometry (cab at its left/rear, boiler, smokebox, chimney, headlamp and
   pilot bars at its right/front) stays exactly as authored; only the block
   positions move.
   ========================================================================== */

/* Reflection snapshot buffer. */
const SNAP = new Uint32Array(SNAP_ROWS * VW);

/* Vignette mask, precomputed. */
const VIG = new Uint8Array(VW * VH);
for (let y = 0; y < VH; y++) for (let x = 0; x < VW; x++){
  const nx = (x / VW - 0.5) * 2, ny = (y / VH - 0.5) * 2;
  const d = Math.sqrt(nx*nx*0.82 + ny*ny);
  VIG[y*VW + x] = Math.round(255 * clamp((d - 0.62) / 0.85, 0, 1) * 0.30);
}

/* Puddle layout: world-x on the 32px/s bank layer, 3 per 480px tile. */
const PUDDLES = (function(){
  const r = mulberry32(31337), a = [];
  for (let i = 0; i < 3; i++) a.push({
    x: Math.floor(r()*VW),
    y: 244 + Math.floor(r()*8),
    pw: 16 + Math.floor(r()*16),
    ph: 4 + Math.floor(r()*3)
  });
  return a;
})();

/* Dust motes. */
const MOTES = (function(){
  const r = mulberry32(8080), a = [];
  for (let i = 0; i < 70; i++)
    a.push({ x: r()*VW, y: 96 + r()*66, p: r()*6.28, k: 2 + Math.floor(r()*7), s: 0.4 + r()*0.8 });
  return a;
})();

/* Stars. */
const STARS = (function(){
  const r = mulberry32(3131), a = [];
  for (let i = 0; i < 150; i++){
    const y = 2 + Math.pow(r(), 1.5) * 100;
    a.push({ x: r()*VW, y, b: 0.25 + Math.pow(r(), 2.2)*0.75, k: 2 + Math.floor(r()*9), p: r()*6.28 });
  }
  return a;
})();

/* =============================================================================
   RENDER PASSES
   ========================================================================== */

/* --- moon halo: painted BEFORE the stars so stars read as being in front ---
   The halo never changes, so its contribution list is BAKED ONCE at boot.
   Previously this recomputed sqrt() and the falloff for all 69x69 = 4761
   candidate pixels every frame and then threw most of them away in the dither
   test. The baked list holds only the ~1900 pixels that actually contribute,
   already in linear RGB, so the per-frame pass is a flat replay. */
const HALO = (function(){
  const out = [];
  for (let dy = -34; dy <= 34; dy++) for (let dx = -34; dx <= 34; dx++){
    const d = Math.sqrt(dx*dx + dy*dy); if (d > 34 || d < 8) continue;
    const a = Math.pow(1 - (d - 8) / 26, 2.4) * 0.5;
    if (a <= 0.004) continue;
    out.push(MOON_X + dx, MOON_Y + dy, 34*a, 46*a, 82*a, a * 0.9);
  }
  return new Float32Array(out);
})();

function drawStars(t){
  const off = SPD_STAR * t;
  /* LOOP CRITICAL: the offset must be reduced mod VW *before* being split into
     floor/fraction. At t=120 the raw offset is exactly 480, so Math.floor gives
     480 while at t=0 it is 0 — and although both wrap to the same column when
     added to a star's x and taken mod VW, the FRACTION differs (0 vs 0) only by
     floating-point, and the Bayer threshold compares that fraction against a
     per-pixel threshold, so a handful of stars land one pixel apart. Reducing
     the offset first makes the two frames provably identical. */
  const offM = ((off % VW) + VW) % VW;
  const fi = Math.floor(offM), fr = offM - fi;
  for (let i = 0; i < STARS.length; i++){
    const st = STARS[i];
    const tw = 0.55 + 0.45 * Math.sin(2*Math.PI * st.k * (t / LOOP_SECONDS) + st.p);
    const b = st.b * tw;
    if (b <= 0.06) continue;
    const bright = b > 0.72;
    const col = b > 0.86 ? _pack(0xff,0xff,0xff) : (b > 0.55 ? _pack(0xd8,0xe6,0xf4) : _pack(0x9f,0xb4,0xcc));
    /* JS `%` keeps the dividend's sign, so wrap a negative index explicitly. */
    let j0 = Math.floor(st.x - fi) % VW; if (j0 < 0) j0 += VW;
    /* 1px, or 2px for the brightest, with a Bayer-thresholded sub-pixel slide */
    if (bayer01(j0, st.y) >= fr){
      putStar(j0, st.y, col, b, bright);
    } else {
      let j1 = j0 + 1; if (j1 >= VW) j1 -= VW;
      putStar(j1, st.y, col, b, bright);
    }
  }
}
function putStar(x, y, col, b, big){
  fb[y*VW + x] = col;
  if (big && b > 0.9){ fb[y*VW + (x + 1 < VW ? x + 1 : x - 1)] = mixC(fb[y*VW + x], col, 0.55); }
}

/* --- moon disc with limb darkening + craters ------------------------------
   Completely static: the moon is the one zero-parallax object, so it is baked
   into the sky strip at build time and never redrawn. That removes a per-frame
   23x23 disc + crater + rim pass (measured 0.99 ms) for free.                 */
function bakeMoon(){
  for (let dy = -MOON_R; dy <= MOON_R; dy++)
    for (let dx = -MOON_R; dx <= MOON_R; dx++){
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d > MOON_R) continue;
      const limb = Math.pow(clamp(1 - (d / MOON_R) * 0.92, 0, 1), 0.42);
      let c = mixC(MOO.limb, MOO.core, limb);
      c = mixC(c, MOO.dark, 0.18 * (1 - limb));
      c_at(MOON_X + dx, MOON_Y + dy, c);
    }
  const craters = [[-4,-2,3.1],[3,3,2.3],[-1,5,1.5],[5,-4,1.2]];
  for (const [ox, oy, r] of craters)
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++){
        const d = Math.sqrt(dx*dx + dy*dy); if (d > r) continue;
        c_at(MOON_X + ox + dx, MOON_Y + oy + dy,
             mixC(fb[(MOON_Y+oy+dy)*VW + MOON_X+ox+dx], MOO.dark, 0.30 * (1 - d/r)));
      }
  /* 1px inner rim highlight, upper-left (light comes from the left) */
  for (let a = 150; a < 250; a += 4){
    const dx = Math.round(Math.cos(a*Math.PI/180) * (MOON_R - 0.5));
    const dy = Math.round(Math.sin(a*Math.PI/180) * (MOON_R - 0.5));
    c_at(MOON_X + dx, MOON_Y + dy, mixC(fb[(MOON_Y+dy)*VW + MOON_X + dx], 0xffffff, 0.35));
  }
}
function c_at(x, y, c){ if (x >= 0 && x < VW && y >= 0 && y < VH) fb[y*VW + x] = c; }

/* --- the train: body, running gear, windows, halos ------------------------- */
function drawTrain(t){
  /* body */
  for (let y = 0; y < TH; y++)
    for (let x = 0; x < TW; x++){
      const c = TRAIN.d[y*TW + x];
      if (c !== 0) fb[(TY + y) * VW + TX + x] = c;
    }
  /* running gear — 1/8-turn steps, 48 revolutions per loop (integer!) */
  const ph = Math.floor(t * 3.2) % 8;
  const ws = WHEELS[ph];
  for (let y = 0; y < WHEEL_H; y++)
    for (let x = 0; x < WHEEL_W; x++){
      const c = ws.d[y*WHEEL_W + x];
      if (c !== 0) fb[(TY + WHEEL_Y0 + y) * VW + TX + WHEEL_DRAW_X + x] = c;
    }

  /* window flicker: hash of (seed, loop-local 7Hz counter) — 840 steps/loop */
  const flick = Math.floor(t * 7) % 840;
  for (let i = 0; i < WINDOWS.length; i++){
    const W = WINDOWS[i];
    const x0 = TX + W.x, y0 = TY + W.y;
    if (W.dark){
      for (let j = 0; j < W.h; j++) for (let k = 0; k < W.w; k++)
        fb[(y0 + j) * VW + x0 + k] = mixC(WRM.off, TRN.win, 0.35);
      continue;
    }
    let L = 0.80 + 0.20 * Math.sin(2*Math.PI * (2 + W.seed) * (t / LOOP_SECONDS));
    if (hash2(W.seed, flick, 3) < 0.055) L *= 0.22;          // occasional dip
    if (W.lamp) L = 0.88 + 0.12 * L;
    const c = mixC(WRM.warm, WRM.hot, clamp(L, 0, 1));
    for (let j = 0; j < W.h; j++) for (let k = 0; k < W.w; k++)
      fb[(y0 + j) * VW + x0 + k] = (k === 0 && j === 0) ? mixC(c, 0xffffff, .35) : c;
    /* dithered additive halo — the light spills into the night air */
    const R = (W.lamp ? 12 : 3) + Math.round(4 * L);
    const gg = W.lamp ? 150 : 88, bb = W.lamp ? 60 : 26;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++){
      const d = Math.sqrt(dx*dx + dy*dy); if (d > R) continue;
      const a = Math.pow(1 - d / R, 2.1) * (W.lamp ? 0.55 : 0.38) * L;
      addDith(x0 + W.w/2 + dx, y0 + W.h/2 + dy, gg*a, gg*0.66*a, bb*a, a);
    }
  }
}

/* ---- preallocated per-column falloff for the consist's ambient glow --------
   Allocated once at module scope, NOT per frame: this pass runs 60x/second and
   a per-frame Float32Array would create a steady stream of garbage, which
   shows up as a long tail of slow frames rather than a higher mean. */
const GLOW_X0 = TX - 14, GLOW_X1 = Math.min(VW, TX + TW + 16);
const GLOW_FALL = new Float32Array(GLOW_X1 - GLOW_X0);

/* --- headlamp cone + the pool of warm light the consist throws ------------ */
function drawTrainLight(t){
  const throb = 0.86 + 0.14 * Math.sin(2*Math.PI * 5 * (t / LOOP_SECONDS));
  /* Headlamp lens, at the very front of the consist: authored x=118 in the
     locomotive block, so on the sprite it is 130+118 = 248. */
  const LX = TX + LOCO_ORIGIN + 118, LY = TY + 18;

  /* forward cone, spreading and dimming */
  for (let d = 1; d <= 82; d++){
    const x = LX + d; if (x >= VW) break;
    const halfw = 2.4 + d * 0.20;
    const fall = 1 - d / 82;
    for (let dy = -Math.ceil(halfw); dy <= Math.ceil(halfw); dy++){
      const av = Math.abs(dy) / halfw; if (av > 1) continue;
      const a = fall * fall * (1 - av) * 0.42;
      addDith(x, LY + dy, 150*(1-av*0.5), 116*(1-av*0.5), 48*(1-av*0.5), a);
    }
  }
  /* lamp bloom right at the lens */
  for (let dy = -7; dy <= 7; dy++) for (let dx = -7; dx <= 7; dx++){
    const d = Math.sqrt(dx*dx + dy*dy); if (d > 7) continue;
    const a = Math.pow(1 - d/7, 2) * 0.6;
    addDith(LX + dx, LY + dy, 130, 108, 62, a);
  }
  /* ambient glow: the consist washes the ballast, the tree bases and the air.
     This is the single most expensive pass (~8,800 lit pixels). It was calling
     addPix() per pixel, which re-does a bounds check, three channel unpacks,
     three clamps and a function call each time. The falloff is a smooth
     4th-power in y and a raised cosine in x, so the per-row and per-column
     factors are hoisted and the inner loop becomes pure arithmetic on the
     packed pixel. */
  const cx = TX + TW * 0.62, halfSpan = TW * 0.78;
  /* The column falloff table is preallocated at module scope; recompute it only
     when the geometry changes (it never does after boot), so this is a no-op
     warm-up rather than per-frame work. */
  for (let x = GLOW_X0; x < GLOW_X1; x++){
    const hx = (x - cx) / halfSpan;
    const hf = 1 - hx * hx;
    GLOW_FALL[x - GLOW_X0] = hf > 0 ? hf : 0;
  }
  for (let y = 138; y <= RAIL_Y; y++){
    const vr = 1 - (RAIL_Y - y) / 30;
    const a = vr * vr * vr * 0.62 * throb;
    if (a <= 0.003) continue;
    const ar = 40 * a, ag = 25 * a, ab = 8 * a;
    const row = y * VW;
    for (let x = GLOW_X0; x < GLOW_X1; x++){
      const hf = GLOW_FALL[x - GLOW_X0];
      if (hf <= 0) continue;
      const i = row + x, c = fb[i];
      let nr = _cr(c) + ar * hf; if (nr > 255) nr = 255;
      let ng = _cg(c) + ag * hf; if (ng > 255) ng = 255;
      let nb = _cb(c) + ab * hf; if (nb > 255) nb = 255;
      fb[i] = PACK_FAST(nr, ng, nb);
    }
  }
}

/* --- smoke ----------------------------------------------------------------
   300 slots, one emission every 0.4s => 300 * 0.4 = 120s, exactly one loop.
   Every particle's position is a PURE FUNCTION OF ITS AGE, so there is no
   spawn state, no reset, and the plume is exactly periodic.

   LOOP CRITICAL: a naive `age = t - emissionTime` is NOT periodic. At t=0 the
   live slots are #0..17; at t=120 they would be #283..299, so the frame would
   jump. Ages are therefore taken MODULO the loop: a slot's age wraps back to 0
   the instant it would have aged out, which is exactly the emission event that
   already happens in real time. Nothing pops, and the system is seamless.

   PERF: this pass measured 11.8 ms — the most expensive in the piece. Two fixes:
     - `Math.exp` twice per particle (600 calls/frame) became a 256-entry table.
       Only 300 distinct ages are ever seen across the whole loop, so the table
       is exact rather than an approximation.
     - the per-pixel `Math.sqrt` in the puff scan became a squared-distance
       compare against r*r, which is the same test without the call.            */
const SMOKE_N = 300, SMOKE_DT = 0.4, SMOKE_LIFE = 9.0, SMOKE_REL = 150;

/* exp(-a/tau) table, indexed by age in milliseconds. Exact for the 300 ages the
   loop can produce (a is always a multiple of the frame quantum), and linear
   in between. Saves 600 transcendental calls per frame. */
const SEXP_N = 1024;
const SEXP_TAU_X = [], SEXP_TAU_Y = [], SEXP_R = [];
for (let i = 0; i < SEXP_N; i++){
  const a = i / 1000;
  SEXP_TAU_X.push(Math.exp(-a / 2.5));
  SEXP_TAU_Y.push(Math.exp(-a / 1.8));
  SEXP_R.push(Math.exp(-a / 1.15));
}

function drawSmoke(t){
    const HMAX = 34;
    for (let k = 0; k < SMOKE_N; k++){
    const et = k * SMOKE_DT;
    /* LOOP CRITICAL: age must be taken MODULO the loop.
    `let a = t - et; if (a < 0) a += 120` is WRONG: at t=0 slots 0..17 have
    small ages and slots 283..299 become negative, then wrap to ~119.4 (a
    slot that "just emitted"); at t=120 the same slots are at age ~0.0. So
    the two boundary frames put a particle in completely different places —
    exactly one pixel differed, at (204,126).
    The correct transform is modular: age = (t - et) mod 120, so slot 283 at
    t=0 has age 119.6 (dead, culled) and at t=120 has age 0.0 (freshly
    emitted). The live set is then identical at both boundaries. */
    let a = (t - et) % LOOP_SECONDS; if (a < 0) a += LOOP_SECONDS;
    if (a > SMOKE_LIFE) continue;          // only the fresh tail is drawn
    /* table lookup instead of Math.exp — see the perf note above */
    const ai = (a * 1000) | 0;
    const ex = 1 - SEXP_TAU_X[ai < SEXP_N ? ai : SEXP_N - 1];
    const ey = 1 - SEXP_TAU_Y[ai < SEXP_N ? ai : SEXP_N - 1];
    const px = STACK_X - 0.15 * SMOKE_REL * 2.5 * ex;
    const py = STACK_Y - HMAX * ey;
    /* BILLLOW: puffs swell faster and reach further, and the drift gets a slow
    sinusoidal wander so the column is not a straight diagonal streak. The
    wander uses integer cycle counts so it stays exactly periodic. */
    const wander = 2.6 * SIN[(TAU8 * (2*Math.PI*3*(a / LOOP_SECONDS) + k * 1.7)) & SIN_MASK] * Math.min(1, a / 2.5);
    const r  = 1.6 + 5.4 * (1 - SEXP_R[ai < SEXP_N ? ai : SEXP_N - 1]);
    /* Cull the whole puff once it is fully faded or off the top of the frame.
    Without this the pass still ran 300 iterations of the outer loop and the
    inner scan for particles that contribute nothing, which measured 4.0 ms
    — the single most expensive pass in the piece. */
    const fade = a < 1.0 ? 1 : 1 - (a - 1.0) / (SMOKE_LIFE - 1.0);
    if (fade <= 0.02) continue;
    const cxp = px + wander;
    if (py - r < 0 || cxp + r < 0 || cxp - r >= VW) continue;
    /* warm near the stack, cooling as it climbs */
    const base = mixC(SMK.warm, SMK.high, clamp(a / 2.4, 0, 1));
    const br = _cr(base), bg = _cg(base), bb = _cb(base);
    const ri = Math.ceil(r);
        const r2 = r * r, innerR = r * 0.58, mid2 = r * 0.78, midR2 = mid2 * mid2;
        for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++){
        const d2 = dx*dx + dy*dy;
        /* squared-distance tests: identical to the d/r form but no Math.sqrt per
           pixel except on the thin fringe where the falloff actually needs d */
        if (d2 > r2) continue;
        let a2;
        if (d2 < innerR * innerR) a2 = fade;               /* solid core */
        else {
          const kd = Math.sqrt(d2) / r;
          a2 = fade * (1 - (kd - 0.58) / 0.42) * (0.55 + 0.45 * hash2(px+dx|0, py+dy|0, 3));
        }
        if (a2 <= 0.02) continue;
    const x = Math.round(cxp + dx), y = Math.round(py + dy);
    if (x < 0 || x >= VW || y < 0 || y >= VH) continue;   // no clipping: written direct
    if (bayer01(x, y) >= a2) continue;
    /* The plume read as a faint thin streak at 288 changed px/frame. Steam at
    night is a bright opaque mass near the stack, so the core is a solid
    light grey and only the fringe is dithered. Packed in place because the
    enlarged plume made the accessor calls the dominant cost. */
    if (d2 < midR2){
    const i = y*VW + x, c = fb[i];
    const m = Math.min(1, 0.34 + 0.60 * a2);
    fb[i] = PACK_FAST(_cr(c) + (br - _cr(c)) * m,
    _cg(c) + (bg - _cg(c)) * m,
    _cb(c) + (bb - _cb(c)) * m);
    } else {
    const i = y*VW + x, c = fb[i];
    fb[i] = PACK_FAST(_cr(c) + 52*a2, _cg(c) + 50*a2, 58*a2);
    }
    }
    }
}

function drawMotes(t){
  const off = SPD_STAR * t, step = Math.floor(t * 20) % 2400;
  for (const m of MOTES){
    const x = ((m.x - off) % VW + VW) % VW;
    const y = m.y + Math.sin(2*Math.PI * m.k * (t / LOOP_SECONDS) + m.p) * 3.2;
    const b = 0.25 + 0.75 * hash2(x|0, y|0, step);
    if (b < 0.55) continue;
    addDith(x|0, Math.round(y), 90, 92, 110, b * 0.5 * m.s);
  }
}

/* --- WATER: real-time reflection -------------------------------------------
   The composited scene above the waterline is snapshotted, then each water row
   re-samples it with a stylised vertical compression, a world-space horizontal
   wobble, a 2-tap vertical smear, a depth tint, ordered dithering and a
   world-locked sparkle layer. The moon gets an analytic glitter path.         */
function snapshotScene(){
  for (let r = 0; r < SNAP_ROWS; r++){
    const src = (SNAP_Y0 + r) * VW, dst = r * VW;
    for (let x = 0; x < VW; x++) SNAP[dst + x] = fb[src + x];
  }
}

function drawWater(t, T){
  const waveStep = Math.floor(t * 10) % 1200;         // 1200 steps / loop
  const glitStep = Math.floor(t * 15) % 1800;         // 1800 steps / loop
  const last = SNAP_ROWS - 1;
  /* Precomputed sine lookup. Math.sin per pixel was the single biggest cost in
     the whole piece (this loop runs 72 * 480 = 34,560 times a frame); a
     2048-entry table indexed by angle removes it entirely. Because the phase
     terms use integer cycle counts over LOOP_SECONDS, the table lookup is
     still exactly periodic. */
  const phA = 2*Math.PI*7*(t/LOOP_SECONDS), phB = 2*Math.PI*3*(t/LOOP_SECONDS);
  const phC = 2*Math.PI*2*(t/LOOP_SECONDS);
  const gSeed = glitStep * 13;                        // hoisted out of the pixel loop
  /* Weather ripple: rain breaks the reflection up (a bigger per-row wobble),
     snow and clear calm it. This is read from the theme, not hard-coded, so the
     water visibly reacts to the weather toggle. */
  const rip = T ? T.ripple : 0;
  const wAmp = 1 + rip * 2.2;

  for (let d = 0; d < LAKE_H; d++){
    const y = LAKE_Y0 + d;
    const depth = d / (LAKE_H - 1);
    /* vertical compression: d=0 samples the waterline, deep water samples the sky */
    const sBase = last - Math.floor(d * 1.9);
    /* world-locked horizontal wobble: two integer-frequency sine terms */
    const wob = Math.round((SIN[(TAU8 * (phA + d * 0.85) | 0) & SIN_MASK] * 1.7
                         + SIN[(TAU8 * (phB + d * 0.31 + 0.9) | 0) & SIN_MASK] * 1.1) * wAmp);
    /* the crest-offset term also depends only on (t, d) — precompute per row */
    const rowShift = Math.round(SIN[(TAU8 * (phC + d * 0.4) | 0) & SIN_MASK] * 1.2);
    const rowShiftI = rowShift >= 0 ? rowShift : -1;      // floor for negative
    const rowShiftF = rowShift >= 0 ? 0 : 1;               // frac  for negative
    const dShade = Math.floor(d * 2.7);
    const glitY  = d * 3 + glitStep;
    const gwid   = 3.5 + d * 0.42;
    let si = sBase + wob; if (si < 0) si = 0; else if (si > last) si = last;
    const siNext = (si + 1 <= last ? si + 1 : last) * VW;
    const siOff  = si * VW;
    const k      = 0.74 - depth * 0.30;
    const kr = k * 0.86, kg = k * 0.96, kb = k * 1.12;
    const r0 = y * VW;

    for (let x = 0; x < VW; x++){
      /* 2-tap vertical smear, packed in place: no accessor calls, no allocation */
      const c0 = SNAP[siOff + x], c1 = SNAP[siNext + x];
      let r = ((c0 & 255) + (c1 & 255)) * 0.5 * kr + 5;
      let g = (((c0 >>> 8) & 255) + ((c1 >>> 8) & 255)) * 0.5 * kg + 7;
      let b = (((c0 >>> 16) & 255) + ((c1 >>> 16) & 255)) * 0.5 * kb + 12;

      /* ordered dither the tint so it breaks into crosshatch, not a gradient */
      if (BAYER[(y & 3) * 4 + (x & 3)] < 5.5){ r *= 0.86; g *= 0.90; b *= 0.98; }

      /* pixel wave lines: 1px crests, world-locked, perfectly periodic.
         floor(x/9 + rowShift) is decomposed EXACTLY into
            floor(rowShift) + floor(x/9) + carry(frac(x/9) + frac(rowShift))
         using two precomputed tables, so the inner loop does no division and no
         Math.floor. The carry term is omitted here because rowShift is
         Math.round()ed, so its fraction is always exactly zero. */
      const wl = (waveStep + dShade + rowShiftI + WL_BASE[x]) % 11;
      if (wl === 0){ r += 16; g += 20; b += 30; }
      else if (wl === 1 && HASH_W[x] > 0.55){ r += 6; g += 8; b += 13; }

      let R = r, G = g, B = b;
      if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;

      /* moon glitter path: a widening column of high-frequency sparkle.
         The column is only ~4..34 px wide, so most pixels skip this entirely
         with a single range test. HASH_G is indexed modulo 4096 (it is a
         power of two, so this is a mask, not a modulo). */
      const gdx = x - MOON_X;
      if (gdx >= -gwid && gdx <= gwid){
        const adx = gdx < 0 ? -gdx : gdx;
        const f = 1 - adx / gwid;
        if (HASH_G[(x + gSeed) & 4095] < f*f*0.55 + 0.015){
          R += 78*f; G += 108*f; B += 140*f;
          if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
        }
      }
      /* inlined, endianness-correct pack: three clamps + three shifts */
      fb[r0 + x] = PACK_FAST(R, G, B);
    }
    /* bright shoreline where the water meets the embankment */
    if (d === 0) for (let x = 0; x < VW; x++)
      fb[r0 + x] = mixC(fb[r0 + x], WAT.rim, 0.55);
  }
}

/* --- PUDDLES: heavy-squash reflections on the near bank --------------------
   Each puddle row samples the snapshot with a strong per-pixel crumple offset.
   The two crumple sines are evaluated through the SIN table (they were raw
   Math.sin per pixel and dominated this pass at 6.9 ms). Their phase includes
   an integer-frequency term over the loop, so periodicity is preserved.      */
/* --- PUDDLES: heavy-squash reflections on the near bank --------------------
   Weather-driven. Puddles exist because it rained: they scale in with
   `T.ripple`, freeze over in winter, and vanish under a clear sky. The user
   brief asks specifically for puddles as a theme asset, so presence is gated on
   the resolved theme rather than being unconditional as it was in v1..v3.

   LOOP CRITICAL: same mod-VW rule as the starfield. SPD_FORE * 120 = 3840,
   which is exactly 8 tiles, so the integer base must be reduced before use or
   the two loop-boundary frames place each puddle on a different column.       */
function drawPuddles(t, T){
  /* Rain fills the puddles; a clear sky dries them; winter ices them over.
     A puddle with no water in it is a dark stain, so scale the whole layer by
     how much water is actually present. */
  const wet = T.ripple || 0;
  if (wet <= 0.01) return;
  const iced = T.ice ? 0.55 : 1;                    // ice reads paler and flatter
  const strength = Math.min(1, wet * 1.6) * iced;
  const offM = ((SPD_FORE * t) % VW + VW) % VW;
  const phC = TAU8 * 2*Math.PI*(t/LOOP_SECONDS);   // integer cycle 1 -> periodic
  for (let inst = -1; inst <= 1; inst++){
    const base = Math.floor(offM) + inst * VW;
    for (const p of PUDDLES){
      const px0 = p.x + base;
      const rows = p.ph * 2;
      for (let r = 0; r < rows; r++){
        const yy = p.y + r;
        if (yy < FORE_Y0 || yy >= VH) continue;
        const dy = (r - (p.ph - 0.5)) / p.ph;
        /* LOOP/DENSITY CRITICAL: the original guard was `if (|dy| > 1) continue`,
           which culled the ellipse's top and bottom rows and left unpainted
           holes in the bank. An ellipse row is valid for |dy| <= 1 inclusive;
           at the extremes halfw is 0 and the row is a single lit meniscus pixel,
           which is exactly what makes a puddle read as a wet lens. */
        if (dy > 1 || dy < -1) continue;
        const halfw = Math.round(p.pw * Math.sqrt(1 - dy*dy));
        const q = r / (rows - 1);
        let si = SNAP_ROWS - 1 - Math.floor(q * 66);
        if (si < 0) si = 0;
        const siOff = si * VW;
        /* Per-row crumple phase, in TABLE units so the inner loop is pure
           table indexing plus one mask. */
        const rA = r * 2.1, rB = phC - r * 1.3;
        const k55 = TAU8 * 0.55, k21 = TAU8 * 0.21;
        const tA = TAU8 * rA, tB = TAU8 * rB;
        for (let dx = -halfw; dx <= halfw; dx++){
          let x = (px0 + dx) % VW; if (x < 0) x += VW;
          /* Gate on `strength`: a puddle under a clear sky is a dark stain, not
             water, so pixels are skipped entirely rather than drawn faintly. This
             keeps the layer absent when it should be, which is what the theme
             buttons promise. */
          if (bayer01(x, yy) >= strength) continue;
          const crum = Math.round(2.5 * SIN[(k55 * x + tA) & SIN_MASK]
                               + 1.4 * SIN[(k21 * x + tB) & SIN_MASK]);
          let sx2 = (x + crum) % VW; if (sx2 < 0) sx2 += VW;
          const c0 = SNAP[siOff + sx2];
          let r2 = (c0 & 255) * 0.44, g2 = ((c0 >>> 8) & 255) * 0.50, b2 = ((c0 >>> 16) & 255) * 0.66;
          /* winter: pull the reflection toward pale ice instead of a mirror */
          if (T.ice){ r2 = r2 * 0.55 + 34; g2 = g2 * 0.55 + 42; b2 = b2 * 0.50 + 56; }
          if (bayer01(x, yy + 1) < 0.3) { r2 *= 0.84; g2 *= 0.9; b2 *= 0.98; }
          fb[yy*VW + x] = PACK_FAST(r2, g2, b2);
          /* 1px meniscus: the lit top edge of the puddle */
          if (r === 0) fb[yy*VW + x] = mixC(fb[yy*VW + x], WAT.rim, 0.75);
        }
      }
    }
  }
}

/* --- vignette (border band only, so it stays cheap) ------------------------ */
function drawVignette(){
  for (let i = 0; i < VIG.length; i++){
    const v = VIG[i]; if (v === 0) continue;
    const c = fb[i];
    const k = 1 - v / 255;
    fb[i] = _pack((_cr(c)*k)|0, (_cg(c)*k)|0, (_cb(c)*k)|0);
  }
}

/* =============================================================================
   ONE FRAME
   ========================================================================== */
function render(tIn, T){
  /* =======================================================================
     LOOP CANONICALISATION — the single most important line in this file.
     Everything downstream is a function of `t`, so reducing it into
     [0, LOOP_SECONDS) HERE makes t=120 evaluate to bit-identical arithmetic to
     t=0, rather than relying on each subsystem to be separately periodic.

     Two bugs this kills outright:
       1. Smoke. Particle age must wrap, and a conditional `if (a<0) a+=120`
          does not wrap symmetrically.
       2. Puddle crumple. Its phase term is TAU8 * (2*PI * t/120), so at t=120
          the table index is pre-mask ~667,537. Truncating a number that large
          to int32 loses the last bits, and the Bayer/sine thresholds then flip
          on a handful of pixels. Folding t to 0 first keeps every intermediate
          small and identical.
     ======================================================================= */
  let t = tIn % LOOP_SECONDS; if (t < 0) t += LOOP_SECONDS;
  if (!T) T = ACTIVE_THEME || resolveTheme(DEFAULT_THEME, "summer");

  /* --- 0. sky base plate, FULL FRAME HEIGHT, fully opaque.
         This is what fills everything the terrain layers leave transparent. */
  blitStrip(S_SKY, 0, 0, true);

  /* --- 1. celestial body. The DISC itself is baked into the sky strip at build
          time (zero parallax), so only the halo is drawn per frame. */
  if (T.stars) drawStars(t);
  drawClouds(t, T);

  /* --- 2..5. terrain strips, back to front.
         CRITICAL: every one of these is TRANSPARENT-ABOVE (`opaque:false`).
         A ridge only writes pixels at and below its own silhouette; the sky
         shows through above it. Passing opaque:true here would erase the sky
         and punch black holes into the horizon. */
  blitStrip(S_MTNF,  MTNF_Y0,  SPD_MTNF  * t, false);
  blitStrip(S_MTNM,  MTNM_Y0,  SPD_MTNM  * t, false);
  blitStrip(S_PINEF, PINEF_Y0, SPD_PINEF * t, false);
  blitStrip(S_PINEN, PINEN_Y0, SPD_PINEN * t, false);
  drawSnowCaps(T);

  /* --- 6. embankment. NOTE: `opaque:false` is essential, not an oversight.
         The strip's wavy crest leaves the top rows transparent so the sky shows
         through. blitStrip with opaque:true would write those transparent slots
         as literal 0x000000, punching black holes along the crest. The band is
         still fully covered because the sky base plate is underneath it. */
  blitStrip(S_POLES, POLES_Y0,  SPD_POLES * t, false);
  blitStrip(S_EMB,   EMB_Y0,   SPD_EMB   * t, false);

  /* --- 7. the train (camera-locked) and everything it lights */
  drawTrain(t);
  drawTrainLight(t);

  /* --- 8. airborne particulate: engine smoke first (it is scene, not weather),
         then the theme's precipitation on top. */
  drawSmoke(t);
  drawPrecip(t, T);
  drawMotes(t);

  /* --- 9. water: snapshot the world, then reflect it back.
         The embankment is included in the snapshot, so the rail line itself
         shows in the water — which is exactly the detail that sells water. */
  snapshotScene();
  drawWater(t, T);
  drawIce(T);

  /* --- 10. foreground occluders and the near bank (the bank crest is wavy too) */
  blitStrip(S_FPINE, FOREP_Y0, SPD_FORE * t, false);
  blitStrip(S_FORE,  FORE_Y0,  SPD_FORE * t, false);
  blitStrip(S_REEDS, FORE_Y0,  SPD_FORE * t, false);
  drawPuddles(t, T);
  /* Litter goes AFTER the foreground pines. Drawn before them it was hidden
     behind 64px of occluding conifer and read as "no leaf litter at all". */
  drawGroundLitter(t, T);
  drawSpringDetail(t, T);
  drawLeafFall(t, T);
  drawLightShafts(t, T);

  /* --- 11. style set-dressing, drawn late so it sits in front of the scene */
  drawTorii(T);
  drawNeon(T, t);
  drawHeatHaze(t, T);

  /* --- 12. grade */
  drawVignette();
}

