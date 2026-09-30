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
embankment. Autumn drops amber leaves that tumble as they fall and carpet the
near bank. Rain fills the puddles and roughens the lake; snow ices it over.

Six parallax layers — stars, two mountain ranges, two pine lines, and telegraph
poles with sagging catenary wire at 1.50×. The poles are what make it read as
speed rather than as a panning image.

**Click the water** and a ring expands across it. Click the sky and nothing
happens.

The music is not a loop and it is not a sample. It is composed when you press play
— chord progressions from a functional-harmony table, a motif that develops across
sections, real song form, and drum grooves from **Bjorklund's Euclidean algorithm**
(the same maths behind cumbia and the cinquillo). Same seed, same song, every time.

## Why it's interesting

- **A perfect 120-second loop** across 96 scene variants, verified pixel-for-pixel.
- **The train faces the right way.** There is a six-assertion test for this,
  because it was wrong once and a bounding-box check would not have caught it.
- **Sixth parallax layer** — telegraph poles and catenary wire, tiling exactly
  (480 px / 48 px spacing = 10 poles) so the strip cannot tear at the wrap.
- **One silent no-op, found by measurement.** The ground-litter pass ran 200+
  iterations a frame and drew exactly zero pixels, because `rnd()` returns a
  fraction and `fb[333.35 * VW + y]` writes to a non-integer index, which is
  silently discarded. It looked completely correct in the source.
- **Bugs are caught by assertions written to catch them.** The ripple test
  asserts the ring *grows*, not that some pixels changed — a fixed threshold
  would have passed a static sprite. The clip-reachability test walks all 24
  themes because six bundled recordings were, briefly, 2 MB of dead weight.
- **Two tools disagreeing is information.** For three releases a pixel counter
  said "no green in winter" while a vision model said "evergreen conifers". Both
  were right: the trees *were* bare, but painted in summer's colour. The fix was
  to blend the season colour by its own saturation, and the assertion now checks
  the colour rather than the count.
- **It is tested in a real browser**, not just in a VM. `tools/cdp_check.py`
  talks to Chrome over the DevTools protocol and asserts zero console errors,
  true fullscreen coverage, and that a theme button really changes the frame.
- **The browser checks are mutation-tested.** Every release since v3.1 broke the
  code on purpose to confirm the suite actually fails. One check was passing
  vacuously — it compared frame hashes while the piece was animating, so it
  would have passed with every theme button disconnected.
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
node verify.js                  # 56 assertions, including 96 loop proofs
python tools/cdp_check.py      # 11 checks in REAL Chrome (needs --remote-debugging-port)
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