'use strict';
/* Songline — sing-along practice: scrolling melody (piano roll or staff) with
   lyrics, sampled-piano guide, bouncing-ball beat, and live mic pitch.
   Song files are "sing-app/1" JSON (tools/txt2song.py). They are kept on the
   device (IndexedDB) and never sent anywhere. */

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('songline.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('songline.' + k, JSON.stringify(v)); } catch { /* storage off: settings just don't persist */ } },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ music */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];   // F C G D A E B (letter indices)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];    // B E A D G C F
const MAJOR_FIFTHS = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: -6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1 };
const ACC = { '-2': '𝄫', '-1': '♭', '0': '♮', '1': '♯', '2': '𝄪' };
const pcOf = name => { const m = /^([A-G])([#b♯♭]?)/.exec(name); if (!m) return null;
  return (NATURAL[LETTERS.indexOf(m[1])] + (m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0) + 12) % 12; };

function makeKey(keyName, shift) {
  const minor = /m$/.test(keyName || '') && !/maj$/.test(keyName);
  let tonic = pcOf(keyName || 'C'); if (tonic == null) tonic = 0;
  tonic = ((tonic + shift) % 12 + 12) % 12;
  const fifths = MAJOR_FIFTHS[minor ? (tonic + 3) % 12 : tonic];
  const alt = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(l => alt[l] = 1);
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach(l => alt[l] = -1);
  const byPc = {};
  for (let l = 0; l < 7; l++) byPc[(NATURAL[l] + alt[l] + 12) % 12] = [l, alt[l]];
  for (let pc = 0; pc < 12; pc++) if (!byPc[pc]) {
    if (fifths >= 0) { const l = NATURAL.lastIndexOf(NATURAL.filter(n => n <= pc).pop()); byPc[pc] = [l, pc - NATURAL[l]]; }
    else { const up = NATURAL.find(n => n >= pc); const l = NATURAL.indexOf(up); byPc[pc] = [l, pc - up]; }
  }
  const name = (fifths >= 0 ? ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
                            : ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'])[tonic] + (minor ? 'm' : '');
  return { fifths, alt, byPc, name, flat: fifths < 0 };
}
// spelled note: diatonic step (C0 = 0), accidental, label
function spell(midi, key) {
  const pc = ((midi % 12) + 12) % 12, [l, a] = key.byPc[pc];
  const oct = Math.floor((midi - a) / 12) - 1;
  return { step: oct * 7 + l, letter: l, acc: a, oct,
    label: LETTERS[l] + (a ? ACC[a] : '') + oct, showAcc: a !== key.alt[l] ? ACC[a] : '' };
}
function chordName(name, shift, key) {
  const m = /^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/.exec(name); if (!m) return name;
  const names = key.flat ? ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
                         : ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const nm = n => names[(pcOf(n) + shift + 120) % 12];
  return nm(m[1]) + m[2].replace('dim7', '°7') + (m[3] ? '/' + nm(m[3]) : '');
}
function chordTones(name, shift) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name); if (!m) return [];
  const root = pcOf(m[1]) + shift, q = m[2];
  let iv = /^m(?!aj)/.test(q) ? [0, 3, 7] : /dim/.test(q) ? [0, 3, 6] : /aug|\+/.test(q) ? [0, 4, 8]
         : /sus4/.test(q) ? [0, 5, 7] : /sus2/.test(q) ? [0, 2, 7] : [0, 4, 7];
  if (/maj7/.test(q)) iv = iv.concat(11); else if (/dim7/.test(q)) iv = iv.concat(9); else if (/7/.test(q)) iv = iv.concat(10);
  const base = 48 + ((root % 12) + 12) % 12;            // root in octave 3
  const sl = /\/([A-G][#b]?)$/.exec(q);                 // slash chord: F/C plays C in the bass
  const bpc = sl ? 36 + ((pcOf(sl[1]) + shift) % 12 + 12) % 12 : base - 12;
  const bass = bpc >= 40 ? bpc : bpc + 12;              // a low note for the left hand
  return [bass].concat(iv.map(i => base + i));
}

/* ------------------------------------------------------------------ state */
const S = {
  song: null, songId: null,
  shift: store.get('transpose', 0),
  tempoPct: 100,
  view: store.get('view', 'roll'),
  guide: store.get('guide', 80), chords: store.get('chords', 35),
  zoom: store.get('zoom', 90),
  myLo: store.get('myLo', 48), myHi: store.get('myHi', 69),        // comfortable range, default C3–A4 (set in More)
  click: store.get('click', false), countIn: store.get('countIn', true), anyOct: store.get('anyOct', true),
  mic: false, loop: null,
  key: null, events: [], lines: [], lineOf: [], lo: 48, hi: 72, clef: 'treble',
  trace: [], stats: new Map(), pitch: null,
};

/* ------------------------------------------------------------------ audio */
let ctx = null, master, guideBus, chordBus, clickBus, voices = [];
const samples = [];                   // {midi, buf}
let samplesState = 'none';            // none | loading | ready | failed
const SAMPLE_FILES = [];
for (let o = 1; o <= 5; o++) for (const [n, pc] of [['C', 0], ['Ds', 3], ['Fs', 6], ['A', 9]]) SAMPLE_FILES.push([`${n}${o}`, 12 * (o + 1) + pc]);
SAMPLE_FILES.push(['C6', 84]);

function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3;
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(comp).connect(ctx.destination);
  guideBus = ctx.createGain(); chordBus = ctx.createGain(); clickBus = ctx.createGain();
  [guideBus, chordBus, clickBus].forEach(g => g.connect(master));
  setBusGains();
  samplesState = 'loading';
  Promise.all(SAMPLE_FILES.map(([f, midi]) => fetch(`samples/${f}.mp3`)
    .then(r => { if (!r.ok) throw new Error(`${f}.mp3: HTTP ${r.status}`); return r.arrayBuffer(); })
    .then(b => ctx.decodeAudioData(b)).then(buf => samples.push({ midi, buf }))))
    .then(() => { samples.sort((a, b) => a.midi - b.midi); samplesState = 'ready'; })
    .catch(e => { samplesState = 'failed'; toast(`Piano samples didn't load (${e.message}). Using a simple synth instead.`); });
}
function setBusGains() {
  if (!ctx) return;
  guideBus.gain.value = (S.guide / 100) ** 1.5;
  chordBus.gain.value = (S.chords / 100) ** 1.5 * 0.55;
  clickBus.gain.value = 0.5;
}
function playTone(midi, when, dur, bus, vel) {
  const g = ctx.createGain();
  let src;
  if (samplesState === 'ready') {
    let s = samples[0]; for (const c of samples) if (Math.abs(c.midi - midi) < Math.abs(s.midi - midi)) s = c;
    src = ctx.createBufferSource(); src.buffer = s.buf; src.playbackRate.value = 2 ** ((midi - s.midi) / 12);
    g.gain.setValueAtTime(vel, when);
  } else {                                    // fallback synth: soft triangle with piano-like decay
    src = ctx.createOscillator(); src.type = 'triangle'; src.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vel * 0.5, when + 0.01);
    g.gain.setTargetAtTime(vel * 0.2, when + 0.01, 0.4);
  }
  g.gain.setTargetAtTime(0, when + dur, 0.09);
  src.connect(g).connect(bus);
  src.start(when); src.stop(when + dur + 0.8);
  const v = { src, g, when }; voices.push(v);
  src.onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
}
function playClick(when, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1180;
  g.gain.setValueAtTime(accent ? 0.5 : 0.3, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
  o.connect(g).connect(clickBus); o.start(when); o.stop(when + 0.06);
  const v = { src: o, g, when }; voices.push(v);
  o.onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
}
function stopVoices(onlyFuture) {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const v of voices.slice()) {
    if (onlyFuture && v.when <= now) continue;
    try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.02); v.src.stop(now + 0.12); } catch { /* already stopped */ }
  }
}

/* -------------------------------------------------------------- transport */
const T = { playing: false, beat: 0, anchorTime: 0, anchorBeat: 0, schedBeat: 0, countEnd: 0, countFrom: 0, timer: null };
const bpm = () => (S.song ? S.song.tempo : 90) * S.tempoPct / 100;
const nowBeat = () => T.playing ? T.anchorBeat + (ctx.currentTime - T.anchorTime) * bpm() / 60 : T.beat;
const timeOf = b => T.anchorTime + (b - T.anchorBeat) * 60 / bpm();

function barAt(b) {
  const bars = S.song.bars; let lo = 0, hi = bars.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m].t <= b + 1e-6) lo = m; else hi = m - 1; }
  return bars[lo];
}
function start(fromBeat, count = S.countIn) {
  ensureAudio();
  if (samplesState === 'loading') {
    toast('Loading piano…');
    const wait = setInterval(() => { if (samplesState !== 'loading') { clearInterval(wait); hideToast(); start(fromBeat, count); } }, 100);
    return;
  }
  const bar = barAt(Math.max(0, fromBeat));
  const nCount = count ? Math.max(2, Math.round(bar.beats)) : 0;
  T.countFrom = fromBeat - nCount; T.countEnd = fromBeat;
  T.anchorTime = ctx.currentTime + 0.1; T.anchorBeat = T.countFrom; T.schedBeat = T.countFrom;
  T.playing = true;
  clearInterval(T.timer); T.timer = setInterval(schedule, 25); schedule();
  $('play').textContent = 'Pause'; $('play').setAttribute('aria-label', 'Pause');
  wakeLock(true);
}
function pause() {
  if (!T.playing) return;
  T.beat = clamp(nowBeat(), 0, S.song.totalBeats); T.playing = false;
  clearInterval(T.timer); stopVoices(false);
  $('play').textContent = 'Play'; $('play').setAttribute('aria-label', 'Play');
  wakeLock(false);
}
function seek(b, count) {
  const was = T.playing;
  if (was) { T.playing = false; clearInterval(T.timer); stopVoices(false); }
  T.beat = clamp(b, 0, S.song.totalBeats);
  if (was) start(T.beat, count);
}
function retime() {                    // tempo/key changed mid-play: keep position, re-schedule the future
  if (!T.playing) return;
  const b = nowBeat(); T.anchorTime = ctx.currentTime; T.anchorBeat = b;
  stopVoices(true); T.schedBeat = Math.max(b, T.countFrom);
}
function schedule() {
  if (!T.playing) return;
  let horizon = T.anchorBeat + (ctx.currentTime + 0.18 - T.anchorTime) * bpm() / 60;
  if (S.loop) horizon = Math.min(horizon, S.loop.b);
  const from = T.schedBeat, spb = 60 / bpm();
  // count-in clicks
  for (let b = Math.ceil(from - 1e-6); b < Math.min(horizon, T.countEnd); b++) if (b >= T.countFrom) playClick(timeOf(b), b === T.countFrom);
  for (const e of S.events) {
    if (e.beat < from || e.beat < T.countEnd - 1e-6) continue;
    if (e.beat >= horizon) break;
    const when = timeOf(e.beat);
    if (e.type === 'note' && S.guide > 0) playTone(e.midi, when, e.dur * spb, guideBus, 0.85);
    else if (e.type === 'chord' && S.chords > 0) e.tones.forEach((m, i) => playTone(m, when + i * 0.012, e.dur * spb, chordBus, i ? 0.32 : 0.45));
    else if (e.type === 'click' && S.click) playClick(when, e.accent);
  }
  T.schedBeat = Math.max(from, horizon);
}
function tick() {                      // per animation frame: loop wrap, song end
  if (!T.playing) return;
  const b = nowBeat();
  if (S.loop && b >= S.loop.b) { seek(S.loop.a, false); return; }
  if (b > S.song.totalBeats + 0.5) { pause(); T.beat = 0; summary(); }
}
let lock = null;
async function wakeLock(on) {
  try {
    if (on && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => lock = null); }
    if (!on && lock) { await lock.release(); lock = null; }
  } catch { /* screen may sleep; harmless */ }
}

/* -------------------------------------------------------------- song prep */
function prepare() {
  const song = S.song;
  S.key = makeKey(song.key, S.shift);
  const ev = [];
  for (const n of song.notes) ev.push({ type: 'note', beat: n.t, midi: n.midi + S.shift, dur: n.dur, ref: n });
  const chords = song.bars.flatMap(b => b.chords);
  chords.forEach((c, i) => {
    const end = i + 1 < chords.length ? chords[i + 1].t : song.totalBeats;
    ev.push({ type: 'chord', beat: c.t, dur: end - c.t, tones: chordTones(c.name, S.shift), name: c.name });
  });
  for (const b of song.bars) for (let i = 0; i < Math.round(b.beats); i++) ev.push({ type: 'click', beat: b.t + i, accent: i === 0 });
  ev.sort((a, b) => a.beat - b.beat || (a.type === 'chord' ? -1 : 1));
  S.events = ev;
  const ms = song.notes.map(n => n.midi + S.shift);
  S.lo = Math.min(...ms) - 2; S.hi = Math.max(...ms) + 2;
  const sorted = ms.slice().sort((a, b) => a - b);
  S.clef = sorted[sorted.length >> 1] < 60 ? 'bass' : 'treble';
  buildLines(song.notes);
  S.stats = new Map(); S.trace = []; renderedLine = -2;
  $('transOut').textContent = (S.shift > 0 ? '+' : '') + S.shift + (S.shift === -12 ? ' (8va down)' : '') + ' · ' + S.key.name;
  showRange();
  $('tempoOut').textContent = Math.round(bpm()) + ' bpm';
}
// Song range under the key slider, judged against the singer's comfortable range.
function songRange(shift) {
  const ms = S.song.notes.map(n => n.midi + shift);
  return [Math.min(...ms), Math.max(...ms)];
}
function noteName(m) { return spell(m, S.key).label; }
function showRange() {
  const [lo, hi] = songRange(S.shift), el = $('rangeOut');
  const below = Math.max(0, S.myLo - lo), above = Math.max(0, hi - S.myHi);
  let fit = 'fits your range', cls = 'ok';
  if (below || above) {
    cls = 'out';
    fit = [above && `${above} semitone${above > 1 ? 's' : ''} above your top ${noteName(S.myHi)}`,
           below && `${below} below your bottom ${noteName(S.myLo)}`].filter(Boolean).join(', ');
  }
  el.textContent = `Range ${noteName(lo)}–${noteName(hi)} · ${fit}`;
  el.className = 'range ' + cls;
}
// Key shift that best fits the song in the singer's range (fewest semitones out, then best centred).
function fitShift() {
  let best = null;
  for (let sh = -24; sh <= 12; sh++) {
    const [lo, hi] = songRange(sh);
    const out = Math.max(0, S.myLo - lo) + Math.max(0, hi - S.myHi);
    // centred in the range, with a light preference for keys with fewer sharps/flats (easier staff)
    const off = Math.abs((lo + hi) / 2 - (S.myLo + S.myHi) / 2) + 0.4 * Math.abs(makeKey(S.song.key, sh).fifths);
    if (!best || out < best.out || (out === best.out && off < best.off)) best = { sh, out, off };
  }
  return best.sh;
}

// Karaoke lines. Natural breaks first: rests, held notes, sentence ends, commas once the
// line has some length. Then any line still too long for a phone is split near its middle
// at a word boundary, preferring to split after a longer note.
const LINE_MAX = 40;
function buildLines(notes) {
  const text = idx => idx.filter(i => !notes[i].melisma).map(i => notes[i].lyric + (notes[i].hyphen ? '-' : ' ')).join('').trim();
  const raw = [];
  let cur = null, prev = null, held = 0, len = 0, lastLyric = '', lastHyphen = false;  // held: beats the last syllable sounds
  notes.forEach((n, i) => {
    if (n.melisma && cur) { cur.push(i); held += n.dur; prev = n; return; }
    const gap = prev ? n.t - (prev.t + prev.dur) : 99, wordEnd = prev && !lastHyphen;
    if (!cur || gap >= 0.75 || (held >= 2 && gap >= 0.25)
        || (wordEnd && /[.?!]["')]*$/.test(lastLyric))
        || (wordEnd && /[,;:]["')]*$/.test(lastLyric) && len >= 20)
        || (wordEnd && held >= 3 && len >= 10)) { cur = []; raw.push(cur); len = 0; }
    cur.push(i); prev = n; held = n.dur; lastLyric = n.lyric; lastHyphen = n.hyphen;
    len += n.lyric.length + (n.hyphen ? 0 : 1);
  });
  const split = idx => {
    const full = text(idx).length;
    if (full <= LINE_MAX) return [idx];
    let best = null;
    for (let k = 1; k < idx.length; k++) {
      const a = notes[idx[k - 1]], b = notes[idx[k]];
      if (b.melisma || a.hyphen) continue;                     // only between words
      let hold = 0;                                            // how long the word before the split is held
      for (let j = k - 1; j >= 0; j--) { hold += notes[idx[j]].dur; if (!notes[idx[j]].melisma) break; }
      const left = text(idx.slice(0, k)).length;
      const score = Math.abs(left - full / 2) - 4 * Math.min(hold, 2);
      if (!best || score < best.score) best = { k, score };
    }
    return best ? [...split(idx.slice(0, best.k)), ...split(idx.slice(best.k))] : [idx];
  };
  S.lines = []; S.lineOf = new Array(notes.length);
  for (const idx of raw.flatMap(split)) {
    const ends = idx.map(i => notes[i].t + notes[i].dur);
    S.lines.push({ idx, start: notes[idx[0]].t, end: Math.max(...ends) });
    idx.forEach(i => S.lineOf[i] = S.lines.length - 1);
  }
}

function openSong(song, id) {
  if (!song || song.format !== 'sing-app/1' || !Array.isArray(song.notes) || !song.notes.length)
    throw new Error('This file is not a Songline song (expected "format": "sing-app/1" with notes).');
  pause(); S.song = song; S.songId = id; S.loop = null; $('loopBtn').setAttribute('aria-pressed', 'false');
  S.tempoPct = store.get('tempo.' + id, 100); $('tempo').value = S.tempoPct;
  T.beat = 0; prepare();
  $('songTitle').textContent = song.title + (song.artist ? ' — ' + song.artist : '');
  store.set('lastSong', id);
}

/* ------------------------------------------------------------------- mic */
let micStream = null, analyser = null, micBuf = null, frameN = 0;
async function micOn(report = toast) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    report('The microphone only works on a secure (https) page. Open Songline from its https address.'); return false;
  }
  ensureAudio();
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    report(e.name === 'NotAllowedError' ? 'Microphone permission was refused. Allow it in the browser’s site settings to see your pitch.'
                                       : `Couldn't open the microphone (${e.message}).`); return false;
  }
  const src = ctx.createMediaStreamSource(micStream);
  analyser = ctx.createAnalyser(); analyser.fftSize = 2048; micBuf = new Float32Array(analyser.fftSize);
  src.connect(analyser);
  toast('Mic on. Headphones help: the guide piano can leak into the mic.', 3500);
  return true;
}
function micOff() { if (micStream) micStream.getTracks().forEach(t => t.stop()); micStream = null; analyser = null; S.pitch = null; $('tuner').textContent = ''; }
/* ------------------------------------------------------- singer's range */
// Voice presets: typical comfortable ranges, a starting point to adjust or measure from.
const VOICES = [['Bass', 40, 60], ['Baritone', 43, 64], ['Tenor', 48, 69], ['Alto', 53, 74], ['Mezzo', 57, 77], ['Soprano', 60, 81]];
const RANGE_MIN = 28, RANGE_MAX = 84;   // E1–C6: the choices in the range menus
const plainName = m => spell(m, makeKey('C', 0)).label;
function syncVoice() { const v = VOICES.find(([, lo, hi]) => lo === S.myLo && hi === S.myHi); $('voiceSel').value = v ? v[0] : ''; }
function setMyRange(lo, hi) {
  [lo, hi] = [clamp(Math.min(lo, hi), RANGE_MIN, RANGE_MAX), clamp(Math.max(lo, hi), RANGE_MIN, RANGE_MAX)];
  S.myLo = lo; S.myHi = hi; store.set('myLo', lo); store.set('myHi', hi);
  $('myLoSel').value = lo; $('myHiSel').value = hi; syncVoice();
  if (S.song) showRange();
}

// Range measurement: the singer holds their lowest, then their highest comfortable
// note. Only steady stretches count (≥ ~0.4 s within half a semitone), so slides,
// cracks and stray octave errors from the pitch detector don't set the range.
let M = null;                       // { step: 'low'|'high'|'done', segs: [], cur: [], low, high, micWasOn }
const STEADY_FRAMES = 12, STEADY_SPREAD = 0.5;
const median = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
async function startMeasure() {
  if (M) return;
  pause();
  // Open the sheet first, so a slow or failed microphone start is visible rather than silent.
  M = { step: 'starting', segs: [], cur: [], micWasOn: !!micStream };
  $('measure').hidden = false; $('mNote').textContent = '–'; $('mNext').disabled = true;
  $('mText').textContent = 'Starting the microphone… If the browser asks, allow it.';
  const fail = msg => { if (M) { M.step = 'failed'; $('mText').textContent = msg; } };
  try {
    if (!M.micWasOn && !(await micOn(fail))) return;
  } catch (e) { fail(`Couldn't start measuring (${e.message}).`); return; }
  if (!M) { if (micStream) micOff(); return; }     // cancelled while the mic was starting
  M.step = 'low'; showMeasure();
}
function showMeasure() {
  const t = $('mText'), next = $('mNext');
  if (M.step === 'low') { t.textContent = 'Step 1 of 2: sing your lowest comfortable note on "ah" and hold it for a second or two. Try a few if you like; the lowest steady one counts.'; next.textContent = 'Next'; }
  else if (M.step === 'high') { t.textContent = `Lowest: ${plainName(M.low)}. Step 2 of 2: now sing your highest comfortable note (not a strained one) and hold it.`; next.textContent = 'Done'; }
  else { t.textContent = `Your range: ${plainName(M.low)}–${plainName(M.high)} (${M.high - M.low} semitones). Fit and the red shading use this range.`; next.textContent = 'Use this range'; }
  next.disabled = M.step !== 'done' && !M.segs.length;
  $('mNote').textContent = M.step === 'done' ? `${plainName(M.low)}–${plainName(M.high)}` : '–';
}
function measureFrame() {
  if (!analyser || (frameN++ & 1) || (M.step !== 'low' && M.step !== 'high')) return;
  analyser.getFloatTimeDomainData(micBuf);
  const m = detectPitch(micBuf, ctx.sampleRate);
  if (m == null) { M.cur = []; return; }
  $('mNote').textContent = plainName(Math.round(m));
  M.cur.push(m);
  const med = median(M.cur);
  if (M.cur.some(x => Math.abs(x - med) > STEADY_SPREAD)) M.cur = [m];       // moved: start a new stretch
  else if (M.cur.length === STEADY_FRAMES) { M.segs.push(Math.round(med)); $('mNext').disabled = false; }
  else if (M.cur.length > STEADY_FRAMES) M.segs[M.segs.length - 1] = Math.round(med);
}
function nextMeasure() {
  if (M.step === 'low') { M.low = Math.min(...M.segs); M.step = 'high'; M.segs = []; M.cur = []; }
  else if (M.step === 'high') {
    M.high = Math.max(...M.segs); M.step = 'done';
    if (M.high <= M.low) { toast(`The high note (${plainName(M.high)}) wasn't above the low one (${plainName(M.low)}). Let's try again.`); M.step = 'low'; M.segs = []; M.cur = []; }
  } else { setMyRange(M.low, M.high); endMeasure(); return; }
  showMeasure();
}
function endMeasure() {
  if (M && !M.micWasOn) micOff();
  M = null; $('measure').hidden = true;
}
// McLeod pitch method (normalised square difference), 70–1100 Hz
function detectPitch(buf, sr) {
  const n = buf.length; let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < 0.01) return null;
  const minLag = Math.floor(sr / 1100), maxLag = Math.min(Math.floor(sr / 70), n >> 1);
  const nsdf = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let ac = 0, m = 0;
    for (let i = 0, e = n - lag; i < e; i++) { const a = buf[i], b = buf[i + lag]; ac += a * b; m += a * a + b * b; }
    nsdf[lag] = m > 0 ? 2 * ac / m : 0;
  }
  const peaks = []; let max = 0, i = minLag;
  while (i <= maxLag && nsdf[i] > 0) i++;               // skip the zero-lag lobe
  for (; i <= maxLag; i++) {
    if (nsdf[i] > 0 && nsdf[i] >= nsdf[i - 1] && nsdf[i] >= nsdf[i + 1]) {
      let j = i; while (j < maxLag && nsdf[j + 1] > 0 && nsdf[j + 1] >= nsdf[j]) j++;
      peaks.push(j); if (nsdf[j] > max) max = nsdf[j];
      while (i <= maxLag && nsdf[i] > 0) i++;
    }
  }
  if (!peaks.length || max < 0.75) return null;
  const p = peaks.find(k => nsdf[k] >= 0.9 * max);
  const a = nsdf[p - 1], b = nsdf[p], c = nsdf[p + 1], d = a - 2 * b + c;
  const lag = d ? p + 0.5 * (a - c) / d : p;
  return 69 + 12 * Math.log2(sr / lag / 440);
}
function activeNote(b) {               // song note sounding at beat b (transposed midi)
  const ns = S.song.notes; let lo = 0, hi = ns.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ns[m].t <= b) { k = m; lo = m + 1; } else hi = m - 1; }
  return k >= 0 && b < ns[k].t + ns[k].dur ? k : -1;
}
function micFrame(b) {
  if (!analyser || (frameN++ & 1)) return;
  analyser.getFloatTimeDomainData(micBuf);
  const m = detectPitch(micBuf, ctx.sampleRate);
  S.pitch = m;
  const k = activeNote(b);
  const target = k >= 0 ? S.song.notes[k].midi + S.shift : null;
  let shown = m;
  if (m != null && S.anyOct && target != null) shown = m - 12 * Math.round((m - target) / 12);
  if (T.playing && b >= 0) {
    S.trace.push({ b, m: shown });
    if (S.trace.length > 4000) S.trace.splice(0, 1000);
    if (k >= 0 && m != null) {
      const st = S.stats.get(k) || { f: 0, h: 0 }; st.f++;
      if (Math.abs((shown - target) * 100) <= 50) st.h++;
      S.stats.set(k, st);
    }
  }
  const tn = $('tuner');
  if (m == null) { tn.textContent = ''; return; }
  const sung = spell(Math.round(m), S.key).label;
  if (target != null) {
    const cents = Math.round((shown - target) * 100);
    tn.innerHTML = `${sung} <span style="color:var(${Math.abs(cents) <= 25 ? '--good' : Math.abs(cents) <= 50 ? '--warn' : '--bad'})">${cents > 0 ? '+' : ''}${cents}¢</span>`;
  } else tn.textContent = sung;
}
function summary() {
  if (!S.stats.size) return;
  let f = 0, h = 0, notes = 0, good = 0;
  for (const st of S.stats.values()) if (st.f >= 3) { notes++; f += st.f; h += st.h; if (st.h / st.f >= 0.6) good++; }
  if (notes) toast(`On pitch ${Math.round(100 * h / f)}% of the time · ${good} of ${notes} notes held within ±50 cents`, 7000);
}

/* --------------------------------------------------------------- drawing */
const cv = $('score'), g2 = cv.getContext('2d');
let W = 0, H = 0, colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['ground', 'panel', 'ink', 'muted', 'line', 'accent', 'accent-soft', 'sung', 'good', 'warn', 'bad']) colors[k] = cs.getPropertyValue('--' + k).trim();
}
function resize() {
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const alpha = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

function draw() {
  const now = nowBeat();
  tick();
  if (micStream) { if (M) measureFrame(); else micFrame(now); }
  g2.clearRect(0, 0, W, H);
  g2.fillStyle = colors.ground; g2.fillRect(0, 0, W, H);
  if (!S.song) { requestAnimationFrame(draw); return; }
  const ppb = S.zoom * (W < 560 ? 0.75 : 1);
  const gut = 46, px = Math.max(gut + 40, W * 0.28);
  const X = b => px + (b - now) * ppb;
  const ballTop = 4, ballBot = 50, chordY = 66, top = 80, bot = H - 6;
  const b0 = now - (px - gut) / ppb, b1 = now + (W - px) / ppb;

  // loop region
  if (S.loop) { g2.fillStyle = alpha(colors.accent, 0.08); g2.fillRect(X(S.loop.a), top - 4, (S.loop.b - S.loop.a) * ppb, bot - top + 4); }
  // bars, beats, chords
  g2.font = `600 13px ${getComputedStyle(document.body).fontFamily}`; g2.textBaseline = 'middle';
  for (const bar of S.song.bars) {
    if (bar.t > b1 || bar.t + bar.beats < b0) continue;
    const x = X(bar.t);
    g2.strokeStyle = alpha(colors.ink, 0.28); g2.lineWidth = 1;
    g2.beginPath(); g2.moveTo(x, top - 4); g2.lineTo(x, bot); g2.stroke();
    for (let i = 1; i < Math.round(bar.beats); i++) {
      const xb = X(bar.t + i); g2.strokeStyle = alpha(colors.ink, 0.07);
      g2.beginPath(); g2.moveTo(xb, top); g2.lineTo(xb, bot); g2.stroke();
    }
    for (let i = 0; i < Math.round(bar.beats); i++) {                    // beat ticks under the ball
      const xb = X(bar.t + i); g2.fillStyle = alpha(colors.ink, i ? 0.25 : 0.55);
      g2.fillRect(xb - (i ? 1 : 1.5), ballBot + 2, i ? 2 : 3, i ? 5 : 8);
    }
    g2.fillStyle = colors.muted; g2.font = `500 10px ${getComputedStyle(document.body).fontFamily}`;
    g2.fillText(String(bar.n) + (bar.pass > 1 ? '′'.repeat(bar.pass - 1) : ''), x + 3, bot - 7);
    g2.font = `600 14px ${getComputedStyle(document.body).fontFamily}`; g2.fillStyle = colors.ink;
    for (const c of bar.chords) g2.fillText(chordName(c.name, S.shift, S.key), X(c.t) + 3, chordY);
  }
  if (S.view === 'staff') drawStaff(X, now, top, bot, gut); else drawRoll(X, now, top, bot, gut);
  drawTrace(X, now, top, bot, b0);

  // playhead
  g2.strokeStyle = alpha(colors.accent, 0.8); g2.lineWidth = 2;
  g2.beginPath(); g2.moveTo(px, ballBot + 2); g2.lineTo(px, bot); g2.stroke();
  // bouncing ball: lands on every beat at the playhead, bigger on the downbeat
  const f = now - Math.floor(now), hgt = Math.sin(Math.PI * f) ** 0.8;
  const beatInBar = now < 0 ? Math.round(now - T.countFrom) : Math.round(Math.floor(now) - barAt(Math.max(0, Math.floor(now))).t);
  const down = beatInBar === 0;
  const r = down ? 9 : 7, by = ballBot - r - hgt * (ballBot - ballTop - 2 * r);
  const squash = f < 0.08 || f > 0.95 ? 1.25 : 1;
  g2.fillStyle = colors.accent; g2.beginPath(); g2.ellipse(px, by + (squash > 1 ? 2 : 0), r * squash, r / squash, 0, 0, Math.PI * 2); g2.fill();
  if (T.playing && now < T.countEnd && now >= T.countFrom) {             // big count-in numbers
    g2.fillStyle = alpha(colors.accent, 0.85); g2.font = `700 ${Math.min(96, (bot - top) * 0.5)}px ${getComputedStyle(document.body).fontFamily}`;
    g2.textAlign = 'center'; g2.fillText(String(Math.floor(now - T.countFrom) + 1), (px + W) / 2, (top + bot) / 2); g2.textAlign = 'left';
  }
  drawKaraoke(now);
  requestAnimationFrame(draw);
}
function noteStyle(i, n, now) {
  const active = now >= n.t && now < n.t + n.dur, past = now >= n.t + n.dur;
  const st = S.stats.get(i);
  let fill = alpha(colors.ink, 0.16), stroke = alpha(colors.ink, 0.55), text = colors.ink;
  if (active) { fill = colors.accent; stroke = colors.accent; text = colors.ground; }
  else if (past) {
    fill = alpha(colors.ink, 0.07); stroke = alpha(colors.ink, 0.25); text = colors.muted;
    if (st && st.f >= 3) { const q = st.h / st.f; const c = q >= 0.6 ? colors.good : q >= 0.3 ? colors.warn : colors.bad; fill = alpha(c, 0.35); stroke = c; }
  }
  return { fill, stroke, text, active };
}
function drawRoll(X, now, top, bot, gut) {
  const rows = S.hi - S.lo + 1, rh = (bot - top - 18) / rows;
  const Y = m => top + (S.hi - m) * rh;
  for (let m = S.lo; m <= S.hi; m++) {                    // black-key shading + C lines
    const pc = ((m % 12) + 12) % 12;
    if ([1, 3, 6, 8, 10].includes(pc)) { g2.fillStyle = alpha(colors.ink, 0.035); g2.fillRect(gut, Y(m), W - gut, rh); }
    if (m < S.myLo || m > S.myHi) { g2.fillStyle = alpha(colors.bad, 0.06); g2.fillRect(gut, Y(m), W - gut, rh); }
    if (pc === 0) { g2.strokeStyle = alpha(colors.ink, 0.12); g2.beginPath(); g2.moveTo(gut, Y(m) + rh); g2.lineTo(W, Y(m) + rh); g2.stroke(); }
  }
  const font = getComputedStyle(document.body).fontFamily;
  const ppb = X(1) - X(0);
  const lay = layoutLyrics(`roll|${ppb}|${top}|${bot}`, ppb, 1,
    (n, size) => { const y = Y(n.midi + S.shift); return [y + rh + 2, y - size - 2]; });
  S.song.notes.forEach((n, i) => {
    const x0 = X(n.t), x1 = X(n.t + n.dur);
    if (x1 < gut || x0 > W) return;
    const m = n.midi + S.shift, y = Y(m), s = noteStyle(i, n, now);
    g2.fillStyle = s.fill; g2.strokeStyle = s.stroke; g2.lineWidth = s.active ? 2 : 1;
    roundRect(x0 + 1, y + 1, Math.max(4, x1 - x0 - 3), Math.max(3, rh - 2), Math.min(5, rh / 2));
    g2.fill(); g2.stroke();
    if (x1 - x0 > 24 && rh >= 11) {
      g2.fillStyle = s.text; g2.font = `600 ${Math.min(12, rh - 2)}px ${font}`; g2.textBaseline = 'middle';
      g2.fillText(spell(m, S.key).label, x0 + 5, y + rh / 2 + 0.5);
    }
    if (n.lyric) {
      g2.fillStyle = s.active ? colors.accent : past(n, now) ? colors.muted : colors.ink;
      const L = lay[i];
      g2.font = `${s.active ? 700 : 500} ${L.size}px ${LYRIC_FONT}`; g2.textBaseline = 'top';
      g2.fillText(lyricText(n), x0 + L.dx, L.y);
    }
  });
  // key labels in the gutter
  g2.fillStyle = colors.ground; g2.fillRect(0, top - 2, gut, bot - top + 2);
  g2.font = `500 ${Math.min(11, rh)}px ${font}`; g2.textBaseline = 'middle';
  for (let m = S.lo; m <= S.hi; m++) {
    const pc = ((m % 12) + 12) % 12, black = [1, 3, 6, 8, 10].includes(pc);
    g2.fillStyle = black ? alpha(colors.ink, 0.55) : alpha(colors.ink, 0.06);
    g2.fillRect(black ? 18 : 4, Y(m) + 0.5, black ? 24 : 38, rh - 1);
    if (pc === 0 || rh >= 14) { g2.fillStyle = black ? colors.ground : colors.muted; if (!black) g2.fillText(spell(m, S.key).label, 6, Y(m) + rh / 2); }
  }
}
const past = (n, now) => now >= n.t + n.dur;

// Lyric placement: each word starts under its note; when it would run into the
// previous word, it drops to the alternate row, and only if both rows are taken
// does it shrink. Laid out in beat space once per zoom/size so words never jump
// while the score scrolls.
const LYRIC_FONT = 'Georgia, "Noto Serif", serif';
const lyricText = n => n.lyric + (n.hyphen ? '-' : '');
let lyricCache = { key: '', song: null, pos: [] };
function layoutLyrics(key, ppb, dx, rowsFor) {
  key += `|${S.shift}`;
  if (lyricCache.key === key && lyricCache.song === S.song) return lyricCache.pos;
  const pos = [], placed = [], GAP = 4;
  S.song.notes.forEach((n, i) => {
    if (!n.lyric) return;
    const x = n.t * ppb + dx;
    let pick = null;
    for (const size of [14, 12, 10.5]) {
      g2.font = `700 ${size}px ${LYRIC_FONT}`;                 // measure bold: the active word is bold
      const w = g2.measureText(lyricText(n)).width;
      for (const y of rowsFor(n, size)) {
        const hit = placed.some(b => b.x1 + GAP > x && b.x0 < x + w + GAP && Math.abs(b.y - y) < Math.max(b.size, size));
        if (!hit) { pick = { y, size, w }; break; }
      }
      if (pick) break;
    }
    if (!pick) { const y = rowsFor(n, 10.5)[0]; g2.font = `700 10.5px ${LYRIC_FONT}`; pick = { y, size: 10.5, w: g2.measureText(lyricText(n)).width }; }
    placed.push({ x0: x, x1: x + pick.w, y: pick.y, size: pick.size });
    while (placed.length > 12) placed.shift();
    pos[i] = { dx, y: pick.y, size: pick.size };
  });
  lyricCache = { key, song: S.song, pos };
  return pos;
}
function roundRect(x, y, w, h, r) { g2.beginPath(); g2.moveTo(x + r, y); g2.arcTo(x + w, y, x + w, y + h, r); g2.arcTo(x + w, y + h, x, y + h, r); g2.arcTo(x, y + h, x, y, r); g2.arcTo(x, y, x + w, y, r); g2.closePath(); }

function staffGeom(top, bot) {
  const sp = clamp((bot - top) / 15, 8, 15);
  const bottomStep = S.clef === 'treble' ? 4 * 7 + 2 : 2 * 7 + 4;     // E4 | G2
  const by = top + (bot - top) * 0.55 + 2 * sp;                        // bottom staff line
  return { sp, bottomStep, by, Y: step => by - (step - bottomStep) * sp / 2 };
}
function drawStaff(X, now, top, bot, gut) {
  const { sp, bottomStep, by, Y } = staffGeom(top, bot);
  g2.strokeStyle = alpha(colors.ink, 0.6); g2.lineWidth = 1;
  for (let l = 0; l < 5; l++) { const y = by - l * sp; g2.beginPath(); g2.moveTo(0, y); g2.lineTo(W, y); g2.stroke(); }
  const rowA = Math.min(bot - 34, by + 2.8 * sp), rowB = rowA + 17;      // just below stems / low ledgers
  const ppb = X(1) - X(0);
  const lay = layoutLyrics(`staff|${ppb}|${top}|${bot}`, ppb, sp * 0.3, () => [rowA, rowB]);
  S.song.notes.forEach((n, i) => {
    const x0 = X(n.t), x1 = X(n.t + n.dur);
    if (x1 < gut || x0 > W + 20) return;
    const m = n.midi + S.shift, sn = spell(m, S.key), y = Y(sn.step), s = noteStyle(i, n, now);
    const hx = x0 + sp * 0.9;
    // ledger lines
    g2.strokeStyle = alpha(colors.ink, 0.6); g2.lineWidth = 1;
    for (let st = bottomStep - 2; st >= sn.step; st -= 2) { const yy = Y(st); g2.beginPath(); g2.moveTo(hx - sp, yy); g2.lineTo(hx + sp, yy); g2.stroke(); }
    for (let st = bottomStep + 10; st <= sn.step; st += 2) { const yy = Y(st); g2.beginPath(); g2.moveTo(hx - sp, yy); g2.lineTo(hx + sp, yy); g2.stroke(); }
    // duration tail: how long to hold
    g2.fillStyle = s.active ? alpha(colors.accent, 0.45) : alpha(colors.ink, past(n, now) ? 0.08 : 0.14);
    g2.fillRect(hx, y - sp * 0.18, Math.max(0, x1 - hx - 3), sp * 0.36);
    // head
    const col = s.active ? colors.accent : past(n, now) && S.stats.get(i)?.f >= 3 ? s.stroke : past(n, now) ? alpha(colors.ink, 0.45) : colors.ink;
    g2.fillStyle = col; g2.strokeStyle = col; g2.lineWidth = 1.6;
    g2.beginPath(); g2.ellipse(hx, y, sp * 0.62, sp * 0.44, -0.35, 0, Math.PI * 2);
    if (n.dur >= 2) g2.stroke(); else g2.fill();
    if (n.dur < 4) {                                                   // stem + flags
      const up = sn.step < bottomStep + 4, sx = up ? hx + sp * 0.58 : hx - sp * 0.58, sy = up ? y - 3.4 * sp : y + 3.4 * sp;
      g2.lineWidth = 1.3; g2.beginPath(); g2.moveTo(sx, y); g2.lineTo(sx, sy); g2.stroke();
      const flags = n.dur < 0.375 ? 2 : n.dur < 0.75 ? 1 : 0;
      for (let k = 0; k < flags; k++) {
        const fy = sy + (up ? 1 : -1) * k * sp * 0.8;
        g2.beginPath(); g2.moveTo(sx, fy); g2.quadraticCurveTo(sx + sp, fy + (up ? 1 : -1) * sp, sx + sp * 0.8, fy + (up ? 2 : -2) * sp); g2.stroke();
      }
    }
    if (sn.showAcc) { g2.font = `${sp * 1.6}px "Noto Music", "Segoe UI Symbol", serif`; g2.textBaseline = 'middle'; g2.fillText(sn.showAcc, hx - sp * 1.9, y); }
    if (n.lyric) {
      g2.fillStyle = s.active ? colors.accent : past(n, now) ? colors.muted : colors.ink;
      const L = lay[i];
      g2.font = `${s.active ? 700 : 500} ${L.size}px ${LYRIC_FONT}`; g2.textBaseline = 'top';
      g2.fillText(lyricText(n), x0 + L.dx, L.y);
    }
  });
  // clef + key signature, pinned at the left
  const kw = gut + 18 + Math.abs(S.key.fifths) * sp * 0.8;
  g2.fillStyle = colors.ground; g2.fillRect(0, by - 6 * sp, kw, 8 * sp);
  g2.strokeStyle = alpha(colors.ink, 0.6); g2.lineWidth = 1;
  for (let l = 0; l < 5; l++) { const y = by - l * sp; g2.beginPath(); g2.moveTo(0, y); g2.lineTo(kw, y); g2.stroke(); }
  g2.fillStyle = colors.ink; g2.textBaseline = 'alphabetic';
  if (S.clef === 'treble') { g2.font = `${sp * 4.6}px "Noto Music", "Segoe UI Symbol", "Apple Symbols", serif`; g2.fillText('𝄞', 4, by + sp * 0.9); }
  else { g2.font = `${sp * 3.4}px "Noto Music", "Segoe UI Symbol", "Apple Symbols", serif`; g2.fillText('𝄢', 4, by - sp * 0.9); }
  const sharpSteps = S.clef === 'treble' ? [38, 35, 39, 36, 33, 37, 34] : [24, 21, 25, 22, 19, 23, 20];
  const flatSteps = S.clef === 'treble' ? [34, 37, 33, 36, 32, 35, 31] : [20, 23, 19, 22, 18, 21, 17];
  g2.font = `${sp * 2}px "Noto Music", "Segoe UI Symbol", serif`; g2.textBaseline = 'middle';
  const ks = S.key.fifths > 0 ? sharpSteps.slice(0, S.key.fifths) : flatSteps.slice(0, -S.key.fifths);
  ks.forEach((st, k) => g2.fillText(S.key.fifths > 0 ? '♯' : '♭', gut + 6 + k * sp * 0.8, Y(st) - (S.key.fifths > 0 ? 0 : sp * 0.25)));
}
function drawTrace(X, now, top, bot, b0) {
  if (!S.trace.length) return;
  let Y;
  if (S.view === 'staff') {
    const { Y: sy } = staffGeom(top, bot);
    Y = m => { const lo = Math.floor(m), fr = m - lo, a = spell(lo, S.key).step, b = spell(lo + 1, S.key).step; return sy(a + (b - a) * fr); };
  } else {
    const rh = (bot - top - 18) / (S.hi - S.lo + 1);
    Y = m => top + (S.hi - m) * rh + rh / 2;
  }
  g2.strokeStyle = colors.sung; g2.lineWidth = 3; g2.lineJoin = 'round'; g2.lineCap = 'round';
  g2.beginPath(); let pen = false, lastB = -1;
  for (const p of S.trace) {
    if (p.b < b0 - 1 || p.b > now + 0.05) { pen = false; continue; }
    if (p.m == null || p.b - lastB > 0.25) pen = false;
    if (p.m == null) { lastB = p.b; continue; }
    const x = X(p.b), y = clamp(Y(p.m), top - 6, bot);
    if (pen) g2.lineTo(x, y); else g2.moveTo(x, y);
    pen = true; lastB = p.b;
  }
  g2.stroke();
}

/* ---------------------------------------------------------------- karaoke */
let renderedLine = -2;
function lineIndexAt(now) {
  const L = S.lines; let k = 0;
  for (let i = 0; i < L.length; i++) if (L[i].start - 1.0 <= now) k = i;   // show a line a beat early
  if (L[k] && now > L[k].end + 0.5 && k + 1 < L.length && L[k + 1].start - now < 4) k++;
  return k;
}
function lineHtml(li) {
  const L = S.lines[li]; if (!L) return '';
  return L.idx.filter(i => !S.song.notes[i].melisma).map(i => { const n = S.song.notes[i];
    return `<span class="syl" data-i="${i}">${esc(n.lyric)}${n.hyphen ? '-' : ' '}</span>`; }).join('');
}
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function drawKaraoke(now) {
  if (!S.lines.length) return;
  const li = lineIndexAt(now);
  if (li !== renderedLine) { $('kcur').innerHTML = lineHtml(li); $('knext').innerHTML = lineHtml(li + 1); renderedLine = li; }
  for (const el of $('kcur').children) {
    const n = S.song.notes[+el.dataset.i];
    // a syllable stays lit through its melisma notes
    let end = n.t + n.dur; for (let j = +el.dataset.i + 1; j < S.song.notes.length && S.song.notes[j].melisma; j++) end = S.song.notes[j].t + S.song.notes[j].dur;
    el.classList.toggle('now', now >= n.t && now < end);
    el.classList.toggle('done', now >= end);
  }
}

/* ---------------------------------------------------------------- library */
const DB = { db: null };
function idb() {
  if (DB.db) return Promise.resolve(DB.db);
  return new Promise((res, rej) => {
    let rq; try { rq = indexedDB.open('songline', 1); } catch (e) { rej(e); return; }
    rq.onupgradeneeded = () => rq.result.createObjectStore('songs', { keyPath: 'id' });
    rq.onsuccess = () => { DB.db = rq.result; res(DB.db); };
    rq.onerror = () => rej(rq.error);
  });
}
async function dbAll() { try { const db = await idb(); return await new Promise((res, rej) => { const r = db.transaction('songs').objectStore('songs').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); } catch { return []; } }
async function dbPut(rec) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').put(rec); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function dbDel(id) { const db = await idb(); return new Promise(res => { const t = db.transaction('songs', 'readwrite'); t.objectStore('songs').delete(id); t.oncomplete = res; }); }
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

let demo = null;
async function showLibrary() {
  const ul = $('songList'); ul.innerHTML = '';
  const add = (label, sub, onOpen, onDel) => {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.className = 'song'; b.textContent = label;
    if (sub) { const s = document.createElement('span'); s.style.cssText = 'display:block;font-weight:400;color:var(--muted);font-size:12px;margin-top:4px'; s.textContent = sub; b.append(s); }
    b.onclick = onOpen; li.append(b);
    if (onDel) { const d = document.createElement('button'); d.textContent = 'Remove'; d.onclick = onDel; li.append(d); }
    ul.append(li);
  };
  const saved = await dbAll();
  for (const r of saved) add(r.song.title, (r.song.artist || '') + ' · on this device', () => { openSong(r.song, r.id); closeLibrary(); },
    async () => { await dbDel(r.id); showLibrary(); });
  // songs offered by the home server this page came from (if any)
  try {
    const r = await fetch('songs/index.json', { cache: 'no-store' });
    if (r.ok) for (const it of await r.json()) if (!saved.some(s => s.id === slug(it.title)) && !(demo && it.title === demo.title)) add(it.title, 'tap to keep on this device', async () => {
      try { const sr = await fetch('songs/' + encodeURIComponent(it.file), { cache: 'no-store' });
        if (!sr.ok) throw new Error(`HTTP ${sr.status}`); await keepSong(await sr.json()); closeLibrary(); }
      catch (e) { toast(`Couldn't fetch ${it.title}: ${e.message}`); }
    });
  } catch { /* no server list: fine */ }
  if (demo) add(demo.title, 'built-in demo · public domain', () => { openSong(demo, 'demo'); closeLibrary(); });
  $('library').hidden = false;
}
const closeLibrary = () => { $('library').hidden = true; };
// Songs kept from the server get refreshed when the server has a newer copy
// (e.g. a corrected transcription), so fixes reach the phone without re-adding.
async function refreshServerSongs() {
  let list;
  try { const r = await fetch('songs/index.json', { cache: 'no-store' }); if (!r.ok) return; list = await r.json(); }
  catch { return; }                                // offline: keep the device copies
  const saved = await dbAll();
  for (const it of list) {
    const rec = saved.find(s => s.id === slug(it.title)); if (!rec) continue;
    try {
      const sr = await fetch('songs/' + encodeURIComponent(it.file), { cache: 'no-store' }); if (!sr.ok) continue;
      const song = await sr.json();
      if (JSON.stringify(song) === JSON.stringify(rec.song)) continue;
      await dbPut({ id: rec.id, song, added: rec.added });
      if (S.songId === rec.id && !T.playing) openSong(song, rec.id);
      toast(`${song.title} was updated.`);
    } catch { /* leave the device copy alone */ }
  }
}
async function keepSong(song) {
  const id = slug(song.title || 'song');
  openSong(song, id);                              // validates first
  try { await dbPut({ id, song, added: Date.now() }); toast(`${song.title} is saved on this device.`); }
  catch { toast(`${song.title} is open, but this browser won't store it. Load the file again next time.`); }
}
async function loadFile(file) {
  try { await keepSong(JSON.parse(await file.text())); closeLibrary(); }
  catch (e) { toast(e instanceof SyntaxError ? `${file.name} isn't valid JSON.` : e.message); }
}

/* ----------------------------------------------------------------- toasts */
let toastTimer = null;
function toast(text, ms = 4500) { const m = $('msg'); m.textContent = text; m.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, ms); }
function hideToast() { $('msg').hidden = true; }

/* --------------------------------------------------------------- controls */
function bindToggle(id, key, onChange) {
  const b = $(id); b.setAttribute('aria-pressed', String(S[key]));
  b.onclick = () => { S[key] = !S[key]; b.setAttribute('aria-pressed', String(S[key])); store.set(key, S[key]); onChange && onChange(); };
}
function bindRange(id, outId, get, set, fmt) {
  const el = $(id); el.value = get(); $(outId).textContent = fmt(get());
  el.oninput = () => { set(+el.value); $(outId).textContent = fmt(+el.value); };
}
function setup() {
  readColors();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  resize(); addEventListener('resize', resize);

  $('play').onclick = () => { if (!S.song) return; T.playing ? pause() : start(T.beat >= S.song.totalBeats ? 0 : T.beat); };
  $('restart').onclick = () => { S.stats = new Map(); S.trace = []; seek(S.loop ? S.loop.a : 0, true); if (!T.playing) T.beat = S.loop ? S.loop.a : 0; };
  $('viewBtn').textContent = S.view === 'roll' ? 'Staff' : 'Piano roll';
  $('viewBtn').onclick = () => { S.view = S.view === 'roll' ? 'staff' : 'roll'; store.set('view', S.view); $('viewBtn').textContent = S.view === 'roll' ? 'Staff' : 'Piano roll'; };
  $('moreBtn').onclick = () => { const m = $('more'); m.hidden = !m.hidden; $('moreBtn').setAttribute('aria-expanded', String(!m.hidden)); resize(); };
  $('loopBtn').onclick = () => {
    if (S.loop) { S.loop = null; $('loopBtn').setAttribute('aria-pressed', 'false'); return; }
    const L = S.lines[lineIndexAt(nowBeat())]; if (!L) return;
    const a = barAt(L.start).t, endBar = barAt(Math.max(L.start, L.end - 0.01));
    S.loop = { a, b: endBar.t + endBar.beats };
    $('loopBtn').setAttribute('aria-pressed', 'true');
    if (!T.playing) T.beat = a;
  };
  $('micBtn').onclick = async () => {
    if (micStream) { micOff(); $('micBtn').setAttribute('aria-pressed', 'false'); return; }
    if (await micOn()) $('micBtn').setAttribute('aria-pressed', 'true');
  };
  bindRange('tempo', 'tempoOut', () => S.tempoPct, v => { retime(); S.tempoPct = v; if (T.playing) { T.anchorTime = ctx.currentTime; } store.set('tempo.' + S.songId, v); },
    () => Math.round(bpm()) + ' bpm');
  $('tempo').addEventListener('input', () => { $('tempoOut').textContent = Math.round(bpm()) + ' bpm'; });
  const tr = $('transpose'); tr.value = S.shift;
  tr.oninput = () => { S.shift = +tr.value; store.set('transpose', S.shift); if (S.song) { prepare(); retime(); } };
  bindRange('guideVol', 'guideOut', () => S.guide, v => { S.guide = v; store.set('guide', v); setBusGains(); }, v => v ? v + '%' : 'off');
  bindRange('chordVol', 'chordOut', () => S.chords, v => { S.chords = v; store.set('chords', v); setBusGains(); }, v => v ? v + '%' : 'off');
  bindRange('zoom', 'zoomOut', () => S.zoom, v => { S.zoom = v; store.set('zoom', v); }, v => v + '%');
  $('fitBtn').onclick = () => {
    if (!S.song) return;
    S.shift = fitShift(); tr.value = S.shift; store.set('transpose', S.shift); prepare(); retime();
  };
  const vs = $('voiceSel');
  vs.innerHTML = '<option value="">Custom</option>' + VOICES.map(([n]) => `<option>${n}</option>`).join('');
  vs.onchange = () => {
    const v = VOICES.find(([n]) => n === vs.value); if (!v) return;
    setMyRange(v[1], v[2]);
  };
  const rangeOpts = [];
  for (let m = RANGE_MIN; m <= RANGE_MAX; m++) rangeOpts.push(m);
  for (const [id, k] of [['myLoSel', 'myLo'], ['myHiSel', 'myHi']]) {
    const sel = $(id);
    sel.innerHTML = rangeOpts.map(m => `<option value="${m}">${plainName(m)}</option>`).join('');
    sel.value = S[k];
    sel.onchange = () => {
      S[k] = +sel.value; setMyRange(S.myLo, S.myHi);
    };
  }
  syncVoice();
  $('measureBtn').onclick = startMeasure;
  $('measureBtn2').onclick = startMeasure;
  $('mNext').onclick = nextMeasure;
  $('mCancel').onclick = endMeasure;
  bindToggle('clickBtn', 'click'); bindToggle('countBtn', 'countIn'); bindToggle('octBtn', 'anyOct');

  // tap to jump, drag to scrub
  let drag = null;
  cv.addEventListener('pointerdown', e => { if (!S.song) return; drag = { x: e.clientX, beat: nowBeat(), moved: false, was: T.playing }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; if (T.playing) pause(); }
    if (drag.moved) T.beat = clamp(drag.beat - dx / (S.zoom * (W < 560 ? 0.75 : 1)), 0, S.song.totalBeats);
  });
  cv.addEventListener('pointerup', e => {
    if (!drag) return;
    if (!drag.moved) { const ppb = S.zoom * (W < 560 ? 0.75 : 1), px = Math.max(86, W * 0.28);
      const target = barAt(clamp(nowBeat() + (e.offsetX - px) / ppb, 0, S.song.totalBeats)).t; seek(target, false); }
    else if (drag.was) start(T.beat, false);
    drag = null;
  });
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (M) { if (e.key === 'Escape') endMeasure(); return; }
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
    else if (e.key === 'l' || e.key === 'L') $('loopBtn').click();
    else if (e.key === 'Home') $('restart').click();
  });

  $('libBtn').onclick = showLibrary; $('libClose').onclick = closeLibrary;
  $('fileIn').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
  addEventListener('dragover', e => { e.preventDefault(); $('drop').hidden = false; });
  addEventListener('dragleave', e => { if (!e.relatedTarget) $('drop').hidden = true; });
  addEventListener('drop', e => { e.preventDefault(); $('drop').hidden = true; const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && T.playing) pause(); });

  requestAnimationFrame(draw);
}

async function boot() {
  setup();
  try { const r = await fetch('demo.json'); if (r.ok) demo = await r.json(); } catch { /* offline first run */ }
  const last = store.get('lastSong', null), saved = await dbAll();
  const rec = saved.find(s => s.id === last);
  if (rec) openSong(rec.song, rec.id);
  else if (demo) openSong(demo, 'demo');
  else showLibrary();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  refreshServerSongs();
}

// Chrome offers install through this event once the page meets its criteria;
// surface it as a button so nobody has to find the menu entry.
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = false; });
addEventListener('appinstalled', () => { installEvt = null; $('installBtn').hidden = true; });
$('installBtn').addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null; $('installBtn').hidden = true;
});
boot();
