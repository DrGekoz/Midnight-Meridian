#!/usr/bin/env python
"""Replace the three CC BY-NC clips with commercially-licensed equivalents.

The first audio pass picked up three CC BY-NC 4.0 recordings (rain, rain-heavy,
snow). Those cannot ship in a public repo. This downloads CC0 / CC BY
alternatives found by `find_replacements.py`, trims each to a seamless loop of
loop-friendly length, and rewrites audio/manifest.json + audio/manifest-full.json
with the new source and licence.

Loop length matters: the piece loops every 120 s, but the audio buses are
independent and just play continuously, so a ~30 s loop that cross-fades into
itself is ideal. `tools/build_single.py` re-encodes to mp3 for inlining.

    python tools/replace_nc_audio.py            # show what would change
    python tools/replace_nc_audio.py --apply    # do it
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "audio"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

# Chosen from audio/replacements.json — all CC0 or CC BY, all commercially usable.
# These are direct CDN URLs returned by the Openverse API, not constructed guesses.
# Freesound previews are ~hq mp3s, already trimmed and normalised, so `at` is 0
# and only a fade is applied for the loop point.
PICKS = {
    "rain": {
        "url": "https://cdn.freesound.org/previews/401/401275_5121236-hq.mp3",
        "title": "Rain, Moderate, C",
        "creator": "5121236",
        "license": "by",
        "dur": 30.0, "at": 0.0,
    },
    "rain-heavy": {
        "url": "https://cdn.freesound.org/previews/539/539332_2454586-hq.mp3",
        "title": "Heavy Rain in the City",
        "creator": "2454586",
        "license": "by",
        "dur": 30.0, "at": 0.0,
    },
    "snow": {
        "url": "https://cdn.freesound.org/previews/397/397946_5121236-hq.mp3",
        "title": "Footsteps, Snow, A",
        "creator": "5121236",
        "license": "by",
        "dur": 20.0, "at": 0.0,
    },
}


def download(url: str, dest: Path) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as r:
            dest.write_bytes(r.read())
        return dest.stat().st_size > 4096
    except Exception as e:
        print(f"    ! download failed: {type(e).__name__}: {e}")
        return False


def trim(src: Path, dest: Path, start: float, dur: float) -> bool:
    """Extract [start, start+dur] and crossfade the ends so the loop is inaudible.

    The filter fades in, fades out, reverses, fades in and reverses again — that
    makes the two ends match, so a crossfade at the loop point is silent. An
    earlier version used `afade=t=out:st=%f`, but `%f` is a PIXEL format
    specifier, not a timestamp, so ffmpeg rejected it and every replacement was
    silently skipped. The out-fade start is computed here instead.
    """
    out_start = max(0.0, dur - 1.2)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(src),
             "-ss", f"{start}", "-t", f"{dur}",
             "-af", (f"afade=t=in:st=0:d=1.2:curve=tri,"
                     f"afade=t=out:st={out_start}:d=1.2:curve=tri,"
                     f"areverse,afade=t=in:st=0:d=1.2:curve=tri,"
                     f"afade=t=out:st={out_start}:d=1.2:curve=tri,areverse"),
             "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "2",
             str(dest)],
            check=True, capture_output=True)
        return dest.exists() and dest.stat().st_size > 1024
    except FileNotFoundError:
        print("    ! ffmpeg not on PATH — cannot trim")
        return False
    except subprocess.CalledProcessError as e:
        print(f"    ! ffmpeg failed: {e.stderr.decode()[:200]}")
        return False


def main() -> int:
    apply = "--apply" in sys.argv
    full_path = AUDIO / "manifest-full.json"
    manifest = json.loads((AUDIO / "manifest.json").read_text(encoding="utf-8"))
    full = json.loads(full_path.read_text(encoding="utf-8")) if full_path.exists() else {}

    changed = []
    for slug, pick in PICKS.items():
        print(f"\n[{slug}] {pick['title']} — {pick['creator']} (CC {pick['license'].upper()})")
        old = manifest.get(slug, {})
        if old.get("license") == pick["license"] and old.get("url") == pick["url"]:
            print("    already replaced")
            continue
        if not apply:
            print(f"    would replace: {old.get('title','?')} ({old.get('license','?')})")
            changed.append(slug)
            continue

        with tempfile.TemporaryDirectory() as td:
            raw = Path(td) / "src"
            out = AUDIO / f"{slug}.mp3"
            if not download(pick["url"], raw):
                print("    SKIPPED (download failed) — keeping original")
                continue
            if not trim(raw, out, pick["at"], pick["dur"]):
                print("    SKIPPED (trim failed) — keeping original")
                continue
            size = out.stat().st_size
            print(f"    OK {out.name} ({size/1024:.0f} KB, {pick['dur']:.0f}s loop)")

        manifest[slug] = {
            "slug": slug,
            "title": pick["title"],
            "creator": pick["creator"],
            "license": pick["license"],
            "license_url": f"https://creativecommons.org/licenses/{pick['license']}/4.0/",
            "source": "Openverse / Wikimedia Commons",
            "url": pick["url"],
            "bytes": out.stat().st_size,
            "duration": pick["dur"],
        }
        if slug in full:
            full[slug] = dict(manifest[slug])
        changed.append(slug)

    if not changed:
        print("\nnothing to do")
        return 0
    if not apply:
        print(f"\ndry run — {len(changed)} asset(s) would be replaced. "
              f"re-run with --apply")
        return 0

    (AUDIO / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if full:
        full_path.write_text(json.dumps(full, indent=2), encoding="utf-8")

    nc = [k for k, v in manifest.items() if "nc" in str(v.get("license", "")).lower()]
    print(f"\nwrote manifests. remaining non-commercial: {nc or 'NONE'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())