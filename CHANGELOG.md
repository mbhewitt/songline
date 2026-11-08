# Changelog

All notable changes to this project are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Example copy on GitHub Pages (`tools/build_site.py`, `pages.yml`); the build only publishes
  songs marked public domain.

## [1.0.0] - 2026-11-08

First public release.

### Added
- Scrolling melody as a piano roll or a staff with key signature, lyrics under the notes.
- Karaoke lyric line with word-by-word highlighting and phrase-aware line breaks.
- Sampled piano guide melody and chord accompaniment (incl. 7ths, dim7, sus, slash chords).
- Bouncing-ball beat, count-in and metronome click; tempo control; loop the current line.
- Live microphone pitch trace with per-note accuracy and an end-of-song score; any-octave scoring.
- Key shift with the song's resulting range, singer's range (voice presets, manual, or
  measured with the mic) and a **Fit** button that picks the best shift.
- Installable, offline-capable web app; songs kept on the device in IndexedDB and refreshed
  from the server when they change.
- Song text format with ties, melismas, triplets, repeats, 1st/2nd endings, per-pass lyrics and
  time-signature changes; `txt2song.py` converter with file/line errors; `txt2abc.py` proof renderer.
- `serve.py` local server that converts `.txt` songs on the fly, serves several song folders,
  and supports https; `make_cert.sh` for phone certificates.
- Public-domain songs: Amazing Grace, Twinkle Twinkle Little Star.
