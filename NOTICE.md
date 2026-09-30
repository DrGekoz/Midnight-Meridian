# NOTICE

MIDNIGHT MERIDIAN
Copyright (c) 2026 DrGekoz / Joseph Williams

This product includes software developed as part of an original work, and
references the following third-party material.

---

## 1. @simpllyf/ditty (MIT)

    https://github.com/simpllyf/ditty

The music-theory layer in `src/music-theory.js` — the scales and chord-quality
tables, the functional-harmony progression shapes, and the arrangement approach
(a seeded PRNG driving harmony → melody → motif development → song form) — was
informed by the design documented in that project by **simpllyf**, which is
licensed under the MIT License.

The following is reproduced as required by the MIT License:

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

**No code was copied from that project.** The implementation here is our own.
What was taken was the *approach* and the musical knowledge: scales, modes, chord
qualities and common progressions are traditional and uncopyrightable, and Ditty's
own documentation makes the same point — music generated from such building
blocks carries no sample or training-data encumbrance.

Note that Ditty is **not** a runtime dependency. Nothing is installed, imported or
fetched. It is credited as prior art.

---

## 2. Bjorklund's algorithm (public domain method)

The Euclidean rhythm generator in `src/music-theory.js` implements the algorithm
described in:

- **E. Bjorklund**, "The Theory of Rep-Rate Pattern Generation in the SNS Timing
  System", SNS Timing System Technical Note, ORNL (1982).
- **G. Toussaint**, "The Euclidean Algorithm Generates Traditional Musical
  Rhythms", Proceedings of BRIDGES: Mathematical Connections in Art, Music and
  Science, Banff, Alberta, 31 August – 3 September 2005, pp. 47–56.

Both papers are freely available from their authors. The algorithm itself is a
method and is not copyrightable. The implementation is the standard zip-and-
partition formulation, cross-checked against these existing open-source ports:

- **zya/bjorklund** — https://www.npmjs.com/package/bjorklund
- **dbkaplun/euclidean-rhythm** — MIT licensed
- **mkontogiannis/euclidean-rhythms** — unit-tested port

---

## 3. Recorded audio (Creative Commons)

The ambient, rain, weather and place recordings embedded in `index.html` were
sourced from **Openverse** (https://openverse.org), which aggregates
Creative-Commons-licensed media. Full per-asset attribution is reproduced in
`audio/manifest.json` and summarised below.

**These recordings are the property of their respective authors and are used under
the licences stated. CC BY assets require attribution, which is given here and
also in `audio/manifest.json`.**

**Every asset in the shipped build is CC0 or CC BY — all permit commercial use.**
An earlier pass pulled in three CC BY-NC 4.0 recordings (rain, rain-heavy, snow).
Those were replaced with CC BY equivalents via `tools/find_replacements.py` and
`tools/replace_nc_audio.py`; that tool now reports
`remaining non-commercial: NONE`.

| Asset   | Author           | Licence    | Title                                |
|---------|------------------|------------|--------------------------------------|
| birds   | The_Sound_Side   | CC BY 4.0  | Spring Morning Beirut Birds city ambiance |
| city    | Sotiris_Laskaris | CC0 1.0    | City Terrace Night 2                 |
| clock   | olver            | CC0 1.0    | Clock ticking                        |
| crickets| FreethinkerAnon  | CC0 1.0    | crickets                             |
| crowd   | EpicWizard       | CC0 1.0    | Bar Crowd in Belgrade                |
| fire    | kingsrow         | CC0 1.0    | Fire Crackling 01.wav                |
| rain    | 5121236          | CC BY 4.0  | Rain, Moderate, C                    |
| rain-heavy | 2454586       | CC BY 4.0  | Heavy Rain in the City               |
| snow    | 5121236          | CC BY 4.0  | Footsteps, Snow, A                   |
| stream  | videofueralle    | CC BY 4.0  | Small Stream Water flowing fast      |
| thunder | carroll27        | CC0 1.0    | Thunder rumbling, underwater, outdoors |
| waves   | lavatorius       | CC0 1.0    | ocean waves sea beach close stereo.wav |
| wind    | DAVESTALKER      | CC0 1.0    | Wind Howling thru window crack.mp3   |

All thirteen are commercially usable. Attribution is required for the six CC BY
items: birds (The_Sound_Side), rain (5121236), rain-heavy (2454586),
snow (5121236) and stream (videofueralle). The CC0 items carry no obligation.

---

## 4. Everything else

All code in `index.html` (renderer, theme engine, weather systems, Web Audio
synthesis, UI) and all source in `src/`, `tools/`, `verify.js` and `snap.js` is
original work. No sprite sheets, image assets, fonts or audio samples are bundled
other than the Creative-Commons recordings listed above.

No machine-learning model, GPU or network service is used at runtime. The piece
runs entirely offline in a browser.