#!/usr/bin/env python3
"""Build a static copy of Songline (for GitHub Pages or any static https host).

usage: build_site.py OUTDIR

Copies app/ to OUTDIR and adds the bundled songs as OUTDIR/songs/*.json plus
OUTDIR/songs/index.json, so the Songs list works without serve.py.

Only the repository's songs/ folder is published, and every song in it must say
"public domain" in its header comment. A song without that note stops the build,
so a private transcription can't be published by accident.
"""
import json
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve import APP, ROOT, find_songs, load_song  # noqa: E402
from txt2song import SongError  # noqa: E402

SONGS = os.path.join(ROOT, "songs")
MARKER = ".songline-site"            # marks an output folder this script may replace


def header_comment(path):
    lines = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.lstrip().startswith("#"):
                break
            lines.append(line)
    return "".join(lines).lower()


def build(out, songs_dir=SONGS):
    if os.path.exists(out):
        if not os.path.isfile(os.path.join(out, MARKER)):
            raise SystemExit(f"error: {out} exists and isn't a previous Songline build; "
                             "pick a new or empty output folder")
        shutil.rmtree(out)
    shutil.copytree(APP, out)
    os.makedirs(os.path.join(out, "songs"))
    open(os.path.join(out, MARKER), "w").close()
    index = []
    for name, src in sorted(find_songs([songs_dir]).items()):
        if not src.endswith(".txt") or "public domain" not in header_comment(src):
            raise SystemExit(f"error: {src}: only .txt songs whose header comment says "
                             "'Public domain' can be published")
        song = load_song(src)
        with open(os.path.join(out, "songs", name), "w", encoding="utf-8") as f:
            json.dump(song, f)
        index.append({"title": song["title"], "file": name})
    with open(os.path.join(out, "songs", "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f)
    return index


def main(argv):
    if len(argv) != 2:
        raise SystemExit("usage: build_site.py OUTDIR")
    try:
        index = build(argv[1])
    except SongError as e:
        raise SystemExit(f"error: {e}")
    print(f"built {argv[1]}: " + ", ".join(i["title"] for i in index))


if __name__ == "__main__":
    main(sys.argv)
