# MIDNIGHT MERIDIAN v3.2.0

**Layered ambient buses, and a real-browser check suite.**

Open `index.html`. One file, 4 MB, no build, no server, no network.

---

## Two bugs found by auditing the requirements instead of the code

Everything below was already "done" — the panel worked, the audio played, the
tests were green. These were found by re-reading what was actually asked for and
checking it against reality.

### Six of thirteen bundled clips were never played

`fire`, `stream`, `waves`, `thunder`, `clock` and `crowd` had all been fetched,
licensed, credited, base64-inlined into a 4 MB file — and were unreachable. The
selection logic picked five clips and stopped.

The ambient buses are now **layered**. A storm gets rain *and* thunder. A summer
day gets birds *and* stream *and* waves. A winter night gets crickets *and* fire
*and* wind. Layer 0 is the bed at full level; layers 1..n route through their own
gain node at 0.42 so the mix does not turn to mud.

`playBus()` diffs the requested list against what is already playing, so an
unchanged scene is a genuine no-op — important, because re-triggering a 30-second
loop file audibly clicks its seam.

A new assertion walks all 24 themes × 4 seasons and unions every clip that can be
selected, then fails if any bundled asset is missing from the set. It reported
`9 of 13 clips dead` on its first run before the fix.

### The piece opened silent

The master bus was `0` while `muted` was `true`. Press play and you heard
nothing: the music bus was up at 0.8, but everything routed through a master at
zero. The panel showed a **music slider at 80** next to a **master at 0**, and
`rain` and `amb` were also at 0.

A vision review of a real browser screenshot is what surfaced this — three
sliders reading 0 next to a live-looking scene.

Defaults are now **80 / 80 / 55 / 45 / 70**. `muted` still starts true, because
that is the browser autoplay policy rather than a volume bug: no sound escapes
until the user interacts, but the slider reflects the level they will hear.

---

## Tested in a real browser

`tools/cdp_check.py` drives the shipped `index.html` in real Chrome over the
DevTools protocol — no test doubles for the DOM, no approximations.

```
[ok]  page booted with no console errors
[ok]  canvas exists and is sized
[ok]  canvas COVERS the viewport (true fullscreen, no letterbox)
[ok]  game pixels are solid blocks (nearest-neighbour sampling)
[ok]  panel exposes style / time / weather / season buttons
[ok]  panel exposes 5 gain sliders
[ok]  clicking a theme button changes the rendered frame
[ok]  requestAnimationFrame is animating (not stalled)
[ok]  no errors after exercising the panel
```

```
chrome.exe --remote-debugging-port=9222 --user-data-dir=<scratch>
python tools/cdp_check.py
```

### Two of my own assertions were wrong, and I fixed the tests

**"every game pixel is square"** failed at scale 3.3083. The piece deliberately
*covers* the viewport rather than fitting inside it, so 480×270 in a 1588×808
window is necessarily non-integer. Nearest-neighbour sampling is the actual
guarantee that every game pixel is a solid block; an integer scale is a nicety
that only holds on a lucky viewport. Confirmed via `getComputedStyle`:
`image-rendering: crisp-edges`, backing store 480×270.

**"rAF near 60fps"** failed at 177 fps. Headless Chrome does not throttle
`requestAnimationFrame` to the display refresh. Asserting ≥ 30 catches a stall,
which is the thing worth catching; the real 16.67 ms budget is proven separately
against actual render cost in `node verify.js`.

Neither was an artwork defect. Both were tests that asserted the wrong thing.

---

## Verification

```
node verify.js                # 55 assertions, 96 bit-exact loop proofs
python tools/cdp_check.py     # 9 assertions in real Chrome
node diag-perf.js             # per-pass frame cost
node snap.js                  # theme contact sheet to PNG
```

57 assertions in total, all passing. Frame cost **11.71 ms** of a 16.67 ms
budget. Every one of 129,600 pixels painted. All 96 theme × season combinations
bit-exact at the loop boundary.

---

**Design & code:** Joe Williams ([DrGekoz](https://github.com/DrGekoz))