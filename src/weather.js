/* =============================================================================
   MIDNIGHT MERIDIAN — THEME PARTICLE SYSTEMS & SCENERY OVERLAYS
   -----------------------------------------------------------------------------
   Every system here follows the same loop-safety rule the rest of the piece uses:

       position = f(age),  age = (t - emission) mod 120

   so there is no spawn state to reset and the frame at t=120 is bit-identical to
   the frame at t=0. Oscillations use integer cycle counts over 120s. The theme is
   constant for the duration of a loop.

   These are ADDITIVE layers: they tint and stipple the existing scene rather than
   redrawing it, which is what makes a theme read as "the same place, different
   weather" rather than a different picture.
   ========================================================================== */
"use strict";

/* --------------------------------------------------------------- precipitation */
/* One generic particle pool drives rain, snow, blossom, and falling leaves.
   Only the per-particle parameters differ, which keeps the loop proof identical
   across all four and avoids four near-identical copies of the same code.       */
const PRECIP = {
  rain:    { n: 150, speed: 150, drift: -26, len: 7,  size: 1,  pal: "rain", spread: 1.0 },
  snow:    { n: 120, speed: 17,  drift:  11, len: 2,  size: 1,  pal: "snow", spread: 1.0 },
  blossom: { n: 46,  speed: 15,  drift:   9, len: 1,  size: 1,  pal: "blossom", spread: 1.0 },
  leaves:  { n: 40,  speed: 21,  drift:  15, len: 1,  size: 2,  pal: "leaf", spread: 1.0, tumble: 1 }
};

function drawPrecip(t, T){
  /* Weather precipitation only. BLOSSOM and FALLING LEAVES are deliberately NOT
     driven from here: falling blossom was rendering as sky-wide white specks
     across the whole frame, which read as stars and made daylight look like
     night. Petals belong on the tree line and drifting through the mid-ground,
     and they are pink — see drawSpringDetail / drawLeafFall. */
  const kind = T.precip === "rain" ? "rain" : T.precip === "snow" ? "snow" : null;
  if (!kind) return;
  const cfg = PRECIP[kind];
  /* winter never gets blossom/leaves, spring never gets snow — enforced by
     resolveTheme(), so this is belt-and-braces rather than the primary guard. */
  const pal = precipPalette(T, cfg.pal);
  for (let i = 0; i < cfg.n; i++){
    /* one particle every 0.2s of loop time; age wrapped into the loop */
    let a = (t - i * 0.2) % LOOP_SECONDS; if (a < 0) a += LOOP_SECONDS;
    const life = LOOP_SECONDS / cfg.n * 4;         // several particles in flight
    const ph = (a % life) / life;                  // 0..1 through its own fall
    const seedX = hash2(i, 7, 11);
    const x0 = seedX * (VW + 60) - 30;
    const y0 = ph * (VH + 40) - 20;
    /* wind: a slow integer-frequency sway, plus the per-kind constant drift */
    const sway = (cfg.spread) * 3.2 * SIN[(TAU8 * (2*Math.PI*2*(t/LOOP_SECONDS) + i * 2.3)) & SIN_MASK];
    let x = x0 + (kind === "rain" ? -y0 * 0.30 : 0) + sway;
    const y = y0;
    if (x < -30) x += VW + 60;
    if (x >= VW + 30) x -= VW + 60;
    if (y < -12 || y > VH + 12) continue;
    const xi = x | 0, yi = y | 0;
    if (kind === "rain"){
      /* slanted streak: 1px wide, cfg.len tall, brighter at the head */
      for (let k = 0; k < cfg.len; k++){
        const yy = yi + k; if (yy < 0 || yy >= VH) break;
        const b = 1 - k / cfg.len;
        addPix(xi + ((y0 - yy) * 0.30 | 0), yy, 26*b, 34*b, 48*b);
      }
    } else if (kind === "snow"){
      if (bayer01(xi, yi) < 0.72)
        addPix(xi, yi, pal[0], pal[1], pal[2]);
    } else {
      /* blossom petal / leaf: a 1-2px mark with a slight vertical squash */
      if (cfg.tumble){
        const w2 = cfg.tumble && (Math.sin(a*1.7 + i) > 0) ? 1 : 0;
        if (bayer01(xi, yi) < 0.9){
          addPix(xi, yi, pal[0], pal[1], pal[2]);
          if (w2 && xi + 1 < VW) addPix(xi + 1, yi, pal[0]*0.7, pal[1]*0.7, pal[2]*0.7);
        }
      } else if (bayer01(xi, yi) < 0.85){
        addPix(xi, yi, pal[0], pal[1], pal[2]);
      }
    }
  }
}
function precipPalette(T, kind){
  const g = T.foliage, a = T.ground.accent;
  if (kind === "rain")    return [30, 40, 56];
  if (kind === "snow")    return [190, 205, 225];
  if (kind === "blossom") return [230 - (_cr(a) ? 0 : 0), 150, 190];
  return [_cr(g.rim), _cg(g.rim), _cb(g.rim)];
}

/* ---------------------------------------------------------- weather overlays */
/* Cloud shelves: a dithered band structure across the sky. Deterministic per
   column, so it costs nothing to bake per frame as a couple of additive bands. */
function drawClouds(t, T){
  if (T.cloud <= 0.01) return;
  const strength = T.cloud;
  const n = Math.round(2 + strength * 4);
  for (let b = 0; b < n; b++){
    const y0 = 18 + b * 16;
    const drift = SPD_STAR * 1.6 * t;
    for (let x = 0; x < VW; x++){
      const src = ((x + Math.floor(drift)) % VW + VW) % VW;
      const nz = 0.5 + 0.5 * SIN[(TAU8 * (src * 0.02 + b * 1.3)) & SIN_MASK];
      const thick = 5 + Math.round(nz * 8 * strength);
      for (let y = y0; y < y0 + thick; y++){
        if (y < 0 || y >= SKY_H) continue;
        const edge = 1 - Math.abs(y - (y0 + thick/2)) / (thick/2 + 0.5);
        const a = edge * edge * strength * (0.30 + nz * 0.45);
        if (bayer01(x, y) < a) addPix(x, y, 18*a, 20*a, 26*a);
      }
    }
  }
}

/* Sun/moon disc position depends on time of day. */
function celestial(T){
  if (T.tod === "day") return { x: 396, y: 42, r: 12 };     // sun, high right
  return { x: MOON_X, y: MOON_Y, r: MOON_R };
}

/* ------------------------------------------------------------- scene decals */
/* Snow caps on the conifer tops and the banks, plus a white ground layer. */
function drawSnowCaps(T){
  if (!T.snow) return;
  const rnd = mulberry32(4242);
  /* caps on the far and near tree lines: 1-2px white on the upper-left of each
     tree, using the same deterministic placement as the forests */
  for (const [y0, h, count, seed] of [[PINEF_Y0, PINEF_H, 30, 33], [PINEN_Y0, PINEN_H, 20, 44]]){
    const r2 = mulberry32(seed);
    for (let i = 0; i < count; i++){
      r2();                                       // consume to match placement
      const x = Math.floor(r2() * VW);
      const th = 14 + Math.floor(r2() * 13);
      const top = y0 + h - 1 - th;
      addPix(x, top, 150, 160, 178);
      if (r2() > 0.5) addPix(x + 1, top, 126, 138, 158);
    }
  }
  /* Snow lying on the embankment crest and the near bank lip.

     These were RGB(70,78,92) — a dark slate that reads as wet gravel, not snow,
     and measured 0 px against any brightness threshold. Snow in a night scene is
     lit by the moon and the train, so it is a bright cool white: additive on top
     of an already-lit ground, which is what makes it sit in front. */
  for (let x = 0; x < VW; x++){
    const ec = EMB_Y0;
    addPix(x, ec, 96, 106, 126);          // shadowed snow just under the lip
    addPix(x, ec - 1, 128, 138, 158);     // the lit crest
    if ((x * 7) % 11 < 2) addPix(x, ec - 2, 78, 88, 108);
    /* dithered so it does not read as a painted line */
    if ((x * 5) % 3 === 0) addPix(x, ec - 1, 40, 46, 60);
    const fy = FORE_Y0;
    if ((x * 5) % 9 < 3) addPix(x, fy, 108, 118, 138);
    if ((x * 5) % 9 < 3 && (x * 3) % 4 === 0) addPix(x, fy - 1, 76, 86, 106);
  }
}

/* Spring: blossoms on branches + flowers in the bank + a light shaft or two. */
function drawSpringDetail(t, T){
  if (!T.flowers && !T.blossom) return;
  const rnd = mulberry32(9001);
  /* flowers along the near bank */
  for (let i = 0; i < 40; i++){
    const x = Math.floor(rnd() * VW);
    const off = Math.floor(rnd() * 4);
    const y = FORE_Y0 + off;
    const c = i % 3 === 0 ? [230, 120, 190] : (i % 3 === 1 ? [240, 220, 120] : [200, 230, 240]);
    addPix(x, y, c[0], c[1], c[2]);
    if (rnd() > 0.5) addPix(x + 1, y, c[0]*0.6, c[1]*0.6, c[2]*0.6);
  }
  /* blossom clumps on the tree line */
  for (let i = 0; i < 34; i++){
    const x = Math.floor(rnd() * VW);
    const y = PINEN_Y0 + 6 + Math.floor(rnd() * 16);
    addPix(x, y, 236, 150, 190);
    if (rnd() > 0.6) addPix(x, y - 1, 226, 130, 176);
  }
}
/* --- ground litter: leaves lying where they fell, moss, and river stones.
     The user brief asks for "leaves on the ground" as a distinct asset, and the
     season palette already carried a `ground.litter` colour that nothing ever
     read. Drawn AFTER the puddles so litter sits on top of wet ground, and only
     where the near bank actually is. */
function drawGroundLitter(t, T){
  const g = T.ground;
  if (!g) return;
  const rnd = mulberry32(31337);
  const off = ((SPD_FORE * t) % VW + VW) % VW;
  const base = Math.floor(off);

  /* scattered moss/grass tufts year round — a bare bank reads as unfinished.
     NOTE the Math.floor on x: rnd() returns a FRACTION, and `fb[333.35 * VW + y]`
     writes to a non-integer index, which is silently discarded. Without the
     floor the whole pass is a no-op that still looks correct in the source. */
  for (let i = 0; i < 90; i++){
    const x = Math.floor(((rnd() * VW + base) % VW + VW) % VW);
    const y = FORE_Y0 + 3 + Math.floor(rnd() * (FORE_H - 6));
    const tall = rnd() > 0.72;
    addPix(x, y, _cr(g.grass) * 0.55, _cg(g.grass) * 0.55, _cb(g.grass) * 0.55);
    if (tall) addPix(x, y - 1, _cr(g.grass) * 0.42, _cg(g.grass) * 0.42, _cb(g.grass) * 0.42);
  }

  /* autumn litter: a carpet of fallen leaves, warm and dense.
     The first attempt scattered `fallLeaves * 2.6` single pixels over the whole
     480px band and the reviewer saw "no leaf litter at all" — at ~1 leaf per 70
     px of ground it simply is not a carpet. It is now drawn in CLUSTERS along
     drift lines (leaves collect against the grass and the bank edge), which is
     both more realistic and far more legible at this resolution. */
  if (T.fallLeaves > 0){
    const clusters = Math.round(14 + T.fallLeaves * 26);
    for (let cI = 0; cI < clusters; cI++){
      const cx = rnd() * VW;
      const cy = FORE_Y0 + 2 + rnd() * (FORE_H - 6);
      const n  = 2 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++){
        const x = Math.floor(((cx + (rnd() - 0.5) * 26 + base) % VW + VW) % VW);
        const y = cy + ((rnd() - 0.5) * 5) | 0;
        if (y < FORE_Y0 || y >= FORE_Y0 + FORE_H) continue;
        const k = 0.45 + rnd() * 0.6;
        addPix(x, y, _cr(g.litter) * k, _cg(g.litter) * k, _cb(g.litter) * k);
        /* a 2px leaf, lying horizontally the way a fallen leaf settles */
        if (rnd() > 0.5) addPix(x + 1, y, _cr(g.litter) * k * 0.8,
                                   _cg(g.litter) * k * 0.8, _cb(g.litter) * k * 0.8);
      }
    }
  }

  /* spring: blossoms dropped onto the grass */
  if (T.blossom){
    for (let i = 0; i < 26; i++){
      const x = Math.floor(((rnd() * VW + base) % VW + VW) % VW);
      const y = FORE_Y0 + 2 + Math.floor(rnd() * (FORE_H - 8));
      addPix(x, y, 226, 150, 186);
    }
  }

  /* winter: a thin rime of frost caught in the grass, no leaves at all */
  if (T.ice){
    for (let i = 0; i < 70; i++){
      const x = Math.floor(((rnd() * VW + base) % VW + VW) % VW);
      const y = FORE_Y0 + 2 + Math.floor(rnd() * (FORE_H - 6));
      addPix(x, y, 58, 66, 82);
    }
  }

  /* river stones along the waterline — they mark where the bank meets the lake
     and give the shoreline a hard edge instead of a soft blur */
  for (let i = 0; i < 22; i++){
    const x = Math.floor(((rnd() * VW + base) % VW + VW) % VW);
    const y = FORE_Y0 + FORE_H - 2 - Math.floor(rnd() * 3);
    const s = rnd() > 0.5;
    addPix(x, y, s ? 74 : 58, s ? 78 : 64, s ? 88 : 76);
  }
}

/* --- TELEGRAPH POLES + CATENARY WIRE — the sixth parallax layer ------------
     Wires are the thing that sells a railway scene: they cut the sky into
     receding bands and give the eye a sense of speed that the ground alone
     cannot. They sit between the near forest and the embankment, so they are
     IN FRONT of the trees and BEHIND the train.

     Built as a repeating strip so the parallax is a single integer blit offset,
     exactly like every other layer. The pole spacing must divide VW evenly or
     the strip tears at the wrap; 48 px spacing over 480 px = 10 poles.         */
/* The strip's bottom row sits on the embankment crest, so the mast runs the full
     height of the band and the cross-arms sit in its upper third. Drawing only
     the top 30 rows would leave the poles floating with no visible base. */
function buildPoles(y0, h, seed, spacing, pal){
  const s = newStrip(VW, h);
  const rnd = mulberry32(seed);
  const armY = Math.round(h * 0.22);        // top cross-arm
  const armY2 = Math.round(h * 0.44);       // lower cross-arm
  for (let x = 0; x < VW; x += spacing){
    const px = x;
    /* the mast: 1px wide with a 3px shoulder just below each cross-arm, so the
       silhouette has a little structure instead of being a bare line */
    for (let y = 0; y < h; y++){
      sput(s, px, y, pal.lo);
      /* a 3px shoulder just below each cross-arm, so the silhouette has some
         structure instead of being a bare line */
      if (y === armY + 1 || y === armY2 + 1){ sput(s, px - 1, y, pal.body); sput(s, px + 1, y, pal.body); }
    }
    /* the moonlit edge: 1px on the left of the mast */
    for (let y = 0; y < h; y++) sput(s, px - 1, y, pal.rim);
    /* one, two or three wires strung between this pole and the next. They hang from
       the INSULATOR TIPS, so their height is the arm height plus the tip, not an
       arbitrary constant — otherwise they float away from the pole as `h` grows. */
    const wires = 2 + (rnd() > 0.55 ? 1 : 0);
    for (let wI = 0; wI < wires; wI++){
      const yTop = (wI === 0 ? armY : wI === 1 ? armY2 : Math.round(h * 0.11)) - 1;
      /* a catenary sags toward the middle of the span */
      const sag = 2 + wI;
      for (let dx = 0; dx < spacing; dx++){
        const u = dx / spacing;
        const sagY = Math.round(sag * (1 - Math.pow(2*u - 1, 2)));
        const y = yTop + sagY;
        if (y < h) sput(s, px + dx, y, dx % 7 === 0 ? pal.wire : pal.wireLo);
      }
    }
  }
  return s;
}

/* --- Autumn leaf fall + winter fireflies.
     Replaces the old behaviour where falling leaves were handled inside
     drawPrecip, which meant they were white specks over the whole frame. Leaves
     are warm, confined to the mid/lower bands where a tree canopy actually is,
     and they drift rather than fall in straight lines. */
function drawLeafFall(t, T){
  const leaves = T.fallLeaves | 0;
  if (leaves > 0){
    for (let i = 0; i < leaves; i++){
      const ph  = ((t * 0.6 - i * 1.7) % (LOOP_SECONDS * 2) + LOOP_SECONDS * 2)
                % (LOOP_SECONDS * 2) / (LOOP_SECONDS * 2);
      const y = PINEF_Y0 - 4 + ph * (VH - PINEF_Y0 + 8);
      /* sway grows with fall distance, so leaves tumble rather than drop.
         Uses the SIN table with an INTEGER harmonic of the loop, or the 120s
         cycle will not close and render(0) != render(120). */
      const sway = SIN[(TAU8 * (7 * ph + i * 0.19) | 0) & SIN_MASK] * (7 + ph * 9);
      const x = ((hash2(i, 3, 17) * (VW + 40) - 20 + sway) | 0);
      if (x < 0 || x >= VW) continue;
      const warm = i % 3;
      const r = warm === 0 ? 232 : (warm === 1 ? 208 : 176);
      const g = warm === 0 ? 150 : (warm === 1 ? 92  : 52);
      const b = warm === 0 ? 56  : (warm === 1 ? 40  : 30);
      addPix(x, y | 0, r, g, b);
      /* a second pixel below for a 2px leaf, dithered so it flickers as it turns */
      if (hash2(i, (y|0), 5) > 0.45) addPix(x, (y|0) + 1, r*0.6, g*0.6, b*0.6);
    }
  }
  /* Summer nights get fireflies: slow, warm, blinking points near the tree line */
  if (T.season === "Summer" && T.tod === "night"){
    for (let i = 0; i < 14; i++){
      const ph = ((t * 0.8 - i * 3.1) % LOOP_SECONDS + LOOP_SECONDS) % LOOP_SECONDS;
      const x = (hash2(i, 13, 23) * VW) | 0;
      const y = (PINEN_Y0 + 6 + hash2(i, 29, 31) * (FORE_Y0 - PINEN_Y0 - 12)) | 0;
      /* blink: a sharp on/off with a long dark tail */
      const cyc = (ph / LOOP_SECONDS * 3 + i * 0.37) % 1;
      if (cyc > 0.16) continue;
      addPix(x, y, 150, 200, 90);
      if (cyc < 0.05) addPix(x, y - 1, 60, 90, 30);
    }
  }
}

function drawLightShafts(t, T){
  if (!T.lightShafts) return;
  for (let i = 0; i < 3; i++){
    const baseX = 90 + i * 150;
    const drift = Math.sin(2*Math.PI * 1 * (t/LOOP_SECONDS) + i) * 8;
    for (let y = 0; y < SKY_H + 20; y++){
      const wdt = 8 + (y >> 2);
      for (let dx = -wdt; dx <= wdt; dx++){
        const x = (baseX + drift + dx + y * 0.42) | 0;
        if (x < 0 || x >= VW) continue;
        const a = (1 - Math.abs(dx) / (wdt + 1)) * 0.10 * (1 - y / (SKY_H + 20));
        if (bayer01(x, y) < a) addPix(x, y, 60*a, 55*a, 30*a);
      }
    }
  }
}

/* Ice sheets on the water in winter: bright cracked plates over the reflection. */
function drawIce(T){
  if (!T.ice) return;
  for (let y = LAKE_Y0; y < LAKE_Y0 + LAKE_H; y++){
    for (let x = 0; x < VW; x += 1){
      const n = hash2(x, y, 61);
      if (n > 0.86){
        const c = fb[y*VW + x];
        const m = 0.35;
        addPix(x, y, 40*m, 52*m, 66*m);
      }
      if (n < 0.02){
        addPix(x, y, 30, 40, 52);   // crack lines
      }
    }
  }
}

/* ---------------------------------------------- style-specific set dressing */
function drawTorii(T){
  if (T.style !== "japan") return;
  /* a torii gate silhouette on the mid ridge: two posts, two beams */
  const bx = 300, by = 130;
  for (let x = bx - 16; x <= bx + 16; x++) fb[by*VW + x] = _pack(0xb8, 0x30, 0x2a);
  for (let x = bx - 20; x <= bx + 20; x++) fb[(by - 6)*VW + x] = _pack(0xd0, 0x40, 0x34);
  for (let x = bx - 14; x <= bx - 11; x++) for (let y = by - 5; y < by; y++) fb[y*VW + x] = _pack(0xb8, 0x30, 0x2a);
  for (let x = bx + 11; x <= bx + 14; x++) for (let y = by - 5; y < by; y++) fb[y*VW + x] = _pack(0xb8, 0x30, 0x2a);
  /* paper lanterns on a wire */
  for (let x = 40; x < VW; x += 46){
    for (let y = 108; y < 112; y++) fb[y*VW + x] = _pack(0x60, 0x50, 0x40);
    const lx = x + 22;
    for (let dy = 0; dy < 5; dy++)
      for (let dx = -1; dx <= 1; dx++)
        addPix(lx + dx, 112 + dy, 200, 120, 60);
  }
}
function drawNeon(T, t){
  if (T.style !== "cyberpunk") return;
  /* magenta underglow along the embankment + a holo sign among the trees */
  for (let x = 0; x < VW; x++){
    const n = hash2(x, 3, 17);
    if (n > 0.7) addPix(x, EMB_Y0 + 20, 30, 4, 18);
    if (n < 0.06) addPix(x, EMB_Y0 + 2, 20, 8, 26);
  }
  const sx = 210, sy = 118;
  for (let y = 0; y < 14; y++) for (let x = 0; x < 22; x++){
    if ((x + y) % 3 === 0) addPix(sx + x, sy + y, 40, 20, 50);
  }
  for (let y = 0; y < 14; y += 2){
    addPix(sx - 1, sy + y, 120, 20, 90);
    addPix(sx + 22, sy + y, 120, 20, 90);
  }
  /* scanline band drifting slowly down the whole frame (very subtle) */
  const band = (t * 6) % (VH + 40) - 20;
  for (let y = 0; y < 6; y++){
    const yy = (band + y) | 0; if (yy < 0 || yy >= VH) continue;
    for (let x = 0; x < VW; x += 1) if (bayer01(x, yy) < 0.10) addPix(x, yy, 4, 6, 12);
  }
}
function drawHeatHaze(t, T){
  if (T.season !== "Summer" || T.tod !== "day") return;
  for (let y = LAKE_Y0; y < LAKE_Y0 + 24; y++){
    for (let x = 0; x < VW; x++){
      if (bayer01(x, y) < 0.10)
        addPix(x, y, 6, 6, 2);
    }
  }
}
