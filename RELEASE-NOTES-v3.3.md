# MIDNIGHT MERIDIAN v3.3.0

**Winter trees finally read as winter.**

Open `index.html`. One file, 4 MB, no build, no server, no network.

---

## The open question, closed

Since v3.0 one thing was unresolved, and I flagged it rather than pretend otherwise:

> "Vision and the pixel counters disagree on winter trees."

They did not disagree. **Both were measuring something real.** The pixel counter
was right that there was almost no green. The colour was still wrong.

### What was actually wrong

Winter's bare branches were being blended 55% into the *style* palette:

```js
const tint = (base) => mixC(base, fol.a, 0.55);
```

Winter's bark grey `#2a2622`, pulled 55% into the midnight style's blue base
`#233546`, landed at **`RGB(35,50,69)`** — indistinguishable from summer's
foliage. The trees were geometrically bare (no branch tiers, no leaf mass), but
they were painted in the exact colour of a summer tree, so they read as small
dark conifers rather than as winter wood.

A count-based assertion could never have caught this. "Not green" and "looks like
bare wood" are different claims, and only the second one was false.

### The fix

The season now **dominates** rather than tints, with the blend weight scaled by
how saturated the season colour is. A vivid green can be blended gently and
still read as that green. A near-neutral bark grey has to be blended hard or it
disappears into whatever it is mixed into. Bare trees skip the blend entirely —
there is no foliage mass left to tint.

| season | tree pixel | reads as |
|---|---|---|
| spring | `RGB(63,96,54)` | fresh green |
| summer | `RGB(41,89,43)` | deep green |
| autumn | `RGB(148,91,32)` | amber |
| **winter** | **`RGB(20,17,16)`** | **bare bark, saturation 20%** |

### How I settled it

Not by asking a vision model again — it kept reporting green, because it is
reading dark bark and bright sky through the same branch shapes at 480×270. That
is a limitation of looking at a 480×270 image blown up, not a defect in the art.

Instead: switched to winter/day in real Chrome, read the **live framebuffer**
through CDP, and histogrammed the tree band.

```
sky   155,188,251   (1911 px)
bark   20, 17, 16   ( 758 px)
green                      0 px
```

Unambiguous. The new assertion encodes exactly that — it checks winter's
dominant tree pixel is desaturated (< 22%) and dark (max channel < 70), not that
it merely lacks green.

---

## Also fixed

**Screenshot tooling was clicking buttons that were not there.** Buttons inside a
closed panel are not laid out, so `element.click()` silently did nothing — and I
spent a review cycle looking at summer screenshots while believing they were
winter. The tooling now opens the panel first, and the theme is confirmed by
reading `MM.theme` back rather than trusting that a click did anything.

---

## Verification

```
node verify.js                # 56 assertions, 96 bit-exact loop proofs
python tools/cdp_check.py     # 9 assertions in real Chrome
node diag-perf.js             # per-pass frame cost
```

All 65 passing. Frame cost **11.7 ms** of a 16.67 ms budget. Every one of 129,600
pixels painted. All 96 theme × season combinations bit-exact at the loop
boundary.

---

**Design & code:** Joe Williams ([DrGekoz](https://github.com/DrGekoz))