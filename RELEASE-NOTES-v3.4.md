# MIDNIGHT MERIDIAN v3.4.0

**A test that could never fail, found by deliberately breaking the code.**

Open `index.html`. One file, 4.24 MB, no build, no server, no network.

---

## The bug was in the test

Since v3.0, `tools/cdp_check.py` has asserted that clicking a theme button changes
the rendered frame. It passed every run.

It would also have passed with **every button wired to nothing.**

```python
before = hashFB()          # t = 0.0s
b.click()                  # "Japan"
after  = hashFB()          # t = 1.2s
check(before != after)     # passes -- because the train moved
```

The piece is animating. `hashFB()` reads the live framebuffer, so it changes on
every tick regardless of input. The assertion was measuring *the animation*, not
*the button*.

## The fix

Pause first, prove the hash is actually still, then click:

```
[ok]  hash is stable while paused (the check can isolate a real change)
[ok]  a paused theme button still changes the scene
[ok]  the clicked theme actually became active
```

A theme change rebuilds the palettes and every layer strip, so a genuine switch
must alter the frame even with time frozen. With time frozen, nothing else can.

This required a real code change: `paused` was module-scoped with no setter, and
`simFrame` is a getter that cannot be reassigned from outside. **No browser test
could hold the scene still.** `MM.paused`, `MM.togglePause()` and
`MM.renderNow()` are now exposed.

## Proof, not vibes

A green assertion nobody has ever seen fail is not evidence. So I broke the code
on purpose:

```
--- MUTANT BUILD (theme buttons disconnected in ui.js) ---
[ok]  hash is stable while paused
[FAIL]  a paused theme button still changes the scene
        1261940468 -> 1261940468 (style=midnight)
[FAIL]  the clicked theme actually became active
        MM.theme.style = midnight

--- RESTORED ---
ALL BROWSER CHECKS PASSED
```

The new checks fail on the mutant and pass on the real code. **The previous
version passed that same mutant.**

---

## Verification

```
node verify.js                # 56 assertions, 96 bit-exact loop proofs
python tools/cdp_check.py     # 11 assertions in real Chrome
node diag-perf.js             # per-pass frame cost
node snap.js                  # theme contact sheet to PNG
```

**67 assertions, all passing.** Frame cost **11.7 ms** of a 16.67 ms budget.
Every one of 129,600 pixels painted. All 96 theme × season combinations bit-exact
at the loop boundary.

## Where the last four releases went

| Release | What it actually fixed |
|---|---|
| v3.0.0 | The forest was rendering 3 green pixels. Day and night were identical (luma 21.9). |
| v3.1.0 | The ground-litter pass drew zero pixels — every `x` was a fraction, so every write landed on a non-integer array index. |
| v3.2.0 | Six of thirteen audio clips were never played, and the piece opened silent. |
| v3.3.0 | Winter's bare branches were painted in summer's foliage colour. |
| **v3.4.0** | **A test that would pass if the buttons were disconnected.** |

Four of those five bugs were invisible to the suite that existed at the time.

---

**Design & code:** Joe Williams ([DrGekoz](https://github.com/DrGekoz))