import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_site  # noqa: E402


class BuildSite(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.out = os.path.join(self.tmp, "site")

    def test_bundled_songs_build(self):
        index = build_site.build(self.out)
        self.assertTrue(os.path.isfile(os.path.join(self.out, "index.html")))
        with open(os.path.join(self.out, "songs", "index.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), index)
        for item in index:
            with open(os.path.join(self.out, "songs", item["file"]), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["title"], item["title"])

    def test_song_without_public_domain_note_is_refused(self):
        songs = os.path.join(self.tmp, "songs")
        os.makedirs(songs)
        with open(os.path.join(songs, "mine.txt"), "w", encoding="utf-8") as f:
            f.write("# my transcription\ntitle: Mine\n1 | C4:4:la\n")
        with self.assertRaises(SystemExit) as cm:
            build_site.build(self.out, songs)
        self.assertIn("Public domain", str(cm.exception))

    def test_json_songs_are_refused(self):
        songs = os.path.join(self.tmp, "songs")
        os.makedirs(songs)
        shutil.copy(os.path.join(ROOT, "app", "demo.json"), os.path.join(songs, "x.json"))
        with self.assertRaises(SystemExit):
            build_site.build(self.out, songs)


if __name__ == "__main__":
    unittest.main()
