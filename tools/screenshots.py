#!/usr/bin/env python3
"""Regenerate the README screenshots in docs/screenshots/.

Needs Playwright:  pip install playwright && playwright install chromium
usage: python3 tools/screenshots.py

Starts the server on a free local port, opens the bundled Amazing Grace demo,
moves to the middle of the song and draws a sample sung-pitch trace (so the
mic feature shows without a microphone), then captures desktop and phone views.
"""
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "screenshots")
PORT = 8799

# Pose the app: paused at beat B, with a pretend singer slightly off on some notes.
POSE = """(B) => {
  setMyRange(57, 77);                                          // Mezzo: the demo fits
  T.beat = B;
  S.trace = []; S.stats = new Map();
  S.song.notes.forEach((n, i) => {
    if (n.t + n.dur > B) return;
    const off = [0.05, -0.1, 0.35, 0.0, -0.6, 0.1][i % 6];      // semitones off target
    const st = { f: 0, h: 0 };
    for (let b = n.t + 0.05; b < n.t + n.dur - 0.05; b += 0.05) {
      const m = n.midi + S.shift + off + 0.08 * Math.sin(b * 9);
      S.trace.push({ b, m }); st.f++; if (Math.abs(m - n.midi - S.shift) <= 0.5) st.h++;
    }
    S.stats.set(i, st);
  });
}"""


def wait_up(url):
    for _ in range(50):
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except OSError:
            time.sleep(0.1)
    raise SystemExit(f"server didn't start at {url}")


def main():
    os.makedirs(OUT, exist_ok=True)
    srv = subprocess.Popen([sys.executable, os.path.join(ROOT, "tools", "serve.py"), "--port", str(PORT)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        url = f"http://localhost:{PORT}/"
        wait_up(url)
        with sync_playwright() as p:
            b = p.chromium.launch()
            for name, opts in [("desktop", {"viewport": {"width": 1280, "height": 760}}),
                               ("phone", {"viewport": {"width": 412, "height": 860}, "device_scale_factor": 2,
                                          "is_mobile": True, "has_touch": True})]:
                for scheme in ("light", "dark"):
                    if name == "phone" and scheme == "light":
                        continue
                    ctx = b.new_context(color_scheme=scheme, **opts)
                    pg = ctx.new_page()
                    errors = []
                    pg.on("pageerror", lambda e: errors.append(str(e)))
                    pg.goto(url)
                    pg.wait_for_function("() => S.song && S.song.notes.length")
                    pg.evaluate(POSE, 20.3)
                    pg.wait_for_timeout(400)
                    pg.screenshot(path=os.path.join(OUT, f"roll-{name}-{scheme}.png"))
                    if scheme == "dark" or name == "phone":
                        pg.click("#viewBtn")
                        pg.wait_for_timeout(300)
                        pg.screenshot(path=os.path.join(OUT, f"staff-{name}-{scheme}.png"))
                        pg.click("#viewBtn")
                    if name == "phone":
                        pg.evaluate("() => { M = {step: 'done', low: 45, high: 64, segs: [], cur: [], micWasOn: true};"
                                    " $('measure').hidden = false; showMeasure(); }")
                        pg.screenshot(path=os.path.join(OUT, "measure-phone.png"))
                        pg.evaluate("() => { M = null; $('measure').hidden = true; }")
                        pg.click("#libBtn")
                        pg.wait_for_timeout(500)
                        pg.screenshot(path=os.path.join(OUT, "library-phone.png"))
                        pg.click("#libClose")
                    if name == "desktop" and scheme == "light":
                        pg.click("#moreBtn")
                        pg.wait_for_timeout(200)
                        pg.screenshot(path=os.path.join(OUT, "settings-desktop.png"))
                    if errors:
                        raise SystemExit(f"page errors in {name}/{scheme}: {errors}")
                    ctx.close()
            b.close()
    finally:
        srv.terminate()
        srv.wait()
    print("wrote", ", ".join(sorted(os.listdir(OUT))))


if __name__ == "__main__":
    main()
