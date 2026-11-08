# Contributing to Songline

Thanks for helping. Bug reports, ideas, fixes, documentation and new
public-domain songs are all welcome.

## Ways to help

- **Report a bug or suggest a feature:** open an issue using one of the
  templates. For bugs, the device, the browser, and any errors from the
  browser's developer console help a lot.
- **Add a public-domain song:** see [Adding a song](#adding-a-song) below.
- **Improve the code or docs:** open a pull request. For anything bigger than a
  small fix, please open an issue first so we can agree on the approach.

## Development setup

There's no build step and no package to install. You need:

- **Python 3.9+** to run the server, the song tools and the tests
- a modern browser
- *optional:* **Node.js** (for `node --check`), **make**, and **Playwright**
  for the browser tests and screenshots
  (`pip install playwright && playwright install chromium`)

```sh
git clone https://github.com/mbhewitt/songline.git
cd songline
python3 tools/serve.py                       # http://localhost:8765/
python3 -m unittest discover -s tests -v     # or: make test
```

Edit `app/app.js` or `app/index.html` and reload the page. The server sends the
app with `Cache-Control: no-cache` and the service worker fetches code from the
network first, so a normal reload picks up your changes.

To test on a phone, follow "Use it on your phone" in the [README](README.md).
Remote debugging is the easiest way to see the console:
`chrome://inspect` for Android with Chrome, or Safari's Develop menu for iOS.

## Project layout

| Path | What's there |
|---|---|
| `app/index.html` | Page structure and all CSS (light and dark themes). |
| `app/app.js` | The whole app, in sections: music theory (keys, spelling, chords), state, audio, transport and scheduling, mic and pitch detection, singer's range, drawing (piano roll, staff, lyrics), karaoke, library (IndexedDB), and UI wiring. |
| `app/sw.js` | Service worker: offline cache. Bump `CACHE` when you add or rename app files. |
| `tools/txt2song.py` | The song text format → JSON. `serve.py` imports it. |
| `tools/serve.py` | Development and home server. |
| `tests/` | `test_txt2song.py`, `test_serve.py` (standard library only), `test_browser.py` (Playwright; skipped if not installed). |

## Guidelines

- **No dependencies or build step for the app.** It's plain HTML, CSS and
  JavaScript that runs straight from `app/`. The Python tools use only the
  standard library. If you think something needs a dependency, open an issue
  first.
- **Match the surrounding style.** It's compact JavaScript (2-space indent,
  single quotes, semicolons) with short comments that explain *why*. Python
  follows PEP 8 (4-space indent).
- **Fail loudly and specifically.** A bad song file should produce an error
  that names the file, line and bar, not a silently wrong song. Messages shown
  in the app should tell the user what to do next.
- **Keep it private.** Songs, settings and microphone audio stay on the device.
  Don't add analytics, external requests or third-party CDNs.
- **Accessibility and phones.** Controls need labels and must be usable at
  phone width (about 400 px) in both light and dark themes.
- **Tests.** Add or update tests for changes to the song format, the server, or
  app behaviour that a browser test can check. `make test` must pass.
- **Screenshots.** If you change how the app looks, regenerate them with
  `make screenshots` (needs Playwright).
- **`app/demo.json`** is generated. After changing `songs/amazing_grace.txt` or
  the converter output, run `make demo`. A test checks they match.

## Adding a song

Only songs that are **in the public domain** (or that you wrote and are
licensing under this project's MIT license) can be included. In practice that
means traditional songs, hymns, and songs whose words and music were published
long ago (for example in the US, before 1930). The arrangement you transcribe
from must also be free to use, so work from an old edition or from the
melody itself, not from a modern copyrighted arrangement.

1. Write `songs/<name>.txt` following [docs/song-format.md](docs/song-format.md).
2. In the header comment, note where the words and music come from and why
   they're public domain (composer, author and dates).
3. Check it: `python3 tools/txt2song.py songs/<name>.txt /dev/null`, then play it
   through in the app.
4. Open a pull request. The tests compile every bundled song.

## Pull requests

- Keep each PR focused on one change, and describe what it does and how you
  tested it (the PR template has a checklist).
- Update `CHANGELOG.md` under **Unreleased** for anything users will notice.
- By contributing, you agree that your contribution is licensed under the
  project's [MIT License](LICENSE).

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md) in all project spaces.
