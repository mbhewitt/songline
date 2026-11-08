import json
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from txt2song import SongError, compile_song, midi  # noqa: E402


def song_file(text):
    f = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
    f.write(text)
    f.close()
    return f.name


class Txt2Song(unittest.TestCase):
    def compile(self, text):
        path = song_file(text)
        self.addCleanup(os.unlink, path)
        return compile_song(path)

    def test_midi(self):
        self.assertEqual(midi("C4"), 60)
        self.assertEqual(midi("A4"), 69)
        self.assertEqual(midi("Bb3"), 58)
        self.assertEqual(midi("F#2"), 42)
        with self.assertRaises(SongError):
            midi("H4")

    def test_basic_song(self):
        s = self.compile("title: T\ntempo: 100\ntime: 4/4\n"
                         "1 C | C4:1:Hel- D4:1:lo E4:2:world\n"
                         "2 G | r:2 G4~:1:hold G4:1:_\n")
        self.assertEqual(s["format"], "sing-app/1")
        self.assertEqual(s["totalBeats"], 8)
        self.assertEqual([n["midi"] for n in s["notes"]], [60, 62, 64, 67])
        self.assertTrue(s["notes"][0]["hyphen"])
        self.assertEqual(s["notes"][3]["dur"], 2)          # the tie merged into one note
        self.assertEqual(s["bars"][1]["chords"], [{"t": 4.0, "name": "G"}])

    def test_melisma_and_triplets(self):
        s = self.compile("time: 2/4\n1 | C4:2/3:a D4:2/3:_ E4:2/3:b\n")
        self.assertTrue(s["notes"][1]["melisma"])
        self.assertAlmostEqual(s["totalBeats"], 2)

    def test_repeat_and_volta(self):
        s = self.compile("time: 4/4\nrepeat: 1-2 x2\nonly: 2@1\n"
                         "1 | C4:4:one/two\n2 | D4:4:first\n3 | E4:4:end\n")
        self.assertEqual([(b["n"], b["pass"]) for b in s["bars"]], [(1, 1), (2, 1), (1, 2), (3, 1)])
        self.assertEqual([n["lyric"] for n in s["notes"]], ["one", "first", "two", "end"])

    def test_pass_only_token(self):
        s = self.compile("repeat: 1-1 x2\n1 | 1@C4:4:a 2@D4:4:b\n")
        self.assertEqual([n["midi"] for n in s["notes"]], [60, 62])

    def test_sharp_chord_is_not_a_comment(self):
        s = self.compile("1 F#dim7 F/C | C4:4  # a real comment\n")
        self.assertEqual([c["name"] for c in s["bars"][0]["chords"]], ["F#dim7", "F/C"])

    def test_sticky_time_signature(self):
        s = self.compile("time: 3/4\n1 | C4:3\n2 2/4 | C4:2\n3 | C4:2\n")
        self.assertEqual([b["beats"] for b in s["bars"]], [3, 2, 2])

    def test_errors_are_specific(self):
        cases = {
            "1 | C4:3\n": "needs 4",                       # bar too short
            "1 | C4:4\n3 | C4:4\n": "bar numbers",
            "1 | X4:4\n": "bad pitch",
            "1 | C4\n": "PITCH:BEATS",
            "1 | C4~:2:a D4:2:_\n": "same pitch",
            "1 | C4~:4:a\n": "ends inside a tie",
            "repeat: oops\n1 | C4:4\n": "repeat:",
            "just words\n1 | C4:4\n": "key: value",
            "title: x\n": "no bar lines",
        }
        for text, msg in cases.items():
            with self.subTest(text=text), self.assertRaises(SongError) as cm:
                self.compile(text)
            self.assertIn(msg, str(cm.exception))


class BundledSongs(unittest.TestCase):
    def test_every_bundled_song_compiles(self):
        d = os.path.join(ROOT, "songs")
        files = [f for f in os.listdir(d) if f.endswith(".txt")]
        self.assertTrue(files)
        for f in files:
            with self.subTest(song=f):
                compile_song(os.path.join(d, f))

    def test_demo_matches_its_source(self):
        """app/demo.json is generated from songs/amazing_grace.txt (make demo)."""
        with open(os.path.join(ROOT, "app", "demo.json"), encoding="utf-8") as f:
            demo = json.load(f)
        self.assertEqual(demo, compile_song(os.path.join(ROOT, "songs", "amazing_grace.txt")),
                         "app/demo.json is stale: run `make demo`")


if __name__ == "__main__":
    unittest.main()
