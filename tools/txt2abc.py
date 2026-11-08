#!/usr/bin/env python3
"""Render a Songline .txt song as ABC notation, to proof-read a transcription
against the printed score.

usage: txt2abc.py song.txt [PASS] [FIRST-LAST]
  PASS        which repeat pass to render (default 1)
  FIRST-LAST  bar range (default: all bars)

View the output with any ABC tool, e.g. paste it into https://abcjs.net/abcjs-editor.html,
or render an SVG with verovio:  pip install verovio  then
  python3 -c "import sys,verovio; t=verovio.toolkit(); t.loadData(sys.stdin.read()); print(t.renderToSVG(1))" < song.abc > song.svg
Everything is written in C with explicit accidentals, so it works for any key.
"""
import os
import re
import sys
from fractions import Fraction

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from txt2song import SongError, parse  # noqa: E402


def abc_pitch(p):
    m = re.match(r"([A-G])(#|b)?(-?\d)$", p)
    if not m:
        raise SongError(f"bad pitch {p!r}")
    letter, acc, octv = m.group(1), m.group(2), int(m.group(3))
    s = {"#": "^", "b": "_", None: ""}[acc]
    if octv >= 5:
        return s + letter.lower() + "'" * (octv - 5)
    return s + letter + "," * (4 - octv)


def to_abc(path, p=1, first=None, last=None):
    head, bars = parse(path)
    first, last = first or 1, last or len(bars)
    out = ["X:1", f"T:{head.get('title', '')} (pass {p})", f"M:{head.get('time', '4/4')}", "L:1/16", "K:C"]
    trip = 0                              # notes left in the current (3 group
    music, words = [], []
    for b in bars[first - 1:last]:
        seg = [f"[M:{b['ts']}]"] if b["ts"] else []
        for tok in b["tokens"]:
            if "@" in tok:
                only, tok = tok.split("@", 1)
                if int(only) != p:
                    continue
            parts = tok.split(":", 2)
            d = Fraction(parts[1])
            if d.denominator == 3:            # triplet member: written length is 3/2 of the sounding one
                if trip == 0:
                    seg.append("(3")
                    trip = 3
                trip -= 1
                d = d * Fraction(3, 2)
            n16 = round(float(d) * 4)
            if parts[0] == "r":
                seg.append(f"z{n16}")
                continue
            tie = "-" if parts[0].endswith("~") else ""
            seg.append(f"{abc_pitch(parts[0].rstrip('~'))}{n16}{tie}")
            lyr = parts[2] if len(parts) > 2 else "_"
            if "/" in lyr:
                alts = lyr.split("/")
                lyr = alts[p - 1] if p <= len(alts) else alts[-1]
            lyr = lyr.replace(" ", "~")
            words.append(lyr if lyr.endswith("-") or lyr == "_" else lyr + " ")
        music.append(" ".join(seg).replace("(3 ", "(3") + f" | %{b['n']}")
    for i in range(0, len(music), 4):
        out += music[i:i + 4]
    out.append("w: " + " ".join(w.strip() if w.endswith("-") else w for w in words))
    return "\n".join(out)


def main(argv):
    if not 2 <= len(argv) <= 4:
        raise SystemExit(__doc__.strip().split("\n\n")[1])
    p = int(argv[2]) if len(argv) > 2 else 1
    first = last = None
    if len(argv) > 3:
        first, last = map(int, argv[3].split("-"))
    try:
        print(to_abc(argv[1], p, first, last))
    except (SongError, OSError) as e:
        raise SystemExit(f"error: {e}")


if __name__ == "__main__":
    main(sys.argv)
