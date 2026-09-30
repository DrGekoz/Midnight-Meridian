# Changelog

All notable changes to MIDNIGHT MERIDIAN.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.2.0] — 2026-10-01

Layered ambient buses, and a real-browser check suite.

### Added
- **Layered ambient buses.** Each bus now holds a *list* of looping clips rather
  than one. Layer 0 is the bed at full level; layers 1..n route through their own
  gain node at 0.42 so a scene can be rain + thunder, or birds + stream + waves,
  without the mix turning to mud. `playBus()` diffs the requested list against
  what is already playing, so an unchanged scene is a genuine no-op and a
  re-triggered 30 s loop file cannot click its seam.
- **`tools/cdp_check.py`** — drives the shipped `index.html` in real Chrome over
  the DevTools protocol. Asserts: zero console errors, the canvas covers the
  viewport, nearest-neighbour sampling is active, every control the brief asks
  for is present, a theme button actually changes the frame, and rAF is running.

### Fixed
- **Six of thirteen bundled clips were never played.** `fire`, `stream`, `waves`,
  `thunder`, `clock` and `crowd` were fetched, licensed, base64-inlined into a
  4 MB file, and unreachable — the selection logic only ever picked five of them.
  Every clip is now reachable from some scene, and an assertion walks all 24
  themes × 4 seasons to prove it.
- **The piece opened silent.** `master` was `0` while `muted` was `true`, so
  pressing play produced nothing: the music bus was up at 0.8 but the master was
  at 0, and the panel showed a music slider at 80 beside a master at 0. `rain`
  and `amb` also defaulted to 0. Defaults are now 80 / 80 / 55 / 45 / 70.
  `muted` still starts true — that is the autoplay policy, not a volume bug.

### Tests
- **57 assertions** in `node verify.js`, plus 9 in `tools/cdp_check.py`.
- Two browser assertions were themselves wrong on first run, and the *tests* were
  fixed:
  - *"every game pixel is square"* demanded an integer scale, but the piece
    deliberately **covers** the viewport, so 480×270 in a 1588×808 window is
    necessarily 3.308×. Nearest-neighbour sampling is the actual guarantee.
  - *"rAF near 60fps"* failed at 177 fps because headless Chrome does not throttle
    rAF to the display refresh. Asserting ≥ 30 catches a stall; the real 16.67 ms
    budget is proven separately against the render cost.

## [3.1.0] — 2026-10-01

The sixth parallax layer, weather-driven water, ground litter, and interaction.

### Added
- **Telegraph poles + catenary wire** — a sixth parallax layer at 1.50×, between
  the near forest and the embankment. Strips tile exactly (480 px / 48 px
  spacing = 10 poles), so the layer cannot tear at the wrap. Cross-arm heights
  derive from the band height and wires hang from the insulator tips, so the
  geometry stays attached if `POLES_H` ever changes.
- **Weather-driven puddles.** Previously unconditional. They now scale with
  `T.ripple`, ice over in winter, and vanish under a clear sky.
- **Ground litter.** The season palette carried a `ground.litter` colour since
  v2 that nothing read. Leaves, moss tufts, river stones and spring blossom are
  now drawn on the near bank in clusters, after the foreground pines.
- **Train wake ripples.** Two crossing wave trains on the water, integer loop
  harmonics only, so the wake closes exactly.
- **Click ripples.** Click the water, an expanding ring appears. Click the sky,
  nothing. Ripples are an overlay drawn *after* `render()`, never inside it.
- **Settings persistence.** Theme, season and audio gains survive a reload via
  `localStorage`, with full validation on load and every access wrapped.
- **`prefers-reduced-motion`** — the piece opens paused.

### Fixed
- **The ground-litter pass drew exactly zero pixels.** `rnd()` returns a
  fraction and `fb[333.35 * VW + y]` writes to a non-integer index, which is
  silently discarded; every `x` in the pass lacked a `Math.floor`. The pass ran
  200+ iterations per frame producing nothing, and read as correct in source.
  `0 px → 5557 px`.
- **Poles were hidden behind the train.** The band started at y=118 while the
  consist occupies 123..166, leaving 5 visible rows and no visible wire sag.
  Moved to y=84..147.
- **Litter was buried.** Drawn before the 64 px foreground conifer layer, it was
  invisible even once it drew.

### Performance
- Wake `2.56 ms → 0.10 ms` — `Math.ceil` ran once per pixel; it depends only on
  the row. Whole frame `11.50 ms` of a 16.67 ms budget.

### Tests
- **52 assertions**, up from 45. New: sixth-layer presence and tiling, ripple
  expansion (107 px at 0.35 s → 143 px at 1.2 s, sky clicks ignored), ripple
  expiry, and ground-litter coverage measured in isolation against a cleared
  band — the pass is deterministic, so a second call after `render()` legitimately
  changes nothing, which is exactly what made the no-op look like a test bug.
- The ripple assertion tests **growth**, not pixel count. A fixed threshold would
  pass a static sprite.

### Notes
- Depth-shear reflections were **not** implemented. The existing reflection
  already applies 1.9× vertical compression and per-row horizontal wobble; a
  per-column shear would need `t` inside the water loop and risked the
  bit-exact loop proof for no visible gain at this resolution.

## [3.0.0] — 2026-10-01

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