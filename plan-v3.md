# MIDNIGHT MERIDIAN — v3 plan

Research-informed revision. Two parts: **what the research found**, and **what I am
building on top of it**. The v1 renderer and v2 control/audio system are already
built and verified (see `plan.md` and `plan-v2.md`); this document covers what comes
next and why.

---

## 1. Research findings — repos worth borrowing from

I searched GitHub and the web for **code-only, CPU-only, no-GPU, no-samples** engines
that fit the constraint that MIDNIGHT MERIDIAN ships as one HTML file.

### 1.1 `simpllyf/ditty` — the big find

| | |
|---|---|
| Repo | https://github.com/simpllyf/ditty |
| Licence | **MIT** |
| Version | `@simpllyf/ditty` 0.6.0 |
| Deps | **none** |
| Size | ~17.5 KB min+gzip |

This is almost exactly what this project wants, and it is *specifically* lo-fi
oriented. Verified from its source tree, not just its README:

- `src/styles.ts` exports a **`lofi`** style alongside `dreamy`, `ambient`,
  `cinematic`, `calm`. Lo-fi is a first-class style, not an afterthought.
- `src/core.ts` is a **side-effect-free pure layer** that "runs in plain Node with
  no `AudioContext`" — it is importable and testable without a browser.
- The composition pipeline is properly musical, not random-note noise:
  `theory/scales` (`SCALES`, `RAGA_PATHS`), `theory/chords` (`diatonicChord`,
  `romanNumerals`, `isChordTone`), `theory/progressions` (`PROGRESSIONS`,
  `functionalProgression`), `compose/harmony` → `compose/melody` →
  `compose/motif` (`developMotif`, `MOTIF_TRANSFORMS`) → `compose/arranger`
  (`arrange` → `Score`).
- Song **form** is real: `compose/form.ts` (23 KB) builds verse/bridge/climax
  sections with key changes; `closing.ts` writes an actual cadence.
- **Humanisation** exists as a first-class pass: `compose/humanize.ts`,
  `theory/rhythm.ts` with `applySwing`, `metricStrength`, `fitGroove`,
  `DRUM_GROOVES`.
- Everything is driven by a **seeded PRNG** (`rng.ts`, `makeRng`) — same seed,
  same music. That matters here: a deterministic score is testable.
- Legal note worth keeping: it composes from "uncopyrightable building blocks
  (scales, ragas, chords, common progressions — all public domain)", so generated
  tracks are free to use commercially.

**Decision: vendor the pure `/core` composition layer, keep our own audio engine.**
We already synthesise music in `src/audio.js`; replacing it wholesale would throw
away working, verified code. Instead we import Ditty's *theory and arrangement*
and feed its `Score` into our existing Web Audio synth. That gives us real chord
progressions, motifs, song form and swing for the price of one vendored file, with
no change to the audio graph and no new runtime dependency.

Licence obligation: MIT requires the copyright notice. `NOTICE.md` will carry
the Ditty attribution, and the vendored file keeps its header.

### 1.2 Bjorklund / Euclidean rhythm

The canonical algorithm is Bjorklund's (1982), published for the SNS timing system,
and demonstrated for music by Toussaint (2005). Implementations found:

- `mkontogiannis/euclidean-rhythms` — the best-tested JS port, with unit tests.
- `dbkaplun/euclidean-rhythm` — 59 stars, MIT, the most widely used.
- `adriano-di-giovanni/bjorklund-js`, `lvm/bjork-js`, `zya/bjorklund` — smaller
  ports, all producing identical sequences.

They all agree: `getPattern(3,4) → [1,0,1,1]`, `getPattern(5,8) → [1,0,1,1,0,1,1,0]`.

**Decision: implement the ~20-line algorithm inline, with those vectors as unit
tests.** The algorithm is small enough that vendoring a package for it is worse
than owning it, and the two vectors above give an unambiguous correctness check.

This gives the drum voices real world-music grooves (3-against-4 cumbia,
5-against-8 cinquillo) instead of the hand-waved patterns in v2.

### 1.3 Web Audio scheduling references

- `Tonejs/Tone.js` (14.7k stars) — the standard, but it is a ~500 KB dependency and
  we ship one file with no CDN. **Rejected on size**, but its scheduling model
  (lookahead scheduler on a timer, not `setTimeout` per note) is the correct
  architecture and v2 already follows it.
- `0266st/Petrichor`, `innermost47/random-music-js`, `pd3v/fluX.js`,
  `madmonk13/modal-16` — all useful as pattern references for layered synth
  architecture (pad → bass → arp → drums, each with its own filter envelope).
  `modal-16`'s "tape wobble + lo-fi low-pass + vinyl noise" master chain is exactly
  the lo-fi character v2 is missing.

### 1.4 Pixel art / procedural generation — honest result

Searched `pixel art canvas procedural`, `generative pixel art`, `dithering pixel
art shader`, `pixel art generator code`. **Nothing suitable.** The results are:

- CryptoPunks derivative art (Solidity) — on-chain, not code-drawn pixels.
- `posabsolute/zork-ui` — genuinely good pixel art, but **110 hand-crafted
  sprites**, i.e. assets. Excluded by the brief.
- Assorted toy generators, all under 30 stars and all asset-based.

So there is no credible reference implementation to borrow for the renderer. The
existing v1 renderer already does the right things — ordered-dither ramps,
Bayer-thresholded light, 1px crest tables, deterministic value-noise ridges — and
the *references that matter are academic, not GitHub*:

- **Ordered dithering**: the Bayer matrix construction is standard (recur by
  `M(2n) = [[4M, 4M+2],[4M+3, 4M+1]]`), and v1 already uses it correctly.
- **Toussaint 2005**, "The Euclidean algorithm generates traditional musical
  rhythms" — the paper behind the drum patterns.

**Decision: no vendoring for the renderer.** Write the new scenery from the same
primitives v1 already uses, and cite the papers in the code comments.

---

## 2. Bugs found in v2 that this revision must fix

These came out of a vision review of the rendered output plus `diag-layers.js`,
not from reading code.

```
theme                        forest strip px   green px   brightSky px
midnight-night-clear/summer           492            3            68
midnight-day-clear/spring             492            5           375
midnight-day-clear/summer             492            5           363
```

| # | Bug | Cause | Fix |
|---|---|---|---|
| B1 | **No green anywhere.** Spring reads as a night scene. | `applyTheme`'s day relight blends `PF`/`PN` toward `DAY_SKY` at `f=0.30/0.26`, which destroys foliage hue. | Daylight vegetation must stay green and only be *lifted*, not re-hued. |
| B2 | **Forest is invisible.** 492 non-transparent px across a 480px band. | `buildForest(y0,h,seed,count=44,…)` at `src/core.js:503` — count far too low and trees too short for the band height. | Density and height tuned per layer, verified by pixel count. |
| B3 | **Stars drawn in daylight.** `brightSky=375` in a day theme. | Star pass is not gated on `T.stars`. | Gate on the resolved flag; prove by pixel count. |
| B4 | Day = night (luma 21.9 vs 21.9). | 1.55× multiply on a near-black palette. | Already fixed with `liftPal()`. Regression test now measures luminance. |

The general lesson, which is the real fix: **v2 had no test that would have caught
B1–B3.** `verify.js` proved themes change *a* hash and that the loop is exact, but
never that the vegetation is green or that stars are absent by day. Part 4 adds
those assertions.

---

## 3. Extra features I want to add, and why

### F1 — Real lo-fi arrangement (from Ditty)
- Chord progressions via `functionalProgression`, not random notes.
- Song form (verse → bridge → climax) that develops a motif.
- Swing and humanised timing.
- Seeded: the same seed yields the same track, so it is testable and shareable.
- **Lo-fi character**: tape wobble (slow LFO detune), a resonant low-pass at
  ~1.8 kHz, vinyl crackle noise, and a soft bus compressor. Modelled on `modal-16`.
- **Music follows the theme**: the style picks the seed's style preset, and
  weather/time-of-day reshape the filter and register rather than the notes — so
  rain is darker and slower, day is brighter and more open, snow is wide and
  sparse, Cyberpunk is faster and detuned, Japan uses a pentatonic scale.

### F2 — Euclidean drums
Real grooves from Bjorklund, per style: cumbia, cinquillo, tresillo, baião.

### F3 — Legible seasons and weather (fixes B1–B3, then goes further)
- **Spring** green flush + blossom on the trees, flowers in the embankment,
  light shafts, **zero snow anywhere** (already asserted, keep asserting).
- **Summer** deep green, clear skies, fireflies at night, heat haze by day.
- **Autumn** amber canopy, falling leaves, litter on the ground.
- **Winter** bare branches, snow caps on ridges and trees, snow lying on the
  embankment, ice on the lake, snowfall particles.
- Weather is independent of season: rain, snow, cloudy and clear each carry their
  own sky cover, particle system and water response.
- **Puddles**: a new foreground layer whose presence is driven by weather — they
  pool under rain, freeze over in winter, and reflect like the lake does.

### F4 — Better reflections
- Water gets per-row horizontal displacement keyed to depth, so the reflection
  shears more the further from the shoreline (correct physics, better read).
- Reflections dim with depth and pick up the sky tint.
- Rain dimples on the lake surface; snow frosts it.

### F5 — Scene depth
- A sixth parallax layer: distant power-line pylons and catenary wire in the
  mid-ground, which also catch the headlamp.
- Foreground reeds/grass that bend in wind and in rain.
- Passing telegraph poles with a rhythmic clack, synced to the train.

### F6 — Interaction
- Click/tap drops a ripple ring in the water that spreads and fades.
- The headlamp cone sweeps slightly with the train's bob.
- `H` toggles a compact HUD: loop time, theme, fps, particle counts.

### F7 — Accessibility & robustness
- `prefers-reduced-motion`: slows the train and disables screen shake/flashes.
- Keyboard-complete: the panel is fully operable by keyboard, Escape closes it.
- Audio starts muted; one click to enable (browser autoplay policy), then it
  remembers the choice in `localStorage`.
- Saves theme/season/weather/volume to `localStorage` and restores on load.

### F8 — Ship quality
- README with an About section, badges, a GIF still, and the run command.
- `CHANGELOG.md` and tagged releases.
- A `docs/` note on the loop maths, because that is the part everyone will ask about.

---

## 4. Verification plan (what must be true before shipping)

`verify.js` grows new assertions, each of which exists because it would have
caught a real bug:

| Assertion | Catches |
|---|---|
| green pixel count in the forest band > threshold, per season | B1, B2 |
| bright-sky pixel count by day ≈ 0 | B3 |
| snow pixel count in spring = 0 (already) | season leak |
| bare-tree pixel count in winter > threshold | season not applied |
| puddle pixels present under rain, absent in clear summer | F3 |
| day sky luminance > 1.5× night (already) | B4 |
| all 96 theme×season combos loop exactly (already) | any periodicity regression |
| every pixel painted (already) | compositing holes |
| theme must change *specific* pixels, not just any | silent no-op themes |
| Euclidean patterns match the Toussaint vectors | F2 correctness |
| music: same seed → identical score; different seed → different | F1 determinism |
| frame cost < 16.67 ms with the heaviest theme | budget |

---

## 5. Build order

1. Fix B1–B3 and land the new assertions. **Nothing else until green.**
2. Vendor Ditty `/core`; add `NOTICE.md`.
3. F1 + F2: real arrangement and Euclidean drums behind the existing audio bus.
4. F3 scenery, per season and weather, with the pixel-count tests.
5. F4 water improvements.
6. F5 depth layers.
7. F6 interaction + HUD.
8. F7 persistence, reduced motion, keyboard.
9. F8 README/CHANGELOG/releases; final visual review; ship.

---

## 6. Risks, stated plainly

- **Vendoring Ditty is a real dependency.** It is MIT and zero-dep, but it is a
  second codebase to read. Mitigation: we vendor only the pure theory/arrangement
  layer, keep our own audio engine, and pin the version in `NOTICE.md`.
- **120 s loop × 96 themes is 96 proofs per run** (~30 s). That is acceptable for
  CI but slow for iteration; I will keep a `--fast` subset for the inner loop.
- **Vision review is flaky** (it timed out repeatedly this session). I will lean on
  numeric checks and only use vision for judgement calls, not for pass/fail.
- **More scenery costs frame budget.** Current usage is 9.3 ms of 16.67. The water
  and smoke passes are the hot spots; anything new must be table-driven or
  pre-baked, and I will re-profile rather than assume.