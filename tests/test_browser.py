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

    # A simulated singer: for every pass through every note, readings every 33 ms of how many
    # cents off they are, from a model of (interval into the note, ms since the note started).
    SIMULATE = """model => {
        S.stats = new Map();
        const ns = S.song.notes;
        for (let i = 1; i < ns.length; i++) {
            const iv = ns[i].midi - ns[i - 1].midi, len = ns[i].dur * 60000 / bpm(), runs = [];
            for (let pass = 0; pass < 3; pass++) {
                const run = [];
                for (let ms = 0; ms < len; ms += 33) run.push([ms, Math.round(model(iv, ms))]);
                runs.push(run);
            }
            S.stats.set(i, { f: 9, h: 9, runs });
        }
    }"""

    def report(self, page, model):
        page.evaluate(f"({self.SIMULATE})({model})")
        return page.evaluate("transitionReport(S.song.notes, S.stats)")

    def test_report_finds_short_leaps(self):
        page = self.open()
        # Steps land at once; leaps of a 4th or more stay 70 cents short of the target.
        rep = self.report(page, "(iv, ms) => Math.abs(iv) >= 5 ? -70 * Math.sign(iv) : 5")
        tips = " ".join(rep["tips"])
        self.assertIn("big jumps are the problem", tips)
        self.assertIn("Leaps up (4th or more): you fall short", tips)
        self.assertNotIn("arrive late", tips)
        self.assertTrue(rep["worst"], "no hardest spots listed")
        self.assertTrue(all(abs(t["iv"]) >= 5 for t in rep["worst"]))

    def test_report_finds_late_arrival(self):
        page = self.open()
        # Every new note starts on the old pitch and only moves over after 400 ms.
        rep = self.report(page, "(iv, ms) => ms < 400 ? -100 * iv : 0")
        tips = " ".join(rep["tips"])
        self.assertIn("You arrive late", tips)
        self.assertIn("still on the old pitch", tips)
        self.assertNotIn("big jumps", tips)

    def test_report_clean_singer_and_sheet(self):
        page = self.open(viewport={"width": 412, "height": 860}, is_mobile=True, has_touch=True)
        page.click("#reportBtn")
        self.assertIn("Not enough singing", page.inner_text("#rTips"))
        page.click("#rClose")
        self.assertTrue(page.is_hidden("#report"))
        self.report(page, "(iv, ms) => ms < 66 ? 30 : 0")
        page.click("#reportBtn")
        self.assertIn("transitions look solid", page.inner_text("#rTips"))
        self.assertIn("Leaps up (4th or more): landed 12 of 12", page.inner_text("#rGroups"))
        # A spot that fails: the first leap up, never landed. Practise loops its line.
        page.evaluate("""() => { const ns = S.song.notes; const i = ns.findIndex((n, k) => k && n.midi - ns[k - 1].midi >= 5);
            S.stats.get(i).runs = S.stats.get(i).runs.map(r => r.map(([ms]) => [ms, -80])); window._i = i; }""")
        page.click("#rClose")
        page.click("#reportBtn")
        page.click("#rWorst li:first-child button")
        self.assertTrue(page.is_hidden("#report"))
        self.assertTrue(page.evaluate("(() => { const L = S.lines[S.lineOf[_i]]; return S.loop && S.loop.a <= L.start && S.loop.b >= L.end; })()"))

    def test_mic_records_note_passes(self):
        page = self.open()
        page.click("#micBtn")
        page.wait_for_function("() => !!micStream", timeout=10000)
        page.click("#play")
        page.wait_for_function("() => [...S.stats.values()].some(st => st.runs.length && st.runs[0].length >= 4)", timeout=20000)
        page.click("#play")


if __name__ == "__main__":
    unittest.main()
