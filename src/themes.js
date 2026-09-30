/* =============================================================================
   MIDNIGHT MERIDIAN — THEME ENGINE
   -----------------------------------------------------------------------------
   A theme does NOT redraw the world. It re-materialises the SAME geometry with a
   different palette and a different set of pixel asset layers (rain, snow, blossom,
   leaves, ice, flowers, light shafts, torii, lanterns, neon). That is what keeps
   24 themes looking like one coherent piece instead of 24 unrelated pictures.

   Loop safety: a theme is a CONSTANT for the duration of a loop, and every
   theme-driven oscillation uses integer cycle counts over 120s, so
   render(t, theme) remains a pure function of (t mod 120, theme) and the existing
   bit-exact loop proof still holds.
   ========================================================================== */
"use strict";

/* Hex string -> packed uint32, matching core's little-endian RGBA byte order.
   core.js probes endianness at parse time and assigns `_pack`, but themes.js
   builds its palette table at parse time too, so it uses this self-contained
   version. Both are asserted to agree by verify.js (a mismatched packer would
   swap red and blue in every theme). */
function packHex(h){
  const n = parseInt(h.slice(1), 16);
  return (0xff000000 | (((n) & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0;
}

/* ---------------------------------------------------------------- palettes */
/* Each palette is a complete replacement for the v1 palette set. Keys are
   identical across every theme so render code never branches on the theme.     */
function P(o){ const q = {}; for (const k in o) q[k] = packHex(o[k]); return q; }

const PALETTES = {
  midnight: {
    label: "Midnight",
    sky:   P({ top:"#07050e", mid:"#120c24", low:"#241940", haze:"#332452", deep:"#0a0918" }),
    neb:   P({ a:"#2a204e", b:"#45386d" }),
    moon:  P({ core:"#e4eef8", limb:"#a9bad2", dark:"#8b9cb8", halo:"#2b3c63" }),
    farn:  P({ hi:"#2b2347", lo:"#1a1430", rim:"#7a78a6", snow:"#9da6c6", shd:"#140f26", haze:"#2f254a" }),
    midn:  P({ hi:"#1d1635", lo:"#0f0a20", rim:"#535082", snow:"#6b6d92", shd:"#0c0819", haze:"#221a3c" }),
    pineF: P({ a:"#1c273a", b:"#121b2c", c:"#0b121e", rim:"#395676", floor:"#0d131f" }),
    pineN: P({ a:"#131d2c", b:"#0a111c", c:"#050a12", rim:"#2d4764", floor:"#060b14" }),
    gnd:   P({ crest:"#2f2840", slope:"#1d182b", balA:"#3a344f", balB:"#241f35",
               sleeper:"#261e2e", railDk:"#3c3f54", rail:"#777c95", railHi:"#b9bdd2",
               wet:"#0b0d18", wetHi:"#1a2238" }),
    trn:   P({ body:"#1b1f31", bodyHi:"#2a3048", bodyLo:"#111422", trim:"#7d2436",
               trimHi:"#a8364a", brass:"#b0833e", brassHi:"#e2ad5f", iron:"#2f3344",
               ironHi:"#4a5068", win:"#0d1018", plate:"#c89b4e", smokebox:"#0f121c" }),
    wat:   P({ deep:"#080916", mid:"#10172c", rim:"#2a3352" })
  },

  cyberpunk: {
    label: "Cyberpunk",
    sky:   P({ top:"#05030f", mid:"#0d0620", low:"#1a0a33", haze:"#2b1150", deep:"#07040f" }),
    neb:   P({ a:"#3a0f52", b:"#6a1a7a" }),
    moon:  P({ core:"#d8f6ff", limb:"#7fd8f0", dark:"#4aa8c8", halo:"#1d4a6b" }),
    farn:  P({ hi:"#241a44", lo:"#150e2c", rim:"#b06bff", snow:"#e0b8ff", shd:"#0e0820", haze:"#2a1848" }),
    midn:  P({ hi:"#181034", lo:"#0c0720", rim:"#8a4bff", snow:"#c8a0ff", shd:"#080418", haze:"#1e1238" }),
    pineF: P({ a:"#141a30", b:"#0c1224", c:"#060a16", rim:"#3ce0ff", floor:"#0a0f1c" }),
    pineN: P({ a:"#0e1526", b:"#070c18", c:"#03070e", rim:"#2ea8e0", floor:"#05090f" }),
    gnd:   P({ crest:"#2a1c44", slope:"#1a1030", balA:"#3c2452", balB:"#241238",
               sleeper:"#221430", railDk:"#3a2a52", rail:"#6a4f9a", railHi:"#ff4dd2",
               wet:"#0a0716", wetHi:"#1c1030" }),
    trn:   P({ body:"#140f2a", bodyHi:"#241a44", bodyLo:"#0b0718", trim:"#ff2d95",
               trimHi:"#ff7ac0", brass:"#00e5ff", brassHi:"#8ff6ff", iron:"#241a3a",
               ironHi:"#3c2a5c", win:"#08061a", plate:"#00ffa0", smokebox:"#0a0616" }),
    wat:   P({ deep:"#06041a", mid:"#120a30", rim:"#ff2d95" })
  },

  japan: {
    label: "Japan",
    sky:   P({ top:"#0a0a1c", mid:"#141a38", low:"#2a2a52", haze:"#453a5e", deep:"#14101c" }),
    neb:   P({ a:"#2e2440", b:"#4a3a58" }),
    moon:  P({ core:"#fff4e0", limb:"#e8c8a8", dark:"#c09878", halo:"#4a3a58" }),
    farn:  P({ hi:"#2e3048", lo:"#1c1c30", rim:"#c0a0a0", snow:"#e8dcd0", shd:"#14141f", haze:"#3a3448" }),
    midn:  P({ hi:"#22243a", lo:"#141422", rim:"#9a8090", snow:"#d0c0c8", shd:"#0f0f18", haze:"#2e2838" }),
    pineF: P({ a:"#1e2a26", b:"#141d1a", c:"#0a120f", rim:"#6a9080", floor:"#0c1512" }),
    pineN: P({ a:"#16211d", b:"#0d1613", c:"#060c0a", rim:"#54786c", floor:"#080f0c" }),
    gnd:   P({ crest:"#38322e", slope:"#241f1c", balA:"#463c34", balB:"#2c2520",
               sleeper:"#2e2622", railDk:"#443c40", rail:"#8a8088", railHi:"#d8ccd0",
               wet:"#100e10", wetHi:"#241e22" }),
    trn:   P({ body:"#241f26", bodyHi:"#38303a", bodyLo:"#15121a", trim:"#b8302a",
               trimHi:"#e05a48", brass:"#c8a04e", brassHi:"#f0cc80", iron:"#38323a",
               ironHi:"#544c58", win:"#0e0c12", plate:"#e0b860", smokebox:"#16121a" }),
    wat:   P({ deep:"#0c0c16", mid:"#16182a", rim:"#4a3a58" })
  }
};

/* --------------------------------------------------------- season palettes */
/* Spring/Summer/Autumn/Winter modify the FOLIAGE and GROUND of a style palette.
   They are applied as a tint layer so the style's identity (neon vs torii) wins. */
const SEASON = {
  spring: {
    label: "Spring", bare: false, snow: false, flowers: true,  leaves: false,
    fallLeaves: 0,  lightShafts: true,  blossom: true,  water: 1.0,  ice: false,
    foliage: P({ a:"#4f7a3a", b:"#3a5c2c", c:"#27401f", rim:"#a8d878" }),
    ground: P({ grass:"#3f6a30", litter:"#5a7a3a", accent:"#e8a0c8" })
  },
  summer: {
    label: "Summer", bare: false, snow: false, flowers: false, leaves: false,
    fallLeaves: 0,  lightShafts: false, blossom: false, water: 1.15, ice: false,
    foliage: P({ a:"#2f6b2a", b:"#21501f", c:"#153615", rim:"#7ac85a" }),
    ground: P({ grass:"#2f6b28", litter:"#3f6b30", accent:"#f0d060" })
  },
  autumn: {
    label: "Autumn", bare: false, snow: false, flowers: false, leaves: false,
    fallLeaves: 46, lightShafts: true,  blossom: false, water: 0.95, ice: false,
    foliage: P({ a:"#a8641e", b:"#7d4514", c:"#552c0e", rim:"#f0b054" }),
    ground: P({ grass:"#8a5a22", litter:"#b8763a", accent:"#d8503a" })
  },
  winter: {
    label: "Winter", bare: true,  snow: true,  flowers: false, leaves: false,
    fallLeaves: 0,  lightShafts: false, blossom: false, water: 0.8,  ice: true,
    foliage: P({ a:"#2a2622", b:"#1e1a18", c:"#141110", rim:"#8a8278" }),
    ground: P({ grass:"#4a5560", litter:"#5a6470", accent:"#dce8f0" })
  }
};

/* --------------------------------------------------------------- weather   */
const WEATHER = {
  clear:   { label: "Clear",   stars: true,  cloud: 0.0,  precip: "none", ripple: 0.00, skyTint: 0.00, hazeAmt: 0.00 },
  cloudy:  { label: "Cloudy",  stars: false, cloud: 0.6,  precip: "none", ripple: 0.05, skyTint: 0.35, hazeAmt: 0.25 },
  rain:    { label: "Rain",    stars: false, cloud: 0.85, precip: "rain", ripple: 0.55, skyTint: 0.55, hazeAmt: 0.45 },
  snow:    { label: "Snow",    stars: false, cloud: 1.0,  precip: "snow", ripple: 0.10, skyTint: 0.70, hazeAmt: 0.60 }
};

/* --------------------------------------------------------------- themes    */
const THEMES = [];
for (const style of ["midnight", "cyberpunk", "japan"])
  for (const tod of ["night", "day"])
    for (const weather of ["clear", "cloudy", "rain", "snow"]) {
      THEMES.push({
        id: `${style}-${tod}-${weather}`,
        style, tod, weather,
        label: `${PALETTES[style].label} · ${tod === "night" ? "Night" : "Day"} · ${WEATHER[weather].label}`
      });
    }
const THEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));
const DEFAULT_THEME = "midnight-night-clear";

/* Day/night remaps applied on top of a style palette. Day is NOT "the night
   palette turned up": the starfield is dropped, the sky ramp inverts to daylight,
   ridge haze lightens, the water tints pale sky-blue, and the train windows stop
   being the light source. */
const TOD = {
  night: { skyLift: 0.00, starAlpha: 1.00, haze: 0.00, waterTint: [1.00, 1.00, 1.00], rim: 0.00, lightSource: "moon" },
  day:   { skyLift: 1.00, starAlpha: 0.00, haze: 0.55, waterTint: [1.18, 1.14, 1.10], rim: 0.35, lightSource: "sun"  }
};

/* ------------------------------------------------------------------ music  */
/* Style drives the music. Weather/time-of-day drive the filter and register, not
   the notes — so switching to rain makes the track darker and slower without
   changing the tune. Scales are named strings consumed by music-theory.js
   (SCALES), so the synth and the composer always agree on what "dorian" means. */
const MUSIC_STYLE = {
  midnight: { bpm: 84,  scale:'dorian',   root: 220.00, mood:'lofi',
              swing: 0.14, padLevel: 0.30, leadLevel: 0.16, cutoff: 2600,
              groove:'lofi',    form:'standard', seed: 1207 },
  cyberpunk:{ bpm: 128, scale:'minor',    root: 110.00, mood:'peppy',
              swing: 0.00, padLevel: 0.22, leadLevel: 0.24, cutoff: 5200,
              groove:'straight', form:'long',   seed: 4404 },
  japan:    { bpm: 78,  scale:'hirajoshi', root: 196.00, mood:'dreamy',
              swing: 0.06, padLevel: 0.34, leadLevel: 0.22, cutoff: 3400,
              groove:'tresillo', form:'standard', seed: 8891 }
};
/* Weather mood modifiers — these reshape which progressions are eligible. */
const MUSIC_MOOD = {
  clear:  { cutoff: 1.25, wet: 0.30, mood:'lofi' },
  cloudy: { cutoff: 1.00, wet: 0.34, mood:'calm' },
  rain:   { cutoff: 0.72, wet: 0.42, mood:'dreamy' },
  snow:   { cutoff: 0.85, wet: 0.52, mood:'ambient' }
};

/* Resolve a theme id + season into the full, immutable state the renderer wants. */
function resolveTheme(themeId, seasonId){
  const th = THEME_BY_ID[themeId] || THEME_BY_ID[DEFAULT_THEME];
  const se = SEASON[seasonId] || SEASON.summer;
  const wx = WEATHER[th.weather];
  const tod = TOD[th.tod];
  return {
    id: th.id, label: th.label,
    style: th.style, tod: th.tod, weather: th.weather, season: se.label,
    pal: PALETTES[th.style],
    /* snow assets exist in exactly one season. This is the single source of truth
       for "no pixel snow anywhere" in spring, and it is enforced in verify.js. */
    snow: se.snow, bare: se.bare, flowers: se.flowers, fallLeaves: se.fallLeaves,
    blossom: se.blossom, lightShafts: se.lightShafts, ice: se.ice,
    foliage: se.foliage, ground: se.ground,
    stars: wx.stars && th.tod === "night",
    cloud: wx.cloud, precip: wx.precip,
    ripple: wx.ripple, haze: wx.hazeAmt + tod.haze * 0.5,
    waterTint: tod.waterTint, rim: tod.rim,
    music: { ...MUSIC_STYLE[th.style], ...MUSIC_MOOD[th.weather] }
  };
}
