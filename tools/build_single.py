#!/usr/bin/env python
"""Bundle MIDNIGHT MERIDIAN into ONE self-contained index.html.

Concatenates the source modules in dependency order, base64-inlines the Pixabay
ambient/rain audio from ``audio/`` (when present), and inlines the CSS and
template. The result opens from ``file://`` with no network access at all.

Why inline the audio rather than ship an ``audio/`` folder: the piece is meant to
be a single file you can double-click, email, or drop on a USB stick. A folder of
MP3s next to it would quietly break the one property that makes it nice.

If audio assets are missing the build still succeeds — the piece just starts
silent on the affected buses, which is a graceful degradation, not a failure.
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
AUDIO = ROOT / "audio"
OUT = ROOT / "index.html"

# order matters: themes defines packHex/PALETTES which weather.js uses at parse
# time, and audio.js/ui.js/weather.js all reference LOOP_SECONDS from the core.
MODULES = ["core.js", "themes.js", "weather.js", "music-theory.js",
           "audio.js", "ui.js", "main.js"]


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def collect_audio() -> tuple[str, dict]:
    """Return (JS snippet assigning AUDIO_B64, manifest dict)."""
    mf_path = AUDIO / "manifest.json"
    manifest = json.loads(mf_path.read_text(encoding="utf-8")) if mf_path.exists() else {}
    payload: dict[str, str] = {}
    for slug, meta in manifest.items():
        f = AUDIO / meta.get("file", f"{slug}.mp3")
        if f.exists() and f.stat().st_size > 500:
            payload[slug] = base64.b64encode(f.read_bytes()).decode("ascii")
    js = "const AUDIO_MANIFEST = " + json.dumps(
        {k: {kk: vv for kk, vv in v.items() if kk != "b64"} for k, v in manifest.items()},
        indent=1) + ";\n"
    js += "const AUDIO_B64 = " + json.dumps(payload, indent=1) + ";\n"
    return js, manifest


def main() -> None:
    print("MIDNIGHT MERIDIAN — single-file build\n" + "=" * 52)
    parts = []
    total_src = 0
    for name in MODULES:
        p = SRC / name
        if not p.exists():
            print(f"  [skip] {name} (not present)")
            continue
        s = read(p)
        total_src += len(s)
        parts.append(f"/* ===================== {name} ===================== */\n{s}")
        print(f"  [src ] {name:12s} {len(s):>7,} bytes")

    audio_js, manifest = collect_audio()
    # The audio payload is NOT part of `parts`; it is emitted once, first, because
    # core.js and themes.js both build top-level bindings during parse and
    # main.js's boot() reads AUDIO_B64. Appending it later would be a temporal
    # dead-zone ReferenceError at boot, and including it in `parts` as well
    # would declare the same const twice.
    n_audio = len(json.loads(audio_js.split("const AUDIO_B64 = ", 1)[1].rstrip().rstrip(";")))
    print(f"  [aud ] {n_audio} assets inlined, "
          f"{sum(v['bytes'] for v in manifest.values())/1024:.0f} KB of audio")

    template = read(SRC / "shell.html")
    css = read(SRC / "panel.css")
    body = "\n\n".join(parts)

    # The audio payload is emitted FIRST, before any module. core.js and
    # themes.js both build top-level bindings during parse, and main.js's boot()
    # reads AUDIO_B64 — so declaring it later would be a temporal-dead-zone
    # ReferenceError at boot. Emitting it first removes that entirely.
    html = template.replace("/*__CSS__*/", css).replace("/*__JS__*/", "@@PAYLOAD@@\n" + body)
    html = html.replace("@@PAYLOAD@@", audio_js, 1)
    OUT.write_text(html, encoding="utf-8")
    size = OUT.stat().st_size
    print("=" * 52)
    print(f"  source JS   : {total_src:,} bytes")
    print(f"  index.html  : {size:,} bytes ({size/1024/1024:.2f} MB)")
    # sanity: no leftover placeholders
    for tok in ("/*__CSS__*/", "/*__JS__*/"):
        if tok in html:
            raise SystemExit(f"FAIL: placeholder {tok} was not replaced")
    print("  placeholders: all replaced")
    print(f"  -> {OUT}")


if __name__ == "__main__":
    main()
