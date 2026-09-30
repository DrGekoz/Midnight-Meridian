# MIDNIGHT MERIDIAN v3.0.0

**A 120-second, pixel-perfect, seamlessly looping night train — computed entirely in code.**

Open `index.html`. That is the whole thing: no build, no server, no install, no
network. One file, 4 MB, works offline from a USB stick.

---

## What you are looking at

A steam train runs past a moonlit viaduct for exactly two minutes, then does it
again without a seam. `render(0)` and `render(120)` produce **bit-identical**
frames, and the test suite proves it across all 96 scene combinations.

Every pixel is computed at runtime. The mountains are value noise. The trees are
procedurally stacked cones with notched branch tiers. The stars are
Bayer-dithered sub-pixel slides. The lake reflects the train because it samples
the live framebuffer, not a pre-baked image.

**3 styles × day/night × 4 weather × 4 seasons = 96 scenes**, each a distinct
palette and particle set.

## The music is written, not looped

Press play and the score composes itself: chord progressions from a functional
harmony table, a motif that develops across sections, real song form (intro → A →
B → out), and drum grooves from **Bjorklund's Euclidean algorithm** — the same
maths behind cumbia and the cinquillo. A lo-fi character bus adds tape wobble, a
resonant low-pass, vinyl crackle and surface hiss.

The composer is a **pure function**, so it runs in Node with no `AudioContext` and
can be unit-tested. Same seed, same song, every time — which is what makes
"generative" reproducible rather than merely random.

## Five real bugs, found by measuring

| Bug | Before | After |
|---|---|---|
| Forest invisible — `mixPal` called on a single colour returned `{}`, so every tree pixel stored as `0` | 3 green px | **3246** |
| Winter trees still green — `T.bare` resolved then ignored by `drawPine` | 3246 px | **9** |
| Day identical to night — a 1.55× multiply on a near-black palette cannot make daylight | luma 21.9 | **157.9** |
| Daylight carried a cratered moon — baked into the sky plate unconditionally | moon at noon | gone |
| Falling blossom as sky-wide white specks — read as stars | stars by day | none |

Two of my first attempts at the *test* were also wrong, and I fixed the test
rather than the art: one "greenness" metric rewarded dark desaturated pixels and
ranked winter above spring, and an HSV version was circular because the gate
already selected for saturated green. Coverage is the honest measure.

## Performance

| Pass | Before | After |
|---|---|---|
| Smoke | 11.8 ms | **2.2 ms** |
| Celestial halo | 2.97 ms | **0** (baked) |
| Water reflections | 48.5 ms | **1.2 ms** |
| **Whole frame** | 48.5 ms (v1) | **12.9 ms** / 16.67 budget |

Smoke: `Math.exp` twice per particle became a lookup table (only 300 ages are
reachable across the whole loop, so the table is exact) and the per-pixel
`Math.sqrt` became a squared-distance compare.

## Verification

```
node verify.js       # 33 assertions + 96 bit-exact loop proofs
node diag-perf.js    # per-pass frame cost
node snap.js         # render a theme contact sheet to PNG
```

The harness boots the **real shipped `index.html`** in a stubbed DOM and asserts
against the live framebuffer — not against a copy of the source. When the suite is
green, the thing that ships is the thing that was tested.

The Euclidean generator was **wrong three times** before it was right (it lost
pulses, then rotated, then bunched). It now has eight published Toussaint vectors
plus a sum invariant and a length check, because nothing in the artwork would ever
have noticed.

## Licensing

All thirteen audio assets are **CC0 or CC BY** — every one permits commercial use.
An earlier build contained three CC BY-NC 4.0 clips; those were located, replaced
and verified (`remaining non-commercial: NONE`).

Software is MIT. Audio is **not** covered by that — see [NOTICE.md](NOTICE.md) for
per-asset attribution, the required CC BY credits, and prior-art credits to
`@simpllyf/ditty` and the Bjorklund/Toussaint papers.

## Controls

`F11` full screen · `Space` pause · `D` diagnostics · **Scene** button opens the
panel: style, day/night, weather, season, and five audio gain sliders.

## Known issues

- Vision review disagrees with the pixel counters on winter trees: the harness
  measures 9 green pixels (correctly bare) while a vision model describes
  "evergreen conifers with snow caps" — thin 1 px branch strokes at this scale.
  Worth a human eye.

---

**Design & code:** Joe Williams ([DrGekoz](https://github.com/DrGekoz))