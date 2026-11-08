# The song format

Songline songs are plain text files (`.txt`) that describe the vocal line: one
line per bar, one token per note, with the lyric syllable attached to each note.
`tools/serve.py` converts them automatically, and `tools/txt2song.py` turns one
into the `.json` file the app loads.

The bundled songs in [`songs/`](../songs) are complete examples.
`twinkle_twinkle.txt` is the simplest one.

- [A complete small example](#a-complete-small-example)
- [Header](#header)
- [Bars](#bars)
- [Notes, rests and lengths](#notes-rests-and-lengths)
- [Lyrics](#lyrics)
- [Chords](#chords)
- [Repeats, endings and verses](#repeats-endings-and-verses)
- [Transcribing from sheet music, step by step](#transcribing-from-sheet-music-step-by-step)
- [Proof-reading](#proof-reading)
- [Song JSON (for tool authors)](#song-json-for-tool-authors)

## A complete small example

```text
# Lines starting with # are comments.
title: Amazing Grace
artist: Traditional
key: G
tempo: 84
time: 3/4

1  G   | r:2 D4:1:A-                   # pickup: two beats of rest, then "A-"
2  G   | G4:2:maz- B4:.5:ing G4:.5:_    # "ing" is sung over two notes
3  G   | B4:2:grace A4:1:how
4  C   | G4:2:sweet E4:1:the
5  G   | D4:2:sound D4:1:that
6  G   | G4:2:saved B4:.5:a G4:.5:_
7  G   | B4:2:wretch A4:1:like
8  D   | D5~:3:me                       # tied into the next bar...
9  D   | D5:2:_ B4:1:I                   # ...and held for 2 more beats
```

## Header

The header is a set of `name: value` lines at the top of the file. All of them
are optional, but `title` and `key` are strongly recommended.

| Name | Example | Meaning |
|---|---|---|
| `title` | `title: Amazing Grace` | Shown in the app and the song list. Songs with the same title are treated as the same song. |
| `artist` | `artist: Traditional` | Shown next to the title. |
| `key` | `key: G`, `key: Bb`, `key: F#m` | The key of the song. Use `m` for minor. It sets the key signature on the staff and the note spelling (B♭ vs A♯). It doesn't change any pitches. |
| `tempo` | `tempo: 84` | Quarter notes per minute (default 90). The app's **Tempo** slider scales it. |
| `time` | `time: 3/4` | The starting time signature (default `4/4`). |
| `repeat` | `repeat: 1-16 x2` | Play bars 1–16 twice. See [Repeats](#repeats-endings-and-verses). |
| `only` | `only: 16@1, 17@2` | Bar 16 only on the 1st pass, bar 17 only on the 2nd (1st/2nd endings). |

## Bars

```text
<bar number> [time signature] [chords...] | <notes...>
```

- Bars are numbered **1, 2, 3, …** in order with no gaps. Number them as they
  appear on the page. Repeats are written once and unrolled by `repeat:` (below).
- A **time signature** before the chords changes it from that bar on:
  `12 2/4 C | ...`. It stays in effect until the next change.
- **The notes must add up to exactly one bar.** A 3/4 bar holds 3 beats, 6/8
  holds 3 (six eighths), and so on. If a bar is too long or too short, the
  converter stops and tells you which bar and by how much. This check catches
  most transcription mistakes.
- A **pickup** (anacrusis) can be written as a full bar that starts with a rest
  (`1 | r:2 D4:1:A-`), or as its own short bar (`1 1/4 | D4:1:A-` followed by
  `2 3/4 G | ...`).

## Notes, rests and lengths

```text
PITCH:BEATS[:LYRIC]        e.g.  G4:2:sweet   Bb3:1.5:love   F#4:1/3:the
r:BEATS                    e.g.  r:1   r:.5
```

**Pitch** is in scientific pitch notation: a letter, an optional `#` or `b`,
then the octave number. `C4` is middle C, `A4` is the A above it (440 Hz), and
`C5` is an octave above middle C.

- The key signature is **not** applied for you. In F major, write every B♭ as
  `Bb4`. This makes each note unambiguous on its own line.
- For songs printed in the treble clef but sung by men, which usually sound an
  octave lower than written, transcribe the pitches **as printed** and use
  **Key shift −12** in the app. **Fit** finds the best shift anyway.

**Beats** count in quarter notes, whatever the time signature:

| Note | Beats | | Note | Beats |
|---|---|---|---|---|
| whole | `4` | | dotted half | `3` |
| half | `2` | | dotted quarter | `1.5` |
| quarter | `1` | | dotted eighth | `.75` |
| eighth | `.5` | | eighth-note triplet (each) | `1/3` |
| sixteenth | `.25` | | quarter-note triplet (each) | `2/3` |

Fractions like `1/3` and `2/3` keep triplets exact, so three of them fill
exactly one or two beats.

**Ties:** put `~` after the pitch of the first note. The next note must have the
same pitch and the lyric `_`. The two are played as one note, and ties can
cross bar lines:

```text
8  D | D5~:3:me
9  D | D5:2:_ B4:1:I
```

## Lyrics

The third part of a note token is the syllable sung on that note.

| Write | Meaning |
|---|---|
| `G4:1:sweet` | The word "sweet". |
| `G4:2:maz-` | A syllable that continues: the next syllable joins it ("A-maz-ing"). |
| `G4:.5:_` | A melisma: the previous syllable keeps going over this note. |
| `G4:1` | No lyric (e.g. an instrumental note in the melody). |
| `G4:1:love,` | Punctuation is kept and shown. |

- Write one syllable per note, as printed under the staff.
- **Karaoke lines break by themselves** at rests, long notes, and the ends of
  sentences. Keeping the printed punctuation (commas, full stops) gives the best
  line breaks.
- A lyric can't contain spaces, `/` or `@`, because those have special meanings
  in a token. For a word with an apostrophe or other characters, just write it:
  `who's`, `don't`, `Oo`.

## Chords

Chord names go between the bar number (or time signature) and the `|`. They're
spread evenly across the bar: one chord fills the bar, and two chords take half
each.

```text
5  C       | ...      # C for the whole bar
6  F C     | ...      # F, then C halfway through
7  C C C G | ...      # in 4/4: C for three beats, G on beat 4
```

Supported chord types: major (`C`), minor (`Cm`), `dim`, `aug` / `+`, `sus2`,
`sus4`, `7`, `m7`, `maj7`, `dim7`, and slash chords (`F/C` plays C in the bass).
Other extensions such as `6`, `9` or `add9` play as the basic triad. The chord
name is still displayed as written. Chords are optional. A bar with none simply
has no accompaniment.

## Repeats, endings and verses

Write a repeated section **once** and unroll it with `repeat:`. Each time through
is a *pass* (1, 2, …).

```text
repeat: 1-17 x2       # bars 1–17 twice, then carry on from bar 18
only: 16@1, 17@2      # 1st ending (bar 16) on pass 1, 2nd ending (bar 17) on pass 2
```

**Different words on each pass:** separate them with `/` in the lyric:

```text
3  G | B4:2:grace/thou A4:1:how/art      # verse 1 / verse 2
```

If there are fewer alternatives than passes, the last one is reused.

**Notes that only sound on one pass** (for example a pickup that's only there
the second time): prefix the token with `PASS@`.

```text
4  C | 1@G4:1:the 2@r:1 C5:3:end       # pass 1: "the end"; pass 2: a rest, then "end"
```

Only one `repeat:` range is supported. For a D.S., a coda, or several separate
repeats, write the bars out in the order they're sung. It's more typing, but it
always works.

## Transcribing from sheet music, step by step

1. **Set up the header** from the top of the score: title, composer or artist,
   key signature (`key:`), time signature (`time:`) and tempo. If the score only
   says something like "Moderately", pick a speed you like; the app's slider
   adjusts it anyway.
2. **Number the bars** on your copy of the sheet music, counting a pickup as bar 1
   if you write it as a bar. Count each repeated section only once.
3. **Write one line per bar**, using the vocal line only (not the piano part).
   Copy the chord symbols printed above the staff. Write each note's pitch,
   length and syllable. Remember to write accidentals from the key signature
   explicitly (`Bb4`, `F#4`).
4. **Run the converter** after every few bars (`python3 tools/txt2song.py my-songs/song.txt`).
   It will catch any bar that doesn't add up.
5. **Add `repeat:` and `only:`** for repeat signs and 1st/2nd endings, and `a/b`
   lyrics for second verses printed under the first.
6. **Open it in the app** and play it through slowly, following along on the
   printed score.

## Proof-reading

`tools/txt2abc.py` prints your song in [ABC notation](https://abcnotation.com/),
a text format for sheet music that many free tools can display:

```sh
python3 tools/txt2abc.py my-songs/song.txt          # pass 1, all bars
python3 tools/txt2abc.py my-songs/song.txt 2 9-16   # pass 2, bars 9–16
```

Paste the output into an online ABC editor such as
<https://abcjs.net/abcjs-editor.html> to see it as notation with the lyrics
underneath, then compare it bar by bar with the original. The rendering is
written in C with explicit accidentals, so it works for any key. It's also
easy to check by ear: play the song in Songline with the chords turned up.

## Song JSON (for tool authors)

The app loads `sing-app/1` JSON. Converters from other formats (MusicXML, MIDI
and so on) can produce it directly. `tools/txt2song.py` is the reference
implementation. Times are in quarter-note beats from the start of the song,
with repeats already unrolled.

```json
{
  "format": "sing-app/1",
  "title": "Amazing Grace",
  "artist": "Traditional",
  "key": "G",
  "tempo": 84,
  "totalBeats": 48,
  "bars": [
    {"n": 1, "pass": 1, "t": 0, "beats": 3, "ts": [3, 4],
     "chords": [{"t": 0, "name": "G"}]}
  ],
  "notes": [
    {"t": 2, "dur": 1, "midi": 62, "lyric": "A", "hyphen": true,
     "melisma": false, "bar": 1, "pass": 1}
  ]
}
```

| Field | Meaning |
|---|---|
| `bars[].n`, `pass` | Bar number as written, and which pass of a repeat this is. |
| `bars[].t`, `beats`, `ts` | Start beat, length in beats, time signature `[top, bottom]`. |
| `bars[].chords[]` | Chord changes: start beat and name. |
| `notes[].t`, `dur` | Start beat and length in beats. |
| `notes[].midi` | MIDI note number (60 = middle C). |
| `notes[].lyric`, `hyphen` | The syllable, and whether the word continues on the next syllable. |
| `notes[].melisma` | `true` when the note continues the previous syllable (no new lyric). |
