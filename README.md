# MIDNIGHT MERIDIAN

### A 120-second, pixel-perfect, seamlessly looping night train — computed entirely in code.

**96 scenes. Real lo-fi music that writes itself. One HTML file. Zero assets.**

Open `index.html`. That's the whole thing.

---

<p align="center">
  <img src="hero_x3.png" width="820" alt="A pixel-art steam train crossing a moonlit viaduct above a reflective lake, drawn entirely in code">
</p>

---

## What it is

A steam train runs right-to-left past you for exactly two minutes. Then it does it
again, and the seam is invisible — `render(0)` and `render(120)` produce
**bit-identical** frames, and the test suite proves it across all 96
scene combinations.

Every pixel is generated at runtime. There are no sprites, no images, no fonts,
no CDN. The mountains are value noise; the trees are procedurally stacked cones;
the stars are Bayer-dithered sub-pixel slides; the smoke is 300 particles whose
positions are pure functions of their age. The lake reflects the train because it
is sampling the actual framebuffer, not a pre-baked fake.

Change the scene and the whole world rebuilds: **3 styles × day/night × 4 weather
× 4 seasons**. Midnight gets a starfield and a moon. Day gets a real sun and
green trees. Winter strips the conifers to bare branches and lays snow on the
embankment. Autumn drops amber leaves that tumble as they fall.

The music is not a loop and it is not a sample. It is composed when you press play
— chord progressions from a functional-harmony table, a motif that develops across
sections, real song form, and drum grooves from **Bjorklund's Euclidean algorithm**
(the same maths behind cumbia and the cinquillo). Same seed, same song, every time.

## Why it's interesting

- **A perfect 120-second loop** across 96 scene variants, verified pixel-for-pixel.
- **The train faces the right way.** There is a six-assertion test for this,
  because it was wrong once and a bounding-box check would not have caught it.
- **The music is a pure function.** It runs in Node with no `AudioContext`, which
  is why it can be unit-tested. The Euclidean generator has eight published test
  vectors and a sum invariant, because it was wrong three times first.
- **60 FPS budget, met.** 12.6 ms median of 16.67, profiled pass by pass.
- **Zero runtime dependencies.** Not one. No framework, no library, no CDN.

## Run it

```
open index.html          # that's it — no server, no build, no install
```

Everything is inlined. It works offline, from a USB stick, in a browser from 2015.

### Development

```
python tools/fetch_audio.py     # re-fetch the ambient bed from Openverse
python tools/build_single.py    # rebuild index.html from src/
node verify.js                  # 45 assertions, including 96 loop proofs
node snap.js                    # render a theme contact sheet to PNG
node diag-perf.js               # per-pass frame cost
```

`src/` is split for readability and concatenated into the single file at build
time. Edit `src/`, never `index.html` directly.

## How the loop works

Two rules, and everything else follows.

**1. Every time-dependent quantity is periodic in 120 s.** Offsets wrap modulo the
frame width, wheel rotation runs a whole number of revolutions (48 × ⅛-turn steps),
and particle ages are taken *modulo* the loop. Not `if (a < 0) a += 120` — that
conditional leaves exactly one particle in the wrong place at the boundary. It is
`(t - et) % 120`.

**2. Every float is canonicalised at the entry to `render()`.** `t` is folded into
`[0, 120)` before anything else touches it. Without this, a large phase value
accumulates floating-point drift and the puddle rows differ by a handful of pixels
at `t = 120`.

That's the whole trick. The visual richness comes from layers on top, not from
fighting the loop.

## About

**MIDNIGHT MERIDIAN** began as a way to draw a beautiful picture with no pictures —
one canvas, one framebuffer, every pixel earned. It grew a control panel, a score,
and ninety-six ways to watch the same train pass.

It is built and verified by a headless harness that boots the real shipped
`index.html` in a stubbed DOM and asserts against the live framebuffer, not
against a copy of the source. When the suite is green, the thing that ships is the
thing that was tested.

Design: **Joe Williams (DrGekoz)** — [github.com/DrGekoz](https://github.com/DrGekoz)

### How it's built

| Piece | What it does |
|---|---|
| `src/core.js` | Framebuffer, palettes, all layer builders, the composite |
| `src/themes.js` | 3 palettes × 2 times of day × 4 weather, resolved to one state |
| `src/weather.js` | Rain, snow, clouds, blossom, leaf fall, snow caps, ice, fog |
| `src/music-theory.js` | Scales, chords, progressions, **Bjorklund**, song form, composer |
| `src/audio.js` | Web Audio synths: music, train, ambient buses, lo-fi character chain |
| `src/ui.js` | The control panel |
| `src/main.js` | Boot, theme state, main loop |

## Credits & licence

Original work. Third-party references, prior art and **audio licensing** — which
includes three non-commercial-only clips — are documented in **[NOTICE.md](NOTICE.md)**.
Please read it before redistributing.

## Links

- Issues: [github.com/DrGekoz/Midnight-Meridian/issues](https://github.com/DrGekoz/Midnight-Meridian/issues)
- Licence: MIT (see `LICENSE`)