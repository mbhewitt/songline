#!/usr/bin/env python3
"""Convert a song written in the Songline text format (.txt) into song JSON.

usage: txt2song.py song.txt [song.json]     (prints to stdout without an output path)

The format is documented in docs/song-format.md. In short:

  header lines  key: value   (title, artist, key, tempo, time, repeat: A-B xN,
                              only: BAR@PASS[,BAR@PASS...] — e.g. a 1st ending '29@1')
  bar lines     <n> [<ts>] [chord ...] | token token ...
    ts       e.g. 2/4 — sticky until changed (header 'time' is the initial value)
    chords   0..k names, spread evenly across the bar (two chords = halves)
    token    PITCH[~]:BEATS[:LYRIC]   or   r:BEATS
             BEATS  decimal or fraction (triplet quarter = 2/3)
             PITCH  scientific pitch (C4 = middle C); the key signature is NOT
                    implied — write Bb4 explicitly
             ~      tied into the next note (merged into one sounding note; the
                    next note's lyric must be '_')
             LYRIC  syllable; trailing '-' = word continues; '_' = hold the
                    previous syllable (melisma); 'a/b' = per repeat pass
             V@...  token only sounds on repeat pass V (1-based)
  comments      a line starting with '#', or ' #' after content

Fails loudly (SongError, with file and line) on anything it can't read, including
any bar whose durations don't fill its time signature.
"""
import json
import re
import sys
from fractions import Fraction

FORMAT = "sing-app/1"
NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PITCH_RE = re.compile(r"^([A-G])(#|b)?(-?\d)$")


class SongError(ValueError):
    """A problem in a song file; the message says where and what."""


def midi(p):
    m = PITCH_RE.match(p)
    if not m:
        raise SongError(f"bad pitch {p!r} (expected e.g. C4, F#3, Bb4)")
    acc = {"#": 1, "b": -1, None: 0}[m.group(2)]
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + acc


def parse(path):
    """Read a .txt song into (header dict, list of raw bars)."""
    head, bars = {}, []
    with open(path, encoding="utf-8") as f:
        for ln, raw in enumerate(f, 1):
            # comments: a line starting with '#', or ' #' after content ('F#' in a chord is not one)
            line = "" if raw.lstrip().startswith("#") else re.split(r"\s#", raw, maxsplit=1)[0].rstrip()
            if not line.strip():
                continue
            if "|" not in line:
                k, sep, v = line.partition(":")
                if not sep:
                    raise SongError(f"{path}:{ln}: expected 'key: value' or a bar line with '|', got {line.strip()!r}")
                head[k.strip()] = v.strip()
                continue
            left, right = line.split("|", 1)
            lf = left.split()
            if not lf or not lf[0].isdigit():
                raise SongError(f"{path}:{ln}: a bar line must start with its bar number, got {left.strip()!r}")
            n, rest = int(lf[0]), lf[1:]
            ts = rest.pop(0) if rest and re.fullmatch(r"\d+/\d+", rest[0]) else None
            bars.append({"n": n, "ts": ts, "chords": rest, "tokens": right.split(), "line": ln})
    if not bars:
        raise SongError(f"{path}: no bar lines found")
    return head, bars


def play_order(head, bars):
    """Unroll repeats into a list of (bar, pass)."""
    order = [(b, 1) for b in bars]
    if "repeat" in head:
        m = re.fullmatch(r"(\d+)-(\d+)\s*x(\d+)", head["repeat"])
        if not m:
            raise SongError(f"repeat: expected 'FIRST-LAST xN' (e.g. '1-8 x2'), got {head['repeat']!r}")
        a, z, times = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if not 1 <= a <= z <= len(bars):
            raise SongError(f"repeat: bars {a}-{z} are outside 1-{len(bars)}")
        order = ([(b, 1) for b in bars[:a - 1]]
                 + [(b, p) for p in range(1, times + 1) for b in bars[a - 1:z]]
                 + [(b, 1) for b in bars[z:]])
    if "only" in head:                   # volta endings: bar sounds only on the given pass
        only = {}
        for item in head["only"].split(","):
            m = re.fullmatch(r"\s*(\d+)@(\d+)\s*", item)
            if not m:
                raise SongError(f"only: expected 'BAR@PASS[,BAR@PASS...]', got {item.strip()!r}")
            only.setdefault(int(m.group(1)), set()).add(int(m.group(2)))
        order = [(b, p) for b, p in order if b["n"] not in only or p in only[b["n"]]]
    return order


def compile_song(path):
    """Compile a .txt song file into the song JSON dict. Raises SongError."""
    head, bars = parse(path)
    ts = head.get("time", "4/4")
    if not re.fullmatch(r"\d+/\d+", ts):
        raise SongError(f"{path}: time: expected e.g. 4/4, got {ts!r}")
    for b in bars:                       # resolve sticky time signatures
        ts = b["ts"] or ts
        b["ts"] = ts
    nums = [b["n"] for b in bars]
    if nums != list(range(1, len(bars) + 1)):
        raise SongError(f"{path}: bar numbers must run 1..N in order, got {nums}")
    try:
        tempo = float(head.get("tempo", 90))
    except ValueError:
        raise SongError(f"{path}: tempo: expected a number of beats per minute, got {head['tempo']!r}") from None

    out_bars, notes, t = [], [], 0.0
    pending_tie = None
    for b, p in play_order(head, bars):
        where = f"{path}:{b['line']} (bar {b['n']}, pass {p})"
        num, den = map(int, b["ts"].split("/"))
        length = num * 4.0 / den           # in quarter-note beats
        ch = b["chords"]
        out_bars.append({"n": b["n"], "pass": p, "t": t, "beats": length, "ts": [num, den],
                         "chords": [{"t": t + i * length / len(ch), "name": c} for i, c in enumerate(ch)]})
        pos = 0.0
        for tok in b["tokens"]:
            if "@" in tok:
                only, tok = tok.split("@", 1)
                if not only.isdigit():
                    raise SongError(f"{where}: {only}@... needs a pass number before '@'")
                if int(only) != p:
                    continue
            parts = tok.split(":", 2)
            if len(parts) < 2:
                raise SongError(f"{where}: token {tok!r} needs PITCH:BEATS[:LYRIC] or r:BEATS")
            try:
                dur = float(Fraction(parts[1]))
            except (ValueError, ZeroDivisionError):
                raise SongError(f"{where}: token {tok!r}: beats must be a number or fraction, got {parts[1]!r}") from None
            if dur <= 0:
                raise SongError(f"{where}: token {tok!r}: beats must be positive")
            if parts[0] == "r":
                if pending_tie:
                    raise SongError(f"{where}: a tie can't continue into a rest")
                pos += dur
                continue
            tie = parts[0].endswith("~")
            try:
                pitch = midi(parts[0].rstrip("~"))
            except SongError as e:
                raise SongError(f"{where}: {e}") from None
            lyr = parts[2] if len(parts) > 2 else ""
            if "/" in lyr:
                alts = lyr.split("/")
                lyr = alts[p - 1] if p <= len(alts) else alts[-1]
            if pending_tie:
                if pending_tie["midi"] != pitch or lyr != "_":
                    raise SongError(f"{where}: a tie must continue the same pitch with lyric '_'")
                pending_tie["dur"] += dur
                note = pending_tie
            else:
                note = {"t": round(t + pos, 4), "dur": dur, "midi": pitch,
                        "lyric": "" if lyr == "_" else lyr.rstrip("-"),
                        "hyphen": lyr.endswith("-"), "melisma": lyr == "_", "bar": b["n"], "pass": p}
                notes.append(note)
            pending_tie = note if tie else None
            pos += dur
        if abs(pos - length) > 1e-6:
            raise SongError(f"{where}: {pos:g} beats, but time signature {b['ts']} needs {length:g}")
        t += length
    if pending_tie:
        raise SongError(f"{path}: the song ends inside a tie")
    if not notes:
        raise SongError(f"{path}: the song has no notes")
    return {"format": FORMAT, "title": head.get("title", "Untitled"), "artist": head.get("artist", ""),
            "key": head.get("key", ""), "tempo": tempo,
            "totalBeats": t, "bars": out_bars, "notes": notes}


def summary(song):
    lo, hi = min(n["midi"] for n in song["notes"]), max(n["midi"] for n in song["notes"])
    return (f"{song['title']}: {len(song['bars'])} bars (unrolled), {len(song['notes'])} notes, "
            f"{song['totalBeats']:g} beats, range midi {lo}-{hi}")


def main(argv):
    if len(argv) not in (2, 3):
        raise SystemExit("usage: txt2song.py song.txt [song.json]")
    try:
        song = compile_song(argv[1])
    except (SongError, OSError) as e:
        raise SystemExit(f"error: {e}")
    if len(argv) == 3:
        with open(argv[2], "w", encoding="utf-8") as f:
            json.dump(song, f, indent=1)
        print(summary(song), file=sys.stderr)
    else:
        json.dump(song, sys.stdout, indent=1)
        print()


if __name__ == "__main__":
    main(sys.argv)
