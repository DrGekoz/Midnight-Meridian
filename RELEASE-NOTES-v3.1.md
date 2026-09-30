# MIDNIGHT MERIDIAN v3.1.0

**The sixth parallax layer, weather-driven water, ground litter, and interaction.**

Open `index.html`. One file, 4 MB, no build, no server, no network.

---

## What's new

### Telegraph poles and catenary wire

A sixth parallax layer at 1.50×, sitting between the near forest and the
embankment. Wires are what sell a railway scene — they cut the sky into
receding bands and give the eye a sense of speed that the ground alone cannot.

The strip tiles exactly: 480 px wide, 48 px spacing, ten poles, no tear at the
wrap. Cross-arm heights derive from the band height and the wires hang from the
insulator tips, so the geometry stays physically attached if the band ever
changes size.

The first attempt placed the band at y=118. The consist occupies y=123..166, so
only five rows showed above the boiler and the wire sag was buried behind the
carriages. It now sits at y=84..147, standing proud of the train.

### Click the water

An expanding ring crosses the lake. Click the sky and nothing happens.

Ripples are drawn as an **overlay after `render()`**, never inside it. They are
the one thing in the piece keyed to wall-clock time, so folding them into
`render(t)` would make the frame depend on state outside `t` and break the
bit-exact loop proof. They expire after 2.2 s and are capped at six, so they
cannot accumulate.

### Weather-driven puddles and ground litter

Puddles were unconditional from v1. They now scale with the weather's ripple
value, ice over in winter, and vanish under a clear sky.

Autumn drops a carpet of leaves on the near bank — clustered along drift lines,
because leaves collect against the grass. Winter lays rime in the grass and no
leaves at all. Spring drops blossom.

### Settings that stick

Theme, season and audio gains persist to `localStorage`. The loader validates
every field: a stale or hand-edited entry falls back to the default rather than
leaving the piece in a state it cannot render.

`prefers-reduced-motion` opens the piece paused.

---

## One bug worth reading about

**The ground-litter pass drew exactly zero pixels.**

It ran 200+ iterations every frame. Every single argument was correct — the
theme resolved, `ground.litter` was `[184, 118, 58]`, `fallLeaves` was 46, the
band was in range. And it produced nothing.

```js
const x = ((rnd() * VW + base) % VW + VW) % VW;   // 333.35...
addPix(x, y, ...);                                 // fb[333.35 * VW + y]
```

`rnd()` returns a fraction. `fb[333.35 * VW + y]` writes to a non-integer array
index, and JavaScript silently discards it. No error, no warning, no visible
symptom except a pass that ran forever and did nothing — and source code that
reads as perfectly correct.

It took instrumenting the function's own loop variables to see the fractional
`x`. Now floored at every site: **0 px → 5557 px**.

The lesson shaped the test too: because the pass is deterministic, calling it
again after `render()` legitimately changes *nothing*, which made the no-op look
like a test-harness bug rather than a rendering bug. The assertion now clears the
bank band first, then measures the pass in isolation.

---

## Verification

```
node verify.js       # 52 assertions, 96 bit-exact loop proofs
node diag-perf.js    # per-pass frame cost
node snap.js         # theme contact sheet
```

New in this release:

- **sixth parallax layer present: 30,720 px of poles and catenary wire**
- **poles strip tiles exactly: 480px wide, 48px spacing, 10 poles**
- **click ripples expand: 107 px at 0.35 s → 143 px at 1.2 s; sky clicks ignored**
- **ripples expire instead of accumulating**
- **ground litter paints the near bank: 5557 px**

The ripple assertion tests *growth*, not pixel count. A fixed threshold would
have passed a static sprite.

## Performance

| Pass | Before | After |
|---|---|---|
| Wake ripples | 2.56 ms | **0.10 ms** |
| Whole frame | 14.18 ms | **11.50 ms** / 16.67 |

`Math.ceil` was running once per pixel in the wake loop; it depends only on the
row.

## Not implemented

**Depth-shear reflections.** The existing reflection already applies 1.9× vertical
compression and per-row horizontal wobble. A per-column shear would put `t`
inside the water loop and risk the bit-exact loop proof for no visible gain at
480×270. Worth doing only if someone asks for a higher internal resolution.

---

**Design & code:** Joe Williams ([DrGekoz](https://github.com/DrGekoz))