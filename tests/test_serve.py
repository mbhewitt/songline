import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import serve  # noqa: E402

SONG = "title: {title}\n1 | C4:4:la\n"


class Serve(unittest.TestCase):
    def setUp(self):
        self.a, self.b = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.a)
        self.addCleanup(shutil.rmtree, self.b)
        handler = type("H", (serve.Handler,), {"song_dirs": [self.a, self.b],
                                               "log_message": lambda *a: None})
        import functools
        import http.server
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(handler, directory=serve.APP))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"

    def write(self, d, name, text):
        with open(os.path.join(d, name), "w", encoding="utf-8") as f:
            f.write(text)

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, r.read()

    def test_app_is_served(self):
        status, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>Songline</title>", body)

    def test_index_lists_txt_and_json_songs(self):
        self.write(self.a, "one.txt", SONG.format(title="One"))
        with open(os.path.join(ROOT, "app", "demo.json"), encoding="utf-8") as f:
            self.write(self.b, "two.json", f.read())
        _, body = self.get("/songs/index.json")
        self.assertEqual(json.loads(body), [{"title": "One", "file": "one.json"},
                                            {"title": "Amazing Grace (demo)", "file": "two.json"}])
        _, body = self.get("/songs/one.json")
        self.assertEqual(json.loads(body)["notes"][0]["lyric"], "la")

    def test_first_folder_wins_and_broken_songs_are_skipped(self):
        self.write(self.a, "x.txt", SONG.format(title="From A"))
        self.write(self.b, "x.txt", SONG.format(title="From B"))
        self.write(self.a, "bad.txt", "1 | C4:3\n")
        _, body = self.get("/songs/index.json")
        self.assertEqual(json.loads(body), [{"title": "From A", "file": "x.json"}])
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.get("/songs/bad.json")
        self.assertEqual(cm.exception.code, 500)
        self.assertIn("needs 4", json.loads(cm.exception.read())["error"])

    def test_unknown_song_and_path_traversal_404(self):
        for p in ("/songs/nope.json", "/songs/..%2F..%2Fetc%2Fpasswd"):
            with self.subTest(p=p), self.assertRaises(urllib.error.HTTPError) as cm:
                self.get(p)
            self.assertEqual(cm.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
