// Offline cache for the app shell + piano samples. Song files stay in IndexedDB.
const CACHE = 'songline-v1';
const SAMPLES = [];
for (let o = 1; o <= 5; o++) for (const n of ['C', 'Ds', 'Fs', 'A']) SAMPLES.push(`samples/${n}${o}.mp3`);
SAMPLES.push('samples/C6.mp3');
const SHELL = ['./', 'index.html', 'app.js', 'demo.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', ...SAMPLES];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/songs/')) return;                 // always live from the server
  // network first for code (so updates land), cache first for samples
  if (url.pathname.includes('/samples/')) e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  else e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
