#!/usr/bin/env python
"""Fetch the ambient/rain/train audio bed for MIDNIGHT MERIDIAN.

WHY NOT PIXABAY
---------------
The Pixabay key on this machine (also used by the Crayon Lore and Consciousness
Protocol pipelines) is **image-scoped**: every query returns photos and SVGs and
never an audio hit, even for pure sound-effect queries like "dog barking". A wrong
key returns ``[ERROR 400] Invalid API key``, so the key is valid -- it simply has
no audio entitlement. Pixabay's own sound-effects pages also return 403 to scripted
requests. Rather than block on credentials, this uses:

**Openverse** (``api.openverse.org``) -- a public, no-key, CC-licensed audio index that
proxies Freesound previews and Wikimedia Commons. Verified working: it returns direct
``url`` fields pointing at ``cdn.freesound.org`` MP3s.

Outputs mono 64k MP3s, edge-faded, in ``audio/``, plus ``audio/manifest.json`` with
per-asset licence and attribution so the README can credit properly.

Set ``AUDIO_SOURCE=pixabay`` to retry Pixabay once an audio-capable key is in
``PIXABAY_API_KEY``; the download/trim/credit path is identical either way.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "audio_cache"
OUT = ROOT / "audio"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

# slug, query, seconds
WANTED = [
    ("rain",        "rain loop ambience",      30),
    ("rain-heavy",  "heavy rain storm",        30),
    ("thunder",     "thunder rumble",          18),
    ("wind",        "wind howling",            30),
    ("birds",       "birds singing morning",   26),
    ("crickets",    "crickets chirping night", 26),
    ("waves",       "ocean waves sea",         30),
    ("fire",        "fire crackling",          24),
    ("snow",        "snow falling cold wind",  30),
    ("stream",      "stream water flowing",    30),
    ("city",        "city traffic night",      30),
    ("crowd",       "crowd people murmur",     24),
    ("clock",       "clock ticking",           24),
]


def _get(url: str, timeout: int, dest: Path | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    if dest is not None:
        dest.write_bytes(data)
    return data


def openverse(q: str, page_size: int = 20) -> list[dict]:
    url = ("https://api.openverse.org/v1/audio/?q=" + urllib.parse.quote(q)
           + f"&page_size={page_size}")
    try:
        data = json.loads(_get(url, 30).decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"    openverse failed: {e}", file=sys.stderr)
        return []
    return [h for h in data.get("results", []) if h.get("url")]


def pixabay(q: str, per_page: int = 20) -> list[dict]:
    key = os.environ.get("PIXABAY_API_KEY", "")
    if not key:
        return []
    url = ("https://pixabay.com/api/?key=" + urllib.parse.quote(key)
           + "&q=" + urllib.parse.quote(q) + "&safesearch=true"
           + f"&per_page={per_page}")
    try:
        data = json.loads(_get(url, 30).decode("utf-8"))
    except Exception:
        return []
    return [h for h in data.get("hits", []) if h.get("type") == "audio" and h.get("vgaURL")]


def process(src: Path, dst: Path, seconds: int) -> bool:
    if dst.exists() and dst.stat().st_size > 1000:
        return True
    fade = min(1.2, seconds * 0.08)
    af = (f"atrim=0:{seconds},asetpts=PTS-STARTPTS,"
          f"afade=t=in:st=0:d={fade:.2f},"
          f"afade=t=out:st={seconds - fade:.2f}:d={fade:.2f},"
          f"aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=mono,"
          f"loudnorm=I=-18:TP=-2:LRA=11")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", af,
           "-c:a", "libmp3lame", "-b:a", "64k", str(dst)]
    try:
        subprocess.run(cmd, check=True, timeout=180)
        return dst.exists() and dst.stat().st_size > 500
    except Exception as e:  # noqa: BLE001
        print(f"    ffmpeg failed: {e}", file=sys.stderr)
        return False


def main() -> None:
    source = os.environ.get("AUDIO_SOURCE", "openverse").lower()
    provider = pixabay if source == "pixabay" else openverse
    if source == "pixabay":
        print("source: Pixabay (needs an audio-capable PIXABAY_API_KEY)")
    else:
        print("source: Openverse / Freesound (no key required, CC-licensed)")

    manifest: dict[str, dict] = {}
    for slug, query, seconds in WANTED:
        target = OUT / f"{slug}.mp3"
        print(f"[{slug}] {query}")
        if target.exists():
            print(f"    cached {target.name} ({target.stat().st_size//1024} KB)")
            manifest[slug] = {"file": target.name, "bytes": target.stat().st_size}
            continue
        hits = provider(query)
        if not hits:
            print("    no hits")
            continue
        done = False
        for h in hits[:6]:
            url = h.get("url")
            if not url:
                continue
            rid = str(h.get("id", "x")).replace("/", "_")[:40]
            cached = CACHE / f"{slug}-{rid}.mp3"
            if not cached.exists():
                try:
                    _get(url, 90, cached)
                except Exception as e:  # noqa: BLE001
                    print(f"    dl fail: {e}", file=sys.stderr)
                    continue
                if cached.stat().st_size < 1000:
                    continue
            if process(cached, target, seconds):
                kb = target.stat().st_size // 1024
                print(f"    OK {target.name} ({kb} KB)  {str(h.get('title',''))[:40]}")
                manifest[slug] = {
                    "file": target.name,
                    "bytes": target.stat().st_size,
                    "title": h.get("title", ""),
                    "creator": h.get("creator", ""),
                    "license": f"{h.get('license','')} {h.get('license_version','')}".strip(),
                    "source": h.get("foreign_landing_url", h.get("pageURL", "")),
                }
                done = True
                break
        if not done:
            print("    FAILED")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    total = sum(v["bytes"] for v in manifest.values())
    print(f"\n{len(manifest)}/{len(WANTED)} assets, {total/1024:.0f} KB total")
    missing = [s[0] for s in WANTED if s[0] not in manifest]
    if missing:
        print("  MISSING: " + ", ".join(missing))
    print("\nCREDITS")
    for slug, v in sorted(manifest.items()):
        print(f"  {slug:10s} {str(v.get('creator','?'))[:20]:20s} {v.get('license','?'):12s} {str(v.get('title',''))[:40]}")


if __name__ == "__main__":
    main()
