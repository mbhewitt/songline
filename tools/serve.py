#!/usr/bin/env python3
"""Serve Songline: the app at /, songs at /songs/ (with a generated /songs/index.json).

  python3 tools/serve.py                                  # http://localhost:8765/
  python3 tools/serve.py --host 0.0.0.0 --cert certs/server.crt --key certs/server.key
  python3 tools/serve.py --songs ~/my-sheet-music         # extra song folders (repeatable)

Song folders hold .txt songs (compiled on each request, so edits show up on the
next load) and/or ready-made .json songs. By default the bundled songs/ folder and,
if it exists, my-songs/ are served. Only Python 3.8+ is needed (standard library).
"""
import argparse
import functools
import http.server
import json
import os
import socket
import ssl
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from txt2song import FORMAT, SongError, compile_song  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app")
DEFAULT_SONG_DIRS = [os.path.join(ROOT, "songs"), os.path.join(ROOT, "my-songs")]


def find_songs(dirs, log=print):
    """Map published file name (stem + '.json') -> source path. First folder wins;
    a .txt beats a .json of the same name in the same folder. Clashes are logged."""
    found = {}
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d), key=lambda f: (os.path.splitext(f)[0], not f.endswith(".txt"))):
            stem, ext = os.path.splitext(f)
            if ext not in (".txt", ".json"):
                continue
            name = stem + ".json"
            src = os.path.join(d, f)
            if name in found:
                log(f"note: {src} skipped, {found[name]} already provides {name}")
                continue
            found[name] = src
    return found


def load_song(src):
    """Return the song dict for a .txt or .json source. Raises SongError/OSError."""
    if src.endswith(".txt"):
        return compile_song(src)
    with open(src, encoding="utf-8") as f:
        try:
            song = json.load(f)
        except ValueError as e:
            raise SongError(f"{src}: not valid JSON ({e})") from None
    if not isinstance(song, dict) or song.get("format") != FORMAT:
        raise SongError(f"{src}: not a Songline song (expected \"format\": \"{FORMAT}\")")
    return song


class Handler(http.server.SimpleHTTPRequestHandler):
    song_dirs = DEFAULT_SONG_DIRS

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?", 1)[0].split("#", 1)[0]
        if not p.startswith("/songs/"):
            return super().do_GET()
        songs = find_songs(self.song_dirs, log=self.log_message)
        if p == "/songs/index.json":
            items = []
            for name, src in sorted(songs.items()):
                try:
                    items.append({"title": load_song(src)["title"], "file": name})
                except (SongError, OSError, KeyError) as e:
                    self.log_message("SKIPPED %s: %s", src, e)
            return self.send_json(items)
        name = os.path.basename(p[len("/songs/"):])
        if name not in songs:
            return self.send_json({"error": f"no song {name!r}"}, 404)
        try:
            return self.send_json(load_song(songs[name]))
        except (SongError, OSError) as e:
            self.log_message("ERROR %s: %s", songs[name], e)
            return self.send_json({"error": str(e)}, 500)

    def end_headers(self):
        if self.path.split("?", 1)[0].endswith((".js", ".html", "/", ".webmanifest")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def lan_addresses():
    """Best-effort list of this machine's non-loopback IPv4 addresses (for the startup hint)."""
    addrs = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))            # TEST-NET address: no packet is sent
            addrs.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        addrs.update(a[4][0] for a in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    return sorted(a for a in addrs if not a.startswith("127."))


def main(argv=None):
    ap = argparse.ArgumentParser(description="Serve the Songline app and your songs.")
    ap.add_argument("--host", default="127.0.0.1",
                    help="address to listen on (default 127.0.0.1, this computer only; "
                         "0.0.0.0 = every network interface)")
    ap.add_argument("--port", type=int, default=8765, help="port (default 8765)")
    ap.add_argument("--songs", action="append", metavar="DIR",
                    help="song folder to serve (repeatable; default: songs/ and my-songs/)")
    ap.add_argument("--cert", help="TLS certificate (PEM) — serve https; needed for the mic on other devices")
    ap.add_argument("--key", help="TLS private key (PEM) for --cert")
    a = ap.parse_args(argv)
    if bool(a.cert) != bool(a.key):
        ap.error("--cert and --key go together")
    dirs = [os.path.abspath(os.path.expanduser(d)) for d in a.songs] if a.songs else DEFAULT_SONG_DIRS
    for d in a.songs or []:
        if not os.path.isdir(os.path.expanduser(d)):
            ap.error(f"--songs {d}: no such folder")

    handler = functools.partial(type("H", (Handler,), {"song_dirs": dirs}), directory=APP)
    try:
        httpd = http.server.ThreadingHTTPServer((a.host, a.port), handler)
    except OSError as e:
        raise SystemExit(f"error: can't listen on {a.host}:{a.port} ({e.strerror}). "
                         f"Is something else using the port? Try --port {a.port + 1}.")
    scheme = "http"
    if a.cert:
        sc = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        try:
            sc.load_cert_chain(a.cert, a.key)
        except (OSError, ssl.SSLError) as e:
            raise SystemExit(f"error: can't load --cert {a.cert} / --key {a.key}: {e}")
        httpd.socket = sc.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    songs = find_songs(dirs)
    print(f"Songline serving {len(songs)} song file(s) from: " + ", ".join(d for d in dirs if os.path.isdir(d)))
    if a.host in ("127.0.0.1", "localhost", "::1"):
        print(f"Open {scheme}://localhost:{a.port}/ in a browser on this computer.")
    else:
        hosts = lan_addresses() if a.host in ("0.0.0.0", "::") else [a.host]
        for h in hosts:
            print(f"Open {scheme}://{h}:{a.port}/")
        print("Anyone who can reach this address can see your songs.")
        if scheme == "http":
            print("Note: browsers only allow the microphone on https (or localhost). "
                  "See README 'Use it on your phone'.")
    print("Ctrl+C to stop.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
