# Changelog

All notable changes to MIDNIGHT MERIDIAN.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Nothing yet.

---

## [3.0.0] — 2026-10-01

The release that turns the artwork into a place. Real music, real seasons, real
scenery, and the bugs that were hiding in all three.

### Added — generative music

- **`src/music-theory.js`, a pure, headless composition layer.** Scales, chord
  qualities, functional-harmony progressions and song form, composed from a
  seeded PRNG so the same seed always yields the same track.
- **Bjorklund / Euclidean rhythm generation.** Real world-music grooves —
  cumbia (5/3/7), cinquillo (5/3/11), tresillo (3/5/7) — instead of hand-tapped
  hats. Implements the algorithm from Bjorklund (1982) and Toussaint (2005), in
  the zip-and-partition formulation.
- **Song form.** Bars are grouped into named sections (intro → a → b → c → out)
  with independent density and brightness, so the piece has shape rather than
  running at one level forever.
- **Motif development.** A short interval motif is chosen per section, repeated,
  and resolved onto chord tones on strong beats — the thing that makes a melody
  sound in key rather than merely in scale.
- **Real progression harmony.** Ten functional progressions weighted per mood
  (the lo-fi staple i–VI–III–VII is in there), alternating between two per song.
- **A lo-fi character bus.** Tape wobble (a 0.6 Hz LFO on filter detune), a
  resonant low-pass at Q 1.6, vinyl crackle modulated by two slow LFOs, and a
  surface hiss bed. Entirely synthesised — no samples.
- **Music follows the theme.** Style picks the scale, tempo, groove and seed;
  weather reshapes the filter and register. Rain is darker and slower; snow is
  wide and sparse; Cyberpunk is faster and straighter; Japan uses a 5-note
  hirajoshi scale and a tresillo groove.

### Added — scenery

- **Autumn leaf fall.** Warm, tumbling leaves confined to the bands where a
  canopy actually is, with sway that grows as they fall.
- **Summer night fireflies.** Slow blinking points near the tree line.
- **Snow lying on the embankment and near bank**, dithered so it does not read as
  a painted line.
- **A real sun.** Daylight themes were carrying a moon. There is now a baked sun
  disc with a warm bloom.
- **Bare winter conifers.** Thin branch strokes instead of a solid cone.
- Spring blossom, flowers and light shafts; ice on the lake in winter.

### Fixed — five real bugs, each caught by numbers

- **The forest was invisible.** `buildThemeStrips` passed a single *colour* to
  `mixPal`, which iterates palette keys and therefore returned `{}`. Every tree
  pixel stored as `0`. Spring and summer produced byte-identical strips.
  *Measured: 3 green pixels in the tree bands → **3246**.*
- **Winter trees were still green.** `T.bare` was resolved by `resolveTheme` and
  then ignored by `drawPine`. *3246 green pixels in winter → **9**.*
- **Day was indistinguishable from night** — mean sky luminance 21.9 vs 21.9. A
  1.55× multiply on a near-black palette cannot make daylight. Replaced with
  `liftPal()`, which blends toward a daylight blue *and* raises the floor.
  *Now 157.9 vs 21.9.*
- **Daytime themes carried a cratered moon** across a blue sky, because the moon
  was baked into the sky plate unconditionally. The strongest single "this is
  night" cue, and the reason the day scene kept reading as night after every
  other fix.
- **Falling blossom rendered as sky-wide white specks** that read as stars, so
  daylight looked like night. Precipitation is now weather-only; blossom and
  leaves have their own warm, correctly-placed passes.

### Fixed — performance

- **The smoke pass cost 11.8 ms**, the most expensive in the piece. `Math.exp`
  twice per particle became a lookup table (only 300 ages are reachable across
  the whole loop, so the table is exact), and the per-pixel `Math.sqrt` in the
  puff scan became a squared-distance compare. *11.8 ms → **2.2 ms**.*
- **The celestial halo cost 2.97 ms per frame** to redraw a static bloom. The sun
  and its halo are now baked into the sky plate, which is free — the celestial
  body has zero parallax by definition.
- Water reflections: 48.5 ms → 1.2 ms, via sine lookup tables and hoisted row
  invariants.
- Total frame: **16.5 ms → 12.6 ms** median, against a 16.67 ms budget.

### Added — verification

- **15 new assertions**, each written because it would have caught a real bug:
  Euclidean vectors, groove mask integrity, music determinism, score substance,
  song-form variation, chord well-formedness, and scale-table integrity.
- **Five scenery assertions** measuring the live framebuffer: green pixel count,
  season reach, star gating measured against each theme's own sky median, and
  snow presence/absence on the embankment.
- `diag-perf.js` rewritten to reuse `verify.js`'s DOM stub — two copies of a fake
  DOM is how `harness.js` went stale and made the profiler crash misleadingly.
- Removed 15 stale one-off diagnostic scripts.

### Changed
- Daytime vegetation is now *exposed* rather than re-hued. Blending foliage
  toward daylight blue destroyed its green identity; vegetation takes a small
  multiply and a lift, and the season colour is applied by `buildThemeStrips`,
  which is the only layer that knows the season.
- Snow palette lifted from a dark slate (70,78,92 — wet gravel) to a bright cool
  white, lit by moon and train.
- Weather presets retuned: rain is clearer than overcast, snow is heavily
  overcast, clear nights show stars.

### Documentation
- `plan-v3.md` — research findings, including an honest negative result on
  pixel-art reference implementations.
- `NOTICE.md` — Ditty attribution with the MIT text, the Bjorklund/Toussaint
  citations, and full per-asset audio licensing.

### Known issues
- **`rain`, `rain-heavy` and `snow` recordings are CC BY-NC 4.0** — not licensed
  for commercial use. See `NOTICE.md`. They degrade gracefully if removed.
- Vision review disagrees with the pixel counters on winter trees: the harness
  measures 9 green pixels (correctly bare), while a vision model describes
  "evergreen conifers with snow caps" — thin 1 px branch strokes at this scale.
  Worth a human eye.

---

## [2.0.0] — 2026-10-01

Control surface, audio, and the theming engine.

### Added
- **Theme engine**: 3 styles (Midnight, Cyberpunk, Japan) × day/night × 4 weather
  × 4 seasons = 96 combinations, each a distinct palette and particle set.
- **A control panel**, built to `DESIGN.md` and the Design Sorcerer rules:
  segmented controls, five gain sliders, mobile bottom-sheet behaviour,
  keyboard-operable, `prefers-reduced-motion` respected.
- **Fullscreen** — the canvas covers the viewport rather than integer-letterboxing.
  At 1920×1080 the scale is exactly 4×, a perfect 1:1 grid.
- **Web Audio engine**, constructed lazily on first gesture: music, rain,
  ambient and train buses, plus a synthesised train rumble whose chuff rate is
  derived from the same constant the renderer uses, so it cannot drift out of
  phase with the wheels.
- **13 ambient recordings** inlined as base64 (2.2 MB), fetched from Openverse.
- Weather particle systems, clouds, ice, heat haze, light shafts, torii, neon.

### Fixed
- **56,695 pixels (43% of the frame) were unpainted black.** `buildThemeStrips`
  zeroed the sky plate and then blitted the still-empty framebuffer over it,
  erasing the sky gradient. *43% → **0**.*
- **The train was drawn backwards.** The world scrolls left, so the train travels
  right — but the consist was laid out `[loco][coaches]`, putting the chimney,
  headlamp and cowcatcher against the first carriage. An intermediate attempt
  mirrored the sprite, which was also wrong: it put the cab at the front. The
  correct fix is a reorder. Six assertions now lock the geometry, including the
  strict `headlamp > chimney > cab` ordering that a bounding-box test would not
  catch.

### Changed
- Audio sourced from **Openverse** rather than Pixabay: the Pixabay key on this
  machine is image-scoped and returns no audio for any query, including
  sound-effect-specific ones.
- Water reflections dim with depth and pick up the sky tint; rain dimples the
  lake surface.

---

## [1.0.0] — 2026-10-01

The original picture.

### Added
- A 480×270 virtual canvas, nearest-neighbour upscaled so every game pixel is a
  perfect square.
- Six parallax layers at mathematically precise speeds: stars, far ridge, mid
  ridge, far forest, near forest, embankment, foreground.
- A steam locomotive and three carriages with lit windows, moonlight rim light,
  flicker, headlamp cone and ambient glow.
- 300 smoke particles whose positions are pure functions of age — no spawn state,
  no reset, exactly periodic.
- Ordered-dither sky ramp with a Milky Way band, limb-darkened moon with craters.
- Value-noise mountain ridges with atmospheric haze.
- Lake and puddles reflecting the live framebuffer, with a 2-tap vertical smear,
  moon glitter and a widening moon path.
- An exact 120-second loop, proven bit-identical.

### Fixed
- 39.9% of the frame was unpainted: transparent-above terrain strips were being
  blitted as opaque, writing literal black along every wavy crest.
- The smoke loop seam: `if (a < 0) a += 120` left exactly one particle in the
  wrong place at the boundary. Now a true modulo.
- Puddle phase drift: `t = 120` produced large phase values whose accumulated
  floating-point error differed from `t = 0`. Fixed by canonicalising `t` at the
  entry to `render()`.
- Star boundary seam at x=204: the scroll offset must be reduced modulo the frame
  width *before* being split into integer and fractional parts.
- Reflections rendered **red** — the endianness probe tested alpha rather than
  the channel that lands in the low byte.
- Perf: water 48.5 ms → 7.8 ms; the whole frame landed at 9.3 ms.

[Unreleased]: https://github.com/DrGekoz/Midnight-Meridian/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/DrGekoz/Midnight-Meridian/releases/tag/v3.0.0
[2.0.0]: https://github.com/DrGekoz/Midnight-Meridian/releases/tag/v2.0.0
[1.0.0]: https://github.com/DrGekoz/Midnight-Meridian/releases/tag/v1.0.0