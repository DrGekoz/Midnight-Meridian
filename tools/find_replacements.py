#!/usr/bin/env python
"""Find commercially-licensed replacements for the CC BY-NC assets.

The first pass through `fetch_audio.py` picked up three CC BY-NC 4.0 clips
(rain, rain-heavy, snow). Those cannot ship in a public repo that anyone might
use commercially, so this searches Openverse for CC0 / CC BY / CC BY-SA
equivalents of the same sounds and reports what it finds.

Writes `audio/replacements.json` — nothing is downloaded automatically, because
picking the right take is an editorial judgement, not a mechanical one.

    python tools/find_replacements.py            # search and report
    python tools/find_replacements.py rain       # one term
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.openverse.org/v1/audio/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

# Licences that permit commercial reuse. CC BY requires attribution (we give it);
# CC0 and PDM require nothing.
COMMERCIAL_OK = {"cc0", "pdm", "by", "by-sa"}

TERMS = {
    "rain":        ["rain", "rainfall", "rain on roof", "downpour"],
    "rain-heavy":  ["heavy rain", "rainstorm", "thunderstorm rain", "monsoon"],
    "snow":        ["snow", "snowfall", "winter wind", "blizzard"],
}

OUT = Path(__file__).resolve().parent.parent / "audio" / "replacements.json"


def get(url: str, timeout: int = 30) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def licence_ok(l: str | None) -> bool:
    if not l:
        return False
    return l.strip().lower() in COMMERCIAL_OK


def search(term: str, pages: int = 2) -> list[dict]:
    hits: list[dict] = []
    for page in range(1, pages + 1):
        q = urllib.parse.urlencode({
            "q": term, "page": page, "page_size": 20,
            "license_type": "all-cc,commercial",
        })
        try:
            data = get(f"{API}?{q}")
        except Exception as e:                       # network hiccup: stop this term
            print(f"    ! {type(e).__name__}: {e}")
            break
        results = data.get("results") or []
        if not results:
            break
        for r in results:
            if not licence_ok(r.get("license")):
                continue
            url = r.get("url")
            if not url:
                continue
            hits.append({
                "title": (r.get("title") or "").strip()[:70],
                "creator": (r.get("creator") or "unknown"),
                "license": f"CC {(r.get('license') or '').upper()}",
                "license_url": r.get("license_url") or "",
                "duration_s": r.get("duration") or None,
                "source": r.get("source") or "",
                "foreign_landing_url": r.get("foreign_landing_url") or "",
                "url": url,
            })
        time.sleep(0.4)                            # be polite to a free API
    return hits


def main() -> int:
    only = sys.argv[1].lower() if len(sys.argv) > 1 else None
    result: dict[str, list[dict]] = {}

    for slug, terms in TERMS.items():
        if only and slug != only:
            continue
        print(f"\n[{slug}]")
        found: list[dict] = []
        seen: set[str] = set()
        for term in terms:
            for hit in search(term):
                if hit["url"] in seen:
                    continue
                seen.add(hit["url"])
                found.append(hit)
            if len(found) >= 12:
                break
        result[slug] = found
        if not found:
            print("    no commercially-licensed candidates found")
            continue
        for h in found[:8]:
            dur = f"{h['duration_s']:.0f}s" if h["duration_s"] else "?s"
            print(f"    {h['license']:<9} {dur:>6}  {h['title'][:46]:<46} {h['creator'][:18]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    total = sum(len(v) for v in result.values())
    print(f"\nwrote {OUT}  ({total} candidates)")
    print("Review these and, if any suit, re-run fetch_audio.py with the chosen "
          "URL pinned.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())