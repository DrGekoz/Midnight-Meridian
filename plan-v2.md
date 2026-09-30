# MIDNIGHT MERIDIAN — v2 plan: UI, audio, themes

Extends the shipped v1 (the 120-second pixel-art night train) with a control surface,
a synthesised music system, ambient audio, and a theming engine that changes the *art*,
not just the chrome.

Design brief: `DESIGN.md`. Art + renderer detail: §1-§11 of this file's earlier revision,
still accurate. This document covers what is new.

---

## 1. The central idea

The scene is not re-drawn per theme. **The same geometry is re-materialised.** Every theme
swaps a *palette* and toggles a set of *asset layers* — rain streaks, snow, blossom, leaves,
snow caps, ice, flowers, light shafts. The mountains stay mountains; the trees stay trees.
That is what keeps it one coherent piece rather than six unrelated pictures.

```
THEME = { palette, weather, season, tod, assets[], musicStyle }
```

`render(t)` takes a theme, so every existing loop guarantee still holds: all offsets are
integer multiples of `480/120`, all trig uses integer cycle counts, and the theme is folded
into the loop the same way `t` is.

---

## 2. Theme matrix

24 presets = 3 region/styles x 2 time-of-day x 4 weather. Seasons are a separate axis
(`--season`), which is what makes it 24 x 4 without combinatorial explosion.

### 2.1 Style axis (3)

| Style | Palette shift | Added pixel assets | Music |
|---|---|---|---|
| **Midnight** (default) | the shipped deep indigo / violet / amber | — | sparse lo-fi: 62 BPM, minor 9ths, soft hats |
| **Cyberpunk** | crushed blacks, electric cyan + hot magenta rails, acid-green windows | neon underglow on the embankment, holographic sign in the trees, scanline band | 128 BPM, saw bass, detuned square chords, arpeggio |
| **Japan** | indigo + vermilion torii red + warm lantern amber, flatter darks | torii gate on the ridge, paper lanterns on poles, cherry petals drifting | 78 BPM, pentatonic koto-like plucks, koto-ish envelope, soft taiko |

### 2.2 Time-of-day axis (2)

| | Sky | Moon/sun | Light source | Rim light | Water |
|---|---|---|---|---|---|
| **Night** | indigo → violet | moon, limb-darkened | cool | cyan | dark, high contrast reflection |
| **Day** | cyan → pale gold | sun disc, bloom | warm | warm white | bright, low contrast, sun glitter |

Day mode is not "the night palette with a slider up": the starfield is removed, the sky ramp
inverts, the ridge haze lightens, and the water tint becomes a pale sky-blue. The train
windows stop being the light source and become dark glass with a sun reflection.

### 2.3 Weather axis (4)

| | Sky | Particles | Ground / trees | Water | Music filter |
|---|---|---|---|---|---|
| **Clear** | clean gradient, stars at night | none | as per season | calm, sharp reflection | open, brighter |
| **Cloudy** | flat grey-blue, no stars at night, banded dithered cloud shelves | none | desaturated | flattened, low contrast | slight lowpass |
| **Rain** | dark grey, no stars | slanted streaks + splash rings on the bank | wet sheen, dark | rippled, broken reflection | darker, lowpass + rain layer |
| **Snow** | pale overcast, no stars | slow drifting flakes | **snow caps on trees + banks**, white ground | pale, slushy, dim reflection | heavily lowpassed, sparse |

### 2.4 Season axis (4) — orthogonal

| | Tree colour | Added assets | Explicit rule |
|---|---|---|---|
| **Spring** | fresh yellow-green | blossom on branches, flowers in the bank grass, light shafts through the canopy | **no snow anywhere, on the ground or otherwise** |
| **Summer** | deep saturated green | clear bright sky, strong sun glitter, heat-haze shimmer over the water | fullest foliage |
| **Autumn** | amber / rust / ochre | falling leaves (drifting + tumbling), leaf litter on the bank and rails | |
| **Winter** | bare — branches only, no foliage | snow caps, snow on the ground, ice sheets on the water | **the only season with snow assets** |

The "no pixel snow in spring" rule is enforced in code by `snowAssets = season === 'winter'`,
not by convention.

---

## 3. Audio architecture

Three independent layers, each with its own gain, all into a master bus.

```
                 ┌── musicBus  (synthesised, always on, style follows theme)
master gain ─────┼── rainBus   (Pixabay buffer, weather follows theme)
                 ├── ambBus    (Pixabay buffer, season/region follows theme)
                 └── trainBus  (synthesised, chuff synced to wheel phase)
```

### 3.1 Music — synthesised, not sampled

Web Audio, built once on first user gesture, **never rebuilt on theme change** (rebuilding
causes clicks and GC pressure). Theme changes only set oscillator parameters.

Voices: kick (sine with pitch envelope), snare/clap (filtered noise burst), hat (short noise,
highpass), bass (saw/triangle through a resonant lowpass), chords (3 detuned oscillators),
lead pluck (Karplus-Strong-ish: noise burst into a delay with feedback), plus a shared
convolution-free reverb approximated by two feedback delays.

Scheduling: a 25 ms look-ahead scheduler on a 100 ms interval, standard practice. All
tempo values divide evenly into the 120 s loop so the music does not fight the visuals.

| Style | BPM | Scale | Character |
|---|---|---|---|
| Midnight | 62 | Dorian | sparse, wide reverb, soft |
| Cyberpunk | 128 | minor pentatonic | driving, arp 1/16, saturated |
| Japan | 78 | Hirajoshi | plucked, pentatonic, gentle |

Day/night/weather modulate a master **lowpass + reverb mix**, not the notes.

### 3.2 Train sound — synthesised

Better than a sample for this, because it can be **locked to the wheel phase**. The running
gear turns at 3.2 phase-steps/second, so the chuff rate is derived from the same number the
renderer uses. Implementation: filtered noise burst (the chuff) + a continuous low rumble
(sawtooth through a lowpass, ~55 Hz) + a rail-joint click every N beats.

### 3.3 Ambient — Pixabay, bundled

`tools/fetch_audio.py` fetches 13 clips, trims to an exact length, edge-fades, mono-64k MP3.
Assets are **base64-inlined** into the HTML at build time by `tools/build_single.py`, so the
shipped file is genuinely self-contained (no network at runtime, works from `file://`).

Mapping: rain/rain-heavy/thunder follow weather; birds (day) / crickets (night) follow
time-of-day; waves/stream/fire/city/crowd/clock/wind/snow follow the style and season.

**Every layer is optional.** If an asset is missing the bus simply stays silent — the piece
must never break because an audio file failed to download.

---

## 4. UI (per `DESIGN.md`)

One frosted panel, collapsed to a single button by default, bottom-left. Six components,
no more: panel, segmented control, toggle row, slider, menu button, mute button.

- **Theme section** — Style (3), Time (2), Weather (4), Season (4) segmented rows.
- **Audio section** — one slider per bus: Master, Music, Rain, Ambience, Train. Plus mute.
- `aria-live` region announces every change.
- Keyboard: `Tab` order = visual order, `Escape` closes and restores focus, focus trapped
  while open, visible focus ring everywhere, 36px+ targets.
- `prefers-reduced-motion` disables all UI motion.
- Audio starts muted and only initialises on the first real user gesture (autoplay policy).

---

## 5. Loop integrity under theming

Adding a theme must not weaken the loop proof. Rules:

1. Every particle system (rain, snow, leaves, blossom, splash) is parameterised by
   **age**, taken `mod 120`, exactly like the smoke. No spawn arrays.
2. Every theme-driven oscillation uses `sin(2*pi*k*t/120)` with integer `k`.
3. The theme is a **constant during a loop** — the UI cannot change theme mid-loop without
   an explicit "re-baseline" that re-snapshots. So `render(t, theme)` is a pure function of
   `(t mod 120, theme)`.
4. `verify.js` gains: for **every one of the 24 themes x 4 seasons**, assert
   `hash(render(0)) === hash(render(120))` and full pixel coverage. 96 loop proofs.

---

## 6. Verification plan

| Check | Method |
|---|---|
| Loop, all themes | `render(0)` vs `render(120)` hash equality, 96 combos |
| Coverage | zero true-black pixels in every theme |
| No spring snow | assert `snowAssetCount === 0` when season is spring |
| Winter has snow | assert `snowAssetCount > 0` when season is winter |
| Day has no stars | star pixel count is 0 in day mode |
| UI opens / closes | headless CDP click, assert panel visibility + `aria-expanded` |
| Sliders change gain | set value, assert `GainNode.gain.value` changed |
| Theme buttons work | click, assert scene hash changed AND the right asset flags flipped |
| Mute works | assert master gain is 0 |
| Keyboard | Escape closes, focus returns to trigger |
| Reduced motion | emulate, assert computed transition duration is ~0 |
| Responsive | 320/390/768/1440/2560, assert no overflow and panel never covers the train |
| Console | zero errors in headless Chrome |
| Audio files | every inlined asset decodes to a valid `AudioBuffer` |
| Perf | still under 16.6 ms/frame with a theme applied |

---

## 7. Build & release

```
index.html          built, single file, audio inlined
src/index.html      source (audio referenced by manifest, not inlined)
tools/fetch_audio.py
tools/build_single.py
verify.js           extended to 96 theme loop proofs + UI tests
harness.js
DESIGN.md, plan.md, README.md, CHANGELOG.md, LICENSE
```

Release: `v2.0.0` (feature release — UI, audio, theming), then `v2.0.1` if verification
finds anything to fix. README stays compact and instructional with the pitch on top; all
depth goes to `CHANGELOG.md`. Per the repo README rules: every feature change gets a README
update and a release in the same pass.
