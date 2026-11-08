"""Browser smoke tests: the app loads without errors, plays nothing unexpected,
and the range measurement works with a simulated microphone.

Optional: needs Playwright (pip install playwright && playwright install chromium).
Skipped automatically when Playwright isn't installed.
"""
import math
import os
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import wave

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8797


def sung_notes_wav(path, freqs, seconds=2.0, sr=48000):
    """A looping 'voice': each frequency held for `seconds`, with a few harmonics."""
    frames = []
    for f in freqs:
        for i in range(int(sr * seconds)):
            t = i / sr
            v = 0.5 * math.sin(2 * math.pi * f * t) + 0.25 * math.sin(4 * math.pi * f * t) + 0.12 * math.sin(6 * math.pi * f * t)
            frames.append(int(v * 12000))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(struct.pack(f"<{len(frames)}h", *frames))


@unittest.skipIf(sync_playwright is None, "Playwright not installed")
class Browser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "serve.py"), "--port", str(PORT)],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.url = f"http://localhost:{PORT}/"
        for _ in range(50):
            try:
                urllib.request.urlopen(cls.url, timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        cls.tmp = tempfile.mkdtemp()
        cls.wav = os.path.join(cls.tmp, "voice.wav")
        sung_notes_wav(cls.wav, [110.0, 329.63])          # A2 then E4, looping
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            f"--use-file-for-fake-audio-capture={cls.wav}", "--autoplay-policy=no-user-gesture-required"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.srv.terminate()
        cls.srv.wait()

    def open(self, **ctx):
        page = self.browser.new_context(**ctx).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        self.addCleanup(lambda: self.assertEqual(errors, [], "page errors"))
        page.goto(self.url)
        page.wait_for_function("() => S.song && S.song.notes.length")
        return page

    def test_loads_demo_and_lists_server_songs(self):
        page = self.open()
        self.assertIn("Amazing Grace", page.inner_text("#songTitle"))
        page.click("#libBtn")
        page.wait_for_function("() => document.querySelectorAll('#songList li').length >= 2")
        songs = page.inner_text("#songList")
        self.assertIn("Twinkle, Twinkle, Little Star", songs)
        self.assertEqual(songs.count("Amazing Grace"), 1, "demo listed twice")

    def test_staff_view_and_key_shift(self):
        page = self.open(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
        page.click("#viewBtn")
        page.fill("#transpose", "-12")
        page.dispatch_event("#transpose", "input")
        self.assertIn("D3–D4", page.inner_text("#rangeOut"))

    def test_measure_range_with_fake_mic(self):
        page = self.open()
        page.click("#moreBtn")
        page.click("#measureBtn2")
        page.wait_for_function("() => M && M.segs.includes(45)", timeout=10000)    # heard a steady A2
        page.click("#mNext")
        page.wait_for_function("() => M && M.segs.includes(64)", timeout=10000)    # heard a steady E4
        page.click("#mNext")
        self.assertEqual(page.inner_text("#mNote"), "A2–E4")
        page.wait_for_selector("#mCoach li")
        coach = page.inner_text("#mCoach")
        self.assertIn("19 semitones", coach)
        self.assertIn("closest to Baritone", coach)
        self.assertIn("Amazing Grace", coach)
        page.click("#mNext")
        self.assertEqual(page.evaluate("[S.myLo, S.myHi]"), [45, 64])
        self.assertTrue(page.is_hidden("#measure"))
        self.assertTrue(page.is_hidden("#mCoach"))
        self.assertFalse(page.evaluate("!!micStream"), "mic left on after measuring")


if __name__ == "__main__":
    unittest.main()
