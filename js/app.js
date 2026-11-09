import { TUNINGS, NOTE_NAMES, getTuning, noteName, noteOctave, midiToLabel, midiToFreq, freqToMidi, matchTuning } from './tunings.js';
import { PitchDetector } from './tuner.js';
import { GENRES, generateRiff } from './riff.js';
import { STYLES, parseStyleQuery, trainModel, generateRiff as aiRiff, varyRiff, collectSongs, MODEL_VERSION, tuningLabel } from './riffai.js';
import { bundleToTex } from './songsterr.js';
import { installAmpHook, setAmp, AMP, loadAmpPrefs, saveAmpPrefs } from './amp.js';
import { store, getApiBase, setApiBase, searchSongs, fetchTab, favorites, history } from './data.js';

installAmpHook(); window.__AMP = AMP; window.__setAmp = setAmp;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ---------- Telegram Mini App ---------- */
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor && tg.setHeaderColor('#1b1613');
    tg.setBackgroundColor && tg.setBackgroundColor('#1b1613');
    tg.disableVerticalSwipes && tg.disableVerticalSwipes();
  } catch {}
}

/* ---------- Toast и шторка ---------- */
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

function openSheet(title, build) {
  $('#sheet-title').textContent = title;
  const body = $('#sheet-body');
  body.innerHTML = '';
  build(body);
  $('#sheet').classList.remove('hidden');
  $('#sheet-bg').classList.remove('hidden');
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#sheet-bg').classList.add('hidden');
}
$('#sheet-bg').addEventListener('click', closeSheet);

/* ---------- Навигация ---------- */
let currentView = 'tuner';
function showView(name) {
  if (currentView === 'tuner' && name !== 'tuner') stopListening();
  currentView = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  if (name === 'songs') renderSongs();
}
$$('#tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

/* ---------- Выбор строя (общий) ---------- */
function pickTuning({ title, current, includeAuto, includeCustom, onPick }) {
  openSheet(title, (body) => {
    const add = (id, name, sub) => {
      const b = document.createElement('button');
      b.className = 'opt' + (id === current ? ' on' : '');
      b.innerHTML = `<span>${esc(name)}</span><small>${esc(sub || '')}</small>`;
      b.onclick = () => {
        closeSheet();
        onPick(id);
      };
      body.append(b);
    };
    if (includeAuto) add('auto', 'Как в жанре', '');
    TUNINGS.forEach((t) => add(t.id, t.name, [...t.notes].map(noteName).join(' ')));
    if (includeCustom) add('custom', 'Свой строй…', '');
  });
}

/* ================= ТЮНЕР ================= */
const saved = store.get('tuner', {});
const tuner = {
  tuningId: saved.tuningId || 'std',
  custom: saved.custom || [40, 45, 50, 55, 59, 64],
  a4: saved.a4 || 440,
  gauge: saved.gauge === 'arc' ? 'arc' : 'line',
  mode: 'strings',
  locked: null,
  tuned: new Set(),
  listening: false,
  hist: [],
  okFrames: 0,
  lastSignal: 0,
  angle: 0,
  targetAngle: 0,
};
const saveTuner = () => store.set('tuner', { tuningId: tuner.tuningId, custom: tuner.custom, a4: tuner.a4, gauge: tuner.gauge });
const tunerNotes = () => (tuner.tuningId === 'custom' ? tuner.custom : getTuning(tuner.tuningId).notes);

// Шкала
(function buildGauge() {
  const pt = (deg, r) => [150 + r * Math.sin((deg * Math.PI) / 180), 150 - r * Math.cos((deg * Math.PI) / 180)];
  const [x1, y1] = pt(-60, 120);
  const [x2, y2] = pt(60, 120);
  $('#gauge-arc').setAttribute('d', `M ${x1} ${y1} A 120 120 0 0 1 ${x2} ${y2}`);
  const [zx1, zy1] = pt(-6, 120);
  const [zx2, zy2] = pt(6, 120);
  $('#gauge-zone').setAttribute('d', `M ${zx1} ${zy1} A 120 120 0 0 1 ${zx2} ${zy2}`);
  const g = $('#gauge-ticks');
  for (let c = -50; c <= 50; c += 10) {
    const mid = c === 0;
    const [ax, ay] = pt(c * 1.2, mid ? 126 : 128);
    const [bx, by] = pt(c * 1.2, mid ? 142 : 136);
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', ax); l.setAttribute('y1', ay); l.setAttribute('x2', bx); l.setAttribute('y2', by);
    l.setAttribute('class', 'g-tick' + (mid ? ' mid' : ''));
    g.append(l);
  }
  const labels = $$('#gauge .g-label');
  labels[0].setAttribute('x', 38); labels[0].setAttribute('y', 118);
  labels[1].setAttribute('x', 262); labels[1].setAttribute('y', 118);
  const gl = $('#gl-ticks');
  for (let c = -50; c <= 50; c += 5) {
    const x = 160 + c * 2.6, mid = c === 0, big = c % 10 === 0;
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x); l.setAttribute('x2', x);
    l.setAttribute('y1', mid ? 10 : big ? 18 : 23); l.setAttribute('y2', mid ? 46 : big ? 38 : 33);
    l.setAttribute('class', 'gl-tick' + (mid ? ' mid' : ''));
    gl.append(l);
  }
})();
const GAUGE_ICONS = {
  arc: '<svg viewBox="0 0 24 24" class="ic"><path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l3-4"/></svg>',
  line: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 12h18"/><path d="M6 9v6M18 9v6M12 6v12"/></svg>',
};
function applyGaugeStyle() {
  const st = tuner.gauge;
  $('.gauge-wrap').dataset.style = st;
  // на кнопке показываем другой вариант — тот, на который переключит нажатие
  $('#btn-gauge').innerHTML = GAUGE_ICONS[st === 'arc' ? 'line' : 'arc'];
  $('#btn-gauge').title = st === 'arc' ? 'Показать линейку' : 'Показать дугу';
}
$('#btn-gauge').onclick = () => { tuner.gauge = tuner.gauge === 'arc' ? 'line' : 'arc'; saveTuner(); applyGaugeStyle(); };
function setNeedleLive(on) { $('#needle').classList.toggle('live', on); $('#gl-marker').classList.toggle('live', on); }
function drawNeedle() {
  $('#needle').setAttribute('transform', `rotate(${tuner.angle.toFixed(2)} 150 150)`);
  $('#gl-marker').setAttribute('transform', `translate(${((tuner.angle / 1.2) * 2.6).toFixed(2)} 0)`);
}

function renderStrings() {
  const notes = tunerNotes();
  const box = $('#strings');
  box.innerHTML = '';
  const hidden = tuner.mode === 'chromatic';
  box.style.display = hidden ? 'none' : '';
  $('#tuned-count').style.display = hidden ? 'none' : '';
  notes.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'str' + (tuner.locked === i ? ' locked' : '') + (tuner.tuned.has(i) ? ' done' : '');
    b.dataset.i = i;
    b.style.setProperty('--w', (1.3 + (notes.length - 1 - i) * 0.55).toFixed(2) + 'px');
    b.setAttribute('aria-label', `${notes.length - i}-я струна, ${midiToLabel(m)}`);
    b.innerHTML = `<i class="wire"></i><b>${noteName(m)}</b><small>${notes.length - i}</small>`;
    b.onclick = () => {
      tuner.locked = tuner.locked === i ? null : i;
      renderStrings();
      if (tuner.locked != null) toast(`Ловлю только ${notes.length - i}-ю струну (${midiToLabel(m)}). Нажми ещё раз, чтобы снять`);
    };
    box.append(b);
  });
  $('#tuned-count').textContent = `Настроено ${tuner.tuned.size} из ${notes.length}`;
  $('#tuning-name').textContent = tuner.tuningId === 'custom' ? 'Свой строй' : getTuning(tuner.tuningId).name;
}

function setLiveActive(idx) {
  $$('#strings .str').forEach((el) => el.classList.toggle('active', Number(el.dataset.i) === idx));
}

function resetTuned() {
  tuner.tuned = new Set();
  tuner.locked = null;
  tuner.okFrames = 0;
  renderStrings();
}

$('#btn-tuning').onclick = () =>
  pickTuning({
    title: 'Строй',
    current: tuner.tuningId,
    includeCustom: true,
    onPick: (id) => {
      if (id === 'custom') return editCustomTuning();
      tuner.tuningId = id;
      saveTuner();
      resetTuned();
    },
  });

function editCustomTuning() {
  let work = [...tuner.custom];
  const draw = (body) => {
    body.innerHTML = '';
    const seg = document.createElement('div');
    seg.className = 'chipgroup';
    seg.style.marginBottom = '12px';
    [6, 7].forEach((n) => {
      const b = document.createElement('button');
      b.textContent = n + ' струн';
      if (work.length === n) b.className = 'on';
      b.onclick = () => {
        if (n === 7 && work.length === 6) work = [work[0] - 5, ...work];
        if (n === 6 && work.length === 7) work = work.slice(1);
        draw(body);
      };
      seg.append(b);
    });
    body.append(seg);
    work.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'tun-row';
      const nSel = document.createElement('select');
      NOTE_NAMES.forEach((n, k) => nSel.add(new Option(n, k)));
      nSel.value = ((m % 12) + 12) % 12;
      const oSel = document.createElement('select');
      for (let o = 0; o <= 6; o++) oSel.add(new Option(o, o));
      oSel.value = noteOctave(m);
      const upd = () => (work[i] = (Number(oSel.value) + 1) * 12 + Number(nSel.value));
      nSel.onchange = upd;
      oSel.onchange = upd;
      row.innerHTML = `<span>${work.length - i}</span>`;
      row.append(nSel, oSel);
      body.append(row);
    });
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = 'Готово';
    ok.onclick = () => {
      tuner.custom = [...work].sort((a, b) => a - b);
      tuner.tuningId = 'custom';
      saveTuner();
      resetTuned();
      closeSheet();
    };
    body.append(ok);
  };
  openSheet('Свой строй (снизу вверх)', draw);
}

$$('#tuner-mode button').forEach((b) =>
  b.addEventListener('click', () => {
    tuner.mode = b.dataset.mode;
    $$('#tuner-mode button').forEach((x) => x.classList.toggle('on', x === b));
    renderStrings();
  })
);

// Камертон A4 — по долгому нажатию на частоту
let a4Press;
$('#note-hz').addEventListener('click', () =>
  openSheet('Камертон', (body) => {
    const draw = () => {
      body.innerHTML = `<div class="stepper"><div>A4 = <b>${tuner.a4} Гц</b></div><div class="ctrls"><button class="mini" id="a4m">−</button><button class="mini" id="a4p">+</button></div></div>`;
      $('#a4m', body).onclick = () => { tuner.a4 = Math.max(415, tuner.a4 - 1); saveTuner(); draw(); };
      $('#a4p', body).onclick = () => { tuner.a4 = Math.min(466, tuner.a4 + 1); saveTuner(); draw(); };
    };
    draw();
  })
);

const median = (arr) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
const gaugeWrap = $('.gauge-wrap');
applyGaugeStyle();

function onPitch(freq, clarity) {
  if (clarity < 0.8) return onSilence();
  tuner.hist.push(freq);
  if (tuner.hist.length > 5) tuner.hist.shift();
  const f = median(tuner.hist);
  tuner.lastSignal = performance.now();
  const midi = freqToMidi(f, tuner.a4);
  let tMidi, idx = -1;
  if (tuner.mode === 'chromatic') {
    tMidi = Math.round(midi);
  } else {
    const notes = tunerNotes();
    if (tuner.locked != null) idx = tuner.locked;
    else {
      let best = 1e9;
      notes.forEach((n, i) => {
        const d = Math.abs(midi - n);
        if (d < best) { best = d; idx = i; }
      });
    }
    tMidi = notes[idx];
  }
  const cents = (midi - tMidi) * 100;
  const inTune = Math.abs(cents) <= 5;
  tuner.targetAngle = Math.max(-50, Math.min(50, cents)) * 1.2;
  setNeedleLive(true);
  gaugeWrap.classList.toggle('in-tune', inTune);
  $('#note-big').textContent = noteName(tMidi) + noteOctave(tMidi); $('#note-big').classList.remove('idle');
  $('#note-hz').textContent = `${f.toFixed(1)} Гц · ${cents >= 0 ? '+' : ''}${Math.round(cents)} цент`;
  const hint = $('#note-hint');
  hint.className = 'hint ' + (inTune ? '' : cents < 0 ? 'up' : 'down');
  hint.textContent = inTune ? 'В строю' : cents < 0 ? 'Подтяни ↑' : 'Ослабь ↓';
  setLiveActive(idx);
  if (inTune && idx >= 0) {
    if (++tuner.okFrames >= 8 && !tuner.tuned.has(idx)) {
      tuner.tuned.add(idx);
      renderStrings();
      setLiveActive(idx);
    }
  } else tuner.okFrames = 0;
}

function onSilence() {
  if (performance.now() - tuner.lastSignal > 1000) {
    tuner.targetAngle = 0;
    tuner.hist = [];
    setNeedleLive(false);
    gaugeWrap.classList.remove('in-tune');
    $('#note-hint').textContent = ' ';
    $('#note-hint').className = 'hint';
    $('#note-big').textContent = '—'; $('#note-big').classList.add('idle');
    $('#note-hz').textContent = 'Сыграй открытую струну';
    setLiveActive(-1);
  }
}

const detector = new PitchDetector({ onPitch, onSilence });

let rafOn = false;
function animateNeedle() {
  if (!tuner.listening) { rafOn = false; return; }
  tuner.angle += (tuner.targetAngle - tuner.angle) * 0.22;
  drawNeedle();
  requestAnimationFrame(animateNeedle);
}

async function startListening() {
  if (tuner.listening) return;
  if (!window.isSecureContext) {
    toast('Для микрофона нужен https (GitHub Pages подойдёт)', 4000);
    return;
  }
  try {
    await detector.start();
  } catch (e) {
    toast('Нет доступа к микрофону. Разрешите его в настройках браузера или Telegram', 4500);
    return;
  }
  tuner.listening = true;
  tuner.lastSignal = 0;
  const b = $('#btn-listen');
  b.textContent = 'Хватит слушать';
  b.classList.add('on');
  if (!rafOn) { rafOn = true; animateNeedle(); }
}
function stopListening() {
  if (!tuner.listening) return;
  detector.stop();
  tuner.listening = false;
  const b = $('#btn-listen');
  b.textContent = 'Слушать';
  b.classList.remove('on');
  tuner.targetAngle = 0;
  tuner.hist = [];
  tuner.angle = 0; drawNeedle();
  setNeedleLive(false);
  gaugeWrap.classList.remove('in-tune');
  $('#note-big').textContent = '—'; $('#note-big').classList.add('idle');
  $('#note-hz').textContent = 'Сыграй открытую струну';
  $('#note-hint').textContent = ' ';
  setLiveActive(-1);
}
$('#btn-listen').onclick = () => (tuner.listening ? stopListening() : startListening());
document.addEventListener('visibilitychange', () => { if (document.hidden) stopListening(); });
renderStrings();

/* ================= ПЕСНИ ================= */
function songRow(song, extra) {
  const b = document.createElement('button');
  b.className = 'song';
  const letter = (song.artist || song.title || '?').trim().charAt(0).toUpperCase();
  b.innerHTML = `<span class="mono">${esc(letter)}</span><div class="meta"><div class="t">${esc(song.title)}</div><div class="a">${esc(song.artist || '')}${extra ? ' · ' + esc(extra) : ''}</div></div><span class="go">›</span>`;
  b.onclick = () => openSong(song);
  return b;
}

function noApiBox() {
  const d = document.createElement('div');
  d.className = 'note-box';
  d.innerHTML = `<b>Поиск Songsterr не подключён.</b><br>Вставь адрес своего воркера Cloudflare — инструкция в README. А пока можно открыть свой файл Guitar Pro или сгенерировать рифф.`;
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.style.marginTop = '12px';
  btn.textContent = 'Указать адрес';
  btn.onclick = openSettings;
  d.append(btn);
  return d;
}

function section(title, list) {
  const frag = document.createDocumentFragment();
  if (!list.length) return frag;
  const l = document.createElement('div');
  l.className = 'label';
  l.textContent = title;
  frag.append(l);
  list.forEach((s) => frag.append(songRow(s)));
  return frag;
}

let songsTab = 'fav';
function renderSongs() {
  if ($('#search-input').value.trim()) return;
  $('#songs-seg').classList.remove('hidden');
  const box = $('#songs-content');
  box.innerHTML = '';
  if (!getApiBase()) box.append(noApiBox());
  const list = songsTab === 'fav' ? favorites.list() : history.list().slice(0, 30);
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'empty-list';
    e.textContent = songsTab === 'fav' ? 'Здесь будут песни с сердечком. Нажми ♥ в плеере, чтобы добавить.' : 'Здесь появятся песни, которые ты открывал.';
    box.append(e);
  }
  list.forEach((s) => box.append(songRow(s)));
}
$$('#songs-seg button').forEach((b) => b.addEventListener('click', () => {
  songsTab = b.dataset.tab;
  $$('#songs-seg button').forEach((x) => x.classList.toggle('on', x === b));
  renderSongs();
}));

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  $('#search-input').blur();
  const box = $('#songs-content');
  if (!q) return renderSongs();
  if (!getApiBase()) { box.innerHTML = ''; box.append(noApiBox()); return; }
  $('#songs-seg').classList.add('hidden');
  box.innerHTML = '<div class="spinner-line">Ищу…</div>';
  try {
    const res = await searchSongs(q);
    box.innerHTML = '';
    if (!res.length) box.innerHTML = '<div class="spinner-line">Ничего не нашлось</div>';
    res.forEach((s) => box.append(songRow(s, (s.tracks || []).slice(0, 3).join(', '))));
  } catch (err) {
    box.innerHTML = `<div class="note-box"><b>Не получилось найти.</b><br>${esc(err.message)}<br>Проверьте адрес воркера в настройках.</div>`;
  }
});
$('#search-input').addEventListener('input', (e) => { if (!e.target.value) renderSongs(); });

function openSettings() {
  openSheet('Настройки', (body) => {
    body.innerHTML = `<div class="label" style="margin-top:0">Адрес воркера Cloudflare — через него идёт поиск Songsterr</div>
      <input id="api-input" class="field" type="url" inputmode="url" placeholder="https://guitar-proxy.xxx.workers.dev" value="${esc(getApiBase())}">
      <button class="primary" id="api-save">Сохранить</button>
      <button class="ghost" id="hist-clear">Очистить недавние</button>`;
    $('#api-save', body).onclick = () => { setApiBase($('#api-input', body).value); closeSheet(); toast('Сохранено'); renderSongs(); similarCache = {}; };
    $('#hist-clear', body).onclick = () => { history.clear(); closeSheet(); renderSongs(); };
  });
}
$('#btn-settings').onclick = openSettings;

$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const name = f.name.replace(/\.[^.]+$/, '');
  if (/\.tex$/i.test(f.name)) return loadTex(await f.text(), { title: name, artist: 'Файл alphaTex' });
  loadScore(new Uint8Array(await f.arrayBuffer()), { id: null, title: name, artist: 'Свой файл' });
});

async function openSong(song) {
  showView('player');
  ensureApi();
  showLoader('Загружаю табулатуру…');
  try {
    const bundle = await fetchTab(song.id);
    bundle.title = bundle.title || song.title;
    bundle.artist = bundle.artist || song.artist;
    const tex = bundleToTex(bundle);
    history.add(song);
    loadTex(tex, song);
  } catch (err) {
    hideLoader();
    toast(err.message === 'NO_API' ? 'Сначала укажите адрес воркера в настройках' : 'Не удалось загрузить: ' + err.message, 4500);
  }
}

/* ================= ПЛЕЕР (alphaTab) ================= */
let api = null;
let playerReady = false;
let curSong = null;
let curScore = null;
let renderedTrack = null;
let totalMs = 0;
let seeking = false;
let viewMode = 'tab';
let muted = new Set();
let soloed = new Set();
let lastRiff = null;
let pick = { active: false, first: null };

const abs = (p) => new URL(p, location.href).href;
function paintRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--p', p + '%');
}
document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('input.filled')) paintRange(e.target); });

/* --- звуки и микшер --- */
const SOUNDFONTS = {
  // живой Fender (сырой — в усилитель, чистый — запечённый), живой бас Yamaha и барабаны MuldjordKit поверх MuseScore
  amp: { name: 'Гитара + усилитель', file: 'vendor/alphatab/soundfont/MuseScore_General_Lite.sf3', overlay: ['vendor/alphatab/soundfont/EGuitar_Live.sf3', 'vendor/alphatab/soundfont/Bass_Live.sf3', 'vendor/alphatab/soundfont/Drums_Live.sf3'], amp: true },
  muse: { name: 'MuseScore General', file: 'vendor/alphatab/soundfont/MuseScore_General_Lite.sf3' },
  gu: { name: 'GeneralUser GS', file: 'vendor/alphatab/soundfont/GeneralUser-GS.sf2' },
};
let overlayApplied = 0; // сколько дополнительных наборов уже подгружено
let sfId = 'amp';
try { const v = localStorage.getItem('sfv3'); if (v && SOUNDFONTS[v]) sfId = v; } catch (e) {}
let mixMode = 'focus'; // focus | equal | minus
try { const v = localStorage.getItem('mixMode'); if (['focus', 'equal', 'minus'].includes(v)) mixMode = v; } catch (e) {}
let userVol = new Map(); // индекс дорожки -> 0..1 (ручная правка)

function autoVol(t, shownT) {
  if (mixMode === 'equal') return 1;
  if (t === shownT) return 1;
  if (t.isPercussion) return 0.7;
  const tun = t.staves[0] && t.staves[0].stringTuning.tunings.length;
  const bass = tun && tun <= 4 && t.staves[0].stringTuning.tunings.some((x) => x < 45);
  if (bass) return 0.75;
  return tun ? 0.3 : 0.3;
}
function applyMix() {
  if (!api || !curScore) return;
  const shownT = renderedTrack;
  curScore.tracks.forEach((t, i) => {
    const v = userVol.has(i) ? userVol.get(i) : autoVol(t, shownT);
    api.changeTrackVolume([t], v);
    const mute = muted.has(i) || (mixMode === 'minus' && t === shownT);
    api.changeTrackMute([t], mute);
  });
}
function isAmpTrack(t) {
  const pr = t.playbackInfo ? t.playbackInfo.program : -1;
  return !t.isPercussion && pr >= 28 && pr <= 31;
}
// Гитары → левый канал (идут через усилитель), остальное → правый. Выполняется до генерации MIDI.
function routeScore(score) {
  score.tracks.forEach((t) => { t.playbackInfo.balance = AMP.installed ? (isAmpTrack(t) ? 0 : 16) : 8; });
}
function setSoundfont(id) {
  if (!SOUNDFONTS[id] || id === sfId || !api) return;
  sfId = id;
  try { localStorage.setItem('sfv3', id); } catch (e) {}
  playerReady = false;
  overlayApplied = 0;
  $('#btn-play').disabled = true;
  toast('Загружаю звук: ' + SOUNDFONTS[id].name + '…', 4000);
  api.loadSoundFont(abs(SOUNDFONTS[id].file), false);
}
const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
$('#btn-play').innerHTML = PLAY_SVG;

function showLoader(text) {
  $('#loader-text').textContent = text || 'Загрузка…';
  $('#loader').classList.remove('hidden');
  $('#empty-player').classList.add('hidden');
}
function hideLoader() { $('#loader').classList.add('hidden'); }

function ensureApi() {
  if (api) return api;
  if (!window.alphaTab) { toast('Не загрузился плеер табов'); return null; }
  const A = window.alphaTab;
  api = window.__api = new A.AlphaTabApi($('#at'), {
    core: { fontDirectory: abs('vendor/alphatab/font/'), useWorkers: true },
    display: {
      layoutMode: A.LayoutMode.Page,
      staveProfile: A.StaveProfile.Tab,
      scale: 0.9,
      resources: {
        staffLineColor: 'rgba(239,230,216,0.28)',
        barSeparatorColor: 'rgba(239,230,216,0.45)',
        mainGlyphColor: '#efe6d8',
        secondaryGlyphColor: 'rgba(239,230,216,0.45)',
        scoreInfoColor: '#a39686',
        barNumberColor: 'rgba(240,163,58,0.85)',
      },
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      soundFont: abs(SOUNDFONTS[sfId].file),
      scrollElement: $('#viewport'),
      scrollOffsetY: -40,
    },
  });

  api.error.on((e) => { hideLoader(); toast('Ошибка: ' + (e && e.message ? e.message : e), 5000); });
  api.scoreLoaded.on((score) => {
    curScore = score;
    muted = new Set();
    soloed = new Set();
    userVol = new Map();
    routeScore(score);
    const idx = score.tracks.findIndex((t) => !t.isPercussion && t.staves[0] && t.staves[0].stringTuning.tunings.length > 0);
    const want = idx >= 0 ? idx : 0;
    renderedTrack = score.tracks[want];
    updateHeader();
    setTimeout(() => {
      if (api.score !== score) return;
      if (api.tracks.length !== 1 || api.tracks[0] !== score.tracks[want]) api.renderTracks([score.tracks[want]]);
      updateRouting();
      applyMix();
    }, 0);
  });
  api.renderFinished.on(() => hideLoader());
  api.soundFontLoad.on((e) => {
    if (!playerReady && e.total && e.loaded === 0) toast('Загружаю звуки гитары…');
  });
  api.playerReady.on(() => {
    // дополнительные наборы (живая гитара, живые барабаны) — добавляем поверх основного, каждый один раз;
    // у них разные инструменты, поэтому порядок загрузки неважен
    const ov = [].concat(SOUNDFONTS[sfId].overlay || []);
    while (overlayApplied < ov.length) api.loadSoundFont(abs(ov[overlayApplied++]), true);
    playerReady = true;
    $('#btn-play').disabled = false;
    updateRouting();
    applyMix();
    toast('Звуки готовы — можно играть', 1800);
  });
  api.playerStateChanged.on((e) => { $('#btn-play').innerHTML = e.state === 1 ? PAUSE_SVG : PLAY_SVG; });
  api.playerPositionChanged.on((e) => {
    totalMs = e.endTime;
    $('#t-cur').textContent = fmtTime(e.currentTime);
    $('#t-end').textContent = fmtTime(e.endTime);
    if (!seeking && e.endTime) { $('#seek').value = Math.round((e.currentTime / e.endTime) * 1000); paintRange($('#seek')); }
  });
  api.beatMouseUp.on((beat) => { if (beat && pick.active) onPickBar(beat); });
  return api;
}

function loadScore(data, meta, alreadyInPlayer) {
  if (!alreadyInPlayer) showView('player');
  if (!ensureApi()) return;
  curSong = meta;
  lastRiff = meta.riff || null;
  $('#chip-dice').classList.toggle('hidden', !lastRiff);
  $('#chip-vary').classList.toggle('hidden', !(lastRiff && lastRiff.ai));
  clearLoop();
  showLoader('Рисую табы…');
  $('#seek').value = 0;
  const ok = api.load(data);
  if (ok === false) { hideLoader(); toast('Не удалось прочитать файл', 4000); }
  updateFav();
}

function loadTex(tex, meta) {
  showView('player');
  if (!ensureApi()) return;
  curSong = meta;
  lastRiff = meta.riff || null;
  $('#chip-dice').classList.toggle('hidden', !lastRiff);
  $('#chip-vary').classList.toggle('hidden', !(lastRiff && lastRiff.ai));
  clearLoop();
  showLoader('Рисую табы…');
  $('#seek').value = 0;
  api.tex(tex);
  updateFav();
}

function updateHeader() {
  if (!curSong) return;
  const s = curScore;
  $('#song-title').textContent = (s && s.title) || curSong.title || 'Без названия';
  const parts = [];
  const artist = (s && s.artist) || curSong.artist;
  if (artist) parts.push(artist);
  if (s && s.tempo) parts.push(Math.round(s.tempo) + ' BPM');
  const st = renderedTrack && renderedTrack.staves[0] && renderedTrack.staves[0].stringTuning.tunings;
  if (st && st.length) parts.push(matchTuning([...st].reverse()) || 'свой строй');
  $('#song-sub').textContent = parts.join(' · ');
}

function updateFav() {
  const on = curSong && curSong.id && favorites.has(curSong.id);
  $('#btn-fav').classList.toggle('on', !!on);
  $('#btn-fav').style.visibility = curSong && curSong.id ? 'visible' : 'hidden';
}
$('#btn-fav').onclick = () => {
  if (!curSong || !curSong.id) return;
  const added = favorites.toggle(curSong);
  updateFav();
  toast(added ? 'Добавлено в избранное' : 'Убрано из избранного');
};

$('#btn-play').onclick = () => api && api.playPause();
$('#btn-stop').onclick = () => api && api.stop();
const seekEl = $('#seek');
['pointerdown', 'touchstart'].forEach((ev) => seekEl.addEventListener(ev, () => (seeking = true), { passive: true }));
['pointerup', 'touchend', 'change'].forEach((ev) => seekEl.addEventListener(ev, () => (seeking = false)));
seekEl.addEventListener('input', () => {
  paintRange(seekEl);
  if (!api || !totalMs) return;
  api.timePosition = (seekEl.value / 1000) * totalMs;
  $('#t-cur').textContent = fmtTime((seekEl.value / 1000) * totalMs);
});

$$('#speed-chips button').forEach((b) =>
  b.addEventListener('click', () => {
    $$('#speed-chips button').forEach((x) => x.classList.toggle('on', x === b));
    if (api) api.playbackSpeed = Number(b.dataset.v);
  })
);
$('#chip-metro').onclick = (e) => {
  const on = !e.currentTarget.classList.contains('on');
  e.currentTarget.classList.toggle('on', on);
  if (api) api.metronomeVolume = on ? 1 : 0;
};
$('#chip-count').onclick = (e) => {
  const on = !e.currentTarget.classList.contains('on');
  e.currentTarget.classList.toggle('on', on);
  if (api) api.countInVolume = on ? 1 : 0;
};
$('#chip-view').onclick = (e) => {
  if (!api) return;
  viewMode = viewMode === 'tab' ? 'scoretab' : 'tab';
  e.currentTarget.textContent = viewMode === 'tab' ? 'Табы' : 'Ноты + табы';
  api.settings.display.staveProfile = viewMode === 'tab' ? window.alphaTab.StaveProfile.Tab : window.alphaTab.StaveProfile.ScoreTab;
  api.updateSettings();
  api.render();
};

/* Цикл по тактам: нажать цикл, затем первый и последний такт */
function barRange(mb) { return { startTick: mb.start, endTick: mb.start + mb.calculateDuration() }; }
function onPickBar(beat) {
  const mb = beat.voice.bar.masterBar;
  if (!pick.first) {
    pick.first = mb;
    api.playbackRange = barRange(mb);
    api.isLooping = true;
    toast('Теперь нажмите последний такт фрагмента (или начните играть)', 3500);
  } else {
    const a = pick.first.index <= mb.index ? pick.first : mb;
    const b = pick.first.index <= mb.index ? mb : pick.first;
    api.playbackRange = { startTick: a.start, endTick: b.start + b.calculateDuration() };
    api.isLooping = true;
    pick = { active: false, first: null };
    $('#btn-loop').classList.add('on');
    toast('Фрагмент зациклен');
  }
}
function clearLoop() {
  pick = { active: false, first: null };
  if (api) { api.playbackRange = null; api.isLooping = false; }
  $('#btn-loop').classList.remove('on');
}
$('#btn-loop').onclick = () => {
  if (!api || !curScore) return;
  if (pick.active || $('#btn-loop').classList.contains('on')) {
    clearLoop();
    toast('Цикл выключен');
  } else {
    pick = { active: true, first: null };
    $('#btn-loop').classList.add('on');
    toast('Нажмите на первый такт фрагмента', 3500);
  }
};

/* ---------- Шторка «Дорожки» ---------- */
const EYE = '<svg viewBox="0 0 24 24" class="ic"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
function trackKind(t) {
  if (t.isPercussion) return 'ударные';
  const tun = t.staves[0] && t.staves[0].stringTuning.tunings;
  if (!tun || !tun.length) return 'другой инструмент';
  if (tun.length <= 5 && Math.min(...tun) < 40) return 'бас';
  const pr = t.playbackInfo.program;
  if (pr === 30 || pr === 31) return 'гитара, дисторшн';
  if (pr === 29) return 'гитара, овердрайв';
  if (pr === 28) return 'гитара, глушёная';
  if (pr === 24 || pr === 25) return 'акустика';
  return 'гитара, чистый';
}
$('#btn-tracks').onclick = () => {
  if (!api || !curScore) return toast('Сначала открой песню');
  openSheet('Дорожки', (body) => {
    const seg = document.createElement('div');
    seg.className = 'seg';
    const MODES = [['focus', 'Фокус'], ['equal', 'Поровну'], ['minus', 'Минус-один']];
    const HINTS = {
      focus: 'Дорожка на экране громче остальных, чтобы было слышно, что ты разбираешь.',
      equal: 'Все дорожки на одной громкости.',
      minus: 'Дорожка на экране молчит — играй её сам под остальных.',
    };
    const hint = document.createElement('div');
    hint.className = 'mixhint';
    hint.textContent = HINTS[mixMode];
    MODES.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = mixMode === id ? 'on' : '';
      b.onclick = () => {
        mixMode = id;
        try { localStorage.setItem('mixMode', id); } catch (e) {}
        userVol = new Map();
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        hint.textContent = HINTS[id];
        applyMix();
        drawRows();
      };
      seg.append(b);
    });
    const list = document.createElement('div');
    const master = document.createElement('div');
    master.className = 'knob';
    master.style.marginTop = '10px';
    master.innerHTML = `<span>Общая</span><input class="filled" type="range" min="0" max="100" value="${Math.round(api.masterVolume * 100)}" aria-label="Общая громкость"><output>${Math.round(api.masterVolume * 100)}</output>`;
    const mIn = $('input', master);
    paintRange(mIn);
    mIn.oninput = () => { api.masterVolume = mIn.value / 100; $('output', master).textContent = mIn.value; };
    body.append(seg, hint, list, master);

    function drawRows() {
      list.innerHTML = '';
      curScore.tracks.forEach((t, i) => {
        const row = document.createElement('div');
        const shown = api.tracks.includes(t);
        row.className = 'trk' + (shown ? ' shown' : '');
        const silent = mixMode === 'minus' && shown;
        row.innerHTML = `<div class="n"><div>${esc(t.name || 'Дорожка ' + (i + 1))}</div><small>${trackKind(t)}${shown ? ' · на экране' : ''}${silent ? ' · молчит' : ''}</small></div>`;
        if (!t.isPercussion) {
          const show = document.createElement('button');
          show.className = 'mini' + (shown ? ' on' : '');
          show.innerHTML = EYE;
          show.setAttribute('aria-label', 'Показать табы этой дорожки');
          show.onclick = () => { renderedTrack = t; userVol = new Map(); api.renderTracks([t]); updateHeader(); applyMix(); drawRows(); };
          row.append(show);
        }
        const m = document.createElement('button');
        m.className = 'mini' + (muted.has(i) ? ' on' : '');
        m.textContent = 'M'; m.setAttribute('aria-label', 'Заглушить');
        m.onclick = () => { const on = !muted.has(i); on ? muted.add(i) : muted.delete(i); applyMix(); m.classList.toggle('on', on); };
        const so = document.createElement('button');
        so.className = 'mini' + (soloed.has(i) ? ' on' : '');
        so.textContent = 'S'; so.setAttribute('aria-label', 'Только эта дорожка');
        so.onclick = () => { const on = !soloed.has(i); on ? soloed.add(i) : soloed.delete(i); api.changeTrackSolo([t], on); so.classList.toggle('on', on); };
        row.append(m, so);
        const sl = document.createElement('input');
        sl.type = 'range'; sl.min = 0; sl.max = 100; sl.className = 'filled';
        sl.value = Math.round((userVol.has(i) ? userVol.get(i) : autoVol(t, renderedTrack)) * 100);
        sl.setAttribute('aria-label', 'Громкость дорожки');
        paintRange(sl);
        sl.oninput = () => { userVol.set(i, sl.value / 100); api.changeTrackVolume([t], sl.value / 100); };
        row.append(sl);
        list.append(row);
      });
    }
    drawRows();
  });
};

/* ---------- Усилитель: автоподбор под песню и память ---------- */
const AMP_NAMES = { dist: 'Дисторшн', od: 'Овердрайв', clean: 'Чистый' };
let ampAuto = null;      // что подобрал автомат для текущей песни
function songKey() { return curSong ? (curSong.id ? 's' + curSong.id : 't' + (curSong.title || '')) : null; }
function savedAmp() { const k = songKey(); const all = store.get('ampSongs', {}); return k ? all[k] : null; }
function saveSongAmp() {
  const k = songKey(); if (!k) return;
  const all = store.get('ampSongs', {});
  all[k] = { preset: AMP.preset, drive: AMP.drive, low: AMP.low, mid: AMP.mid, high: AMP.high };
  store.set('ampSongs', all);
}
function forgetSongAmp() { const k = songKey(); const all = store.get('ampSongs', {}); delete all[k]; store.set('ampSongs', all); }
function detectAmp(score) {
  const gtr = score.tracks.filter((t) => !t.isPercussion && t.staves[0] && t.staves[0].stringTuning.tunings.length >= 6);
  const progs = new Set(gtr.map((t) => t.playbackInfo.program));
  const low = Math.min(...gtr.map((t) => Math.min(...t.staves[0].stringTuning.tunings)), 40);
  const why = [];
  let preset = 'clean';
  if (progs.has(30) || progs.has(31)) { preset = 'dist'; why.push('в табе гитара с перегрузом'); }
  else if (progs.has(29)) { preset = 'od'; why.push('в табе гитара с овердрайвом'); }
  else if (progs.has(28)) { preset = 'dist'; why.push('в табе глушёная гитара'); }
  else why.push('в табе чистая гитара');
  let drive = preset === 'clean' ? 0.45 : 0.5;
  if (low <= 35) { drive = 0.72; why.push('7 струн / очень низкий строй'); if (preset === 'clean') preset = 'dist'; }
  else if (low <= 38) { drive = Math.max(drive, 0.64); why.push('пониженный строй'); }
  return { preset, drive, low: 0, mid: 0, high: 0, why: why.join(', ') };
}
function updateRouting() {
  const useAmp = !!(SOUNDFONTS[sfId].amp && AMP.installed);
  if (!curScore) { setAmp({ active: useAmp }); return; }
  ampAuto = detectAmp(curScore);
  const st = savedAmp() || ampAuto;
  setAmp({ active: useAmp, preset: st.preset, drive: st.drive, low: st.low || 0, mid: st.mid || 0, high: st.high || 0 });
}

$('#btn-sound').onclick = () => {
  if (!api) return toast('Сначала открой песню');
  openSheet('Звук', (body) => {
    const ampOn = SOUNDFONTS[sfId].amp && AMP.installed;
    if (ampOn) {
      const note = document.createElement('div');
      note.className = 'auto-note';
      const drawNote = () => {
        const mine = !!savedAmp();
        note.innerHTML = mine
          ? `<span><b>Твои настройки</b> для этой песни</span><button>Вернуть авто</button>`
          : `<span><b>Подобрано: ${AMP_NAMES[AMP.preset]}</b>${ampAuto ? ' — ' + esc(ampAuto.why) : ''}</span>`;
        const b = $('button', note);
        if (b) b.onclick = () => { forgetSongAmp(); updateRouting(); closeSheet(); $('#btn-sound').click(); };
      };
      drawNote();
      const h = document.createElement('h3'); h.textContent = 'Усилитель';
      const seg = document.createElement('div'); seg.className = 'seg';
      Object.entries(AMP_NAMES).forEach(([id, label]) => {
        const b = document.createElement('button');
        b.textContent = label; b.className = AMP.preset === id ? 'on' : '';
        b.onclick = () => { setAmp({ preset: id }); saveSongAmp(); drawNote(); $$('button', seg).forEach((x) => x.classList.toggle('on', x === b)); };
        seg.append(b);
      });
      body.append(note, h, seg);
      const knob = (label, key, min, max, step, toVal, fromVal, fmt) => {
        const r = document.createElement('div'); r.className = 'knob';
        r.innerHTML = `<span>${label}</span><input class="filled" type="range" min="${min}" max="${max}" step="${step}" value="${fromVal(AMP[key])}" aria-label="${label}"><output></output>`;
        const inp = $('input', r), out = $('output', r);
        const show = () => { out.textContent = fmt(Number(inp.value)); paintRange(inp); };
        show();
        inp.oninput = () => { setAmp({ [key]: toVal(Number(inp.value)) }); show(); };
        inp.onchange = () => { saveSongAmp(); drawNote(); };
        body.append(r);
      };
      const db = (v) => (v > 0 ? '+' : '') + v;
      knob('Драйв', 'drive', 0, 100, 1, (v) => v / 100, (v) => Math.round(v * 100), (v) => v);
      knob('Низ', 'low', -6, 6, 0.5, (v) => v, (v) => v, db);
      knob('Середина', 'mid', -6, 6, 0.5, (v) => v, (v) => v, db);
      knob('Верх', 'high', -6, 6, 0.5, (v) => v, (v) => v, db);
    }
    const h2 = document.createElement('h3'); h2.textContent = 'Набор звуков';
    body.append(h2);
    const SUBS = { amp: 'живая гитара через усилитель, остальное MuseScore', muse: 'общий набор инструментов', gu: 'запасной набор' };
    Object.entries(SOUNDFONTS).forEach(([id, f]) => {
      const b = document.createElement('button');
      b.className = 'opt' + (sfId === id ? ' on' : '');
      b.innerHTML = `<span>${esc(f.name)}<br><small>${SUBS[id] || ''}</small></span>${sfId === id ? '✓' : ''}`;
      b.onclick = () => { closeSheet(); setSoundfont(id); };
      body.append(b);
    });
  });
};

/* ================= РИФФ ================= */
// Два режима: «ИИ» учится на табах песен выбранного стиля, «Простой» — старый генератор (запасной, без интернета)
const riffState = {
  mode: store.get('riffMode', 'ai'),
  genre: 'numetal',
  style: { key: 'numetal', name: STYLES.numetal.name, artists: STYLES.numetal.artists, builtin: true },
  tempoAuto: true, tempo: 100, bars: 4, tuning: 'auto', drums: true,
};
const genresBox = $('#genres');
Object.entries(GENRES).forEach(([id, g]) => {
  const b = document.createElement('button');
  b.textContent = g.name;
  b.dataset.id = id;
  if (id === riffState.genre) b.className = 'on';
  b.onclick = () => {
    riffState.genre = id;
    const st = STYLES[id];
    riffState.style = { key: id, name: st ? st.name : g.name, artists: st ? st.artists : [], builtin: true };
    $('#style-input').value = '';
    $$('#genres button').forEach((x) => x.classList.toggle('on', x === b));
    updateAiStatus();
    loadSimilar();
  };
  genresBox.append(b);
});

// Свой стиль: жанр словами («грув», «пост-хардкор») или группы через запятую
$('#style-form').onsubmit = (e) => {
  e.preventDefault();
  const st = parseStyleQuery($('#style-input').value);
  if (!st) return;
  $('#style-input').blur();
  riffState.style = st;
  if (GENRES[st.key]) riffState.genre = st.key;
  $$('#genres button').forEach((x) => x.classList.toggle('on', x.dataset.id === st.key));
  if (riffState.mode !== 'ai') setRiffMode('ai');
  updateAiStatus();
  loadSimilar();
  toast(st.builtin ? `Стиль: ${st.name}` : `Учусь на: ${st.name}`);
};

function setRiffMode(m) {
  riffState.mode = m;
  store.set('riffMode', m);
  $$('#riff-mode button').forEach((x) => x.classList.toggle('on', x.dataset.v === m));
  $('#style-form').classList.toggle('hidden', m !== 'ai');
  updateAiStatus();
}
$$('#riff-mode button').forEach((b) => (b.onclick = () => setRiffMode(b.dataset.v)));

const tempoEl = $('#tempo');
function syncTempoUi() {
  $('#tempo-auto').classList.toggle('on', riffState.tempoAuto);
  $('#tempo-val').textContent = riffState.tempoAuto ? 'авто' : riffState.tempo + ' BPM';
}
tempoEl.oninput = () => { riffState.tempo = Number(tempoEl.value); riffState.tempoAuto = false; syncTempoUi(); };
$('#tempo-auto').onclick = () => { riffState.tempoAuto = true; syncTempoUi(); };
$$('#bars-chips button').forEach((b) =>
  b.addEventListener('click', () => {
    riffState.bars = Number(b.dataset.v);
    $$('#bars-chips button').forEach((x) => x.classList.toggle('on', x === b));
  })
);
$('#riff-tuning').onclick = () =>
  pickTuning({
    title: 'Строй рифа',
    current: riffState.tuning,
    includeAuto: true,
    onPick: (id) => {
      riffState.tuning = id;
      $('#riff-tuning').textContent = id === 'auto' ? 'Как в жанре' : getTuning(id).name;
    },
  });
$('#riff-drums').onclick = (e) => {
  riffState.drums = !riffState.drums;
  e.currentTarget.classList.toggle('on', riffState.drums);
  e.currentTarget.textContent = riffState.drums ? 'Вкл' : 'Выкл';
};

/* --- модели: хранятся в телефоне, по одной на стиль --- */
const models = new Map();
const modelKey = (st) => 'riffai:' + st.key;
function getModel(st) {
  if (models.has(st.key)) return models.get(st.key);
  const m = store.get(modelKey(st), null);
  if (m && m.v === MODEL_VERSION) { models.set(st.key, m); return m; }
  return null;
}
function saveModel(st, m) {
  models.set(st.key, m);
  store.set(modelKey(st), m);
  // список обученных стилей, чтобы старые можно было чистить
  const list = store.get('riffaiList', []).filter((k) => k !== st.key);
  list.unshift(st.key);
  for (const old of list.slice(12)) try { localStorage.removeItem('riffai:' + old); } catch (e) {}
  store.set('riffaiList', list.slice(0, 12));
}

let training = null; // идёт обучение: { key, promise }
function setProgress(frac, text) {
  const bar = $('#train-progress');
  bar.classList.toggle('hidden', frac == null);
  if (frac != null) $('i', bar).style.width = Math.round(frac * 100) + '%';
  const btn = $('#btn-generate');
  btn.disabled = frac != null;
  btn.textContent = frac != null ? text : 'Сочинить рифф';
}

async function ensureModel(st, force) {
  if (!force) { const m = getModel(st); if (m) return m; }
  if (training && training.key === st.key) return training.promise;
  const promise = (async () => {
    try {
      setProgress(0.02, 'Ищу песни…');
      const songs = await collectSongs(st, { searchSongs, fetchTab }, (done, total, txt) => {
        setProgress(0.05 + 0.85 * (done / total), `Учусь: ${done}/${total}`);
        $('#ai-status').textContent = txt;
      });
      setProgress(0.95, 'Учусь…');
      const m = trainModel(songs, { key: st.key, name: st.name });
      if (m.songs.length < 2 || !Object.keys(m.rhythms).length) throw new Error('Нашлось слишком мало подходящих табов. Попробуй другие группы.');
      saveModel(st, m);
      return m;
    } finally {
      training = null;
      setProgress(null);
      updateAiStatus();
      loadSimilar(); // показать, на чём учился ИИ
    }
  })();
  training = { key: st.key, promise };
  return promise;
}

function updateAiStatus() {
  const box = $('#ai-status');
  if (riffState.mode !== 'ai') { box.textContent = 'Простой генератор: правила жанра, работает без интернета.'; return; }
  if (!getApiBase()) { box.innerHTML = 'Для ИИ нужен воркер Songsterr: подключи его на вкладке «Песни». Пока работает простой генератор.'; return; }
  if (training) return;
  const st = riffState.style;
  const m = getModel(st);
  if (m) {
    const d = new Date(m.at);
    box.innerHTML = `<b>${esc(st.name)}</b>: обучен на ${m.songs.length} песнях · ${d.toLocaleDateString('ru-RU')} · <button id="ai-retrain">переобучить</button>`;
    $('#ai-retrain').onclick = async () => {
      try { await ensureModel(st, true); toast('Модель обновлена'); } catch (e) { toast(e.message || 'Не получилось', 4000); }
    };
  } else {
    box.innerHTML = `<b>${esc(st.name)}</b>: при первом запуске скачаю ~20 песен этого стиля и выучу их риффы (около минуты, потом мгновенно).`;
  }
}

function riffOpts() {
  return {
    bars: riffState.bars,
    tempo: riffState.tempoAuto ? undefined : riffState.tempo,
    tuningNotes: riffState.tuning === 'auto' ? undefined : getTuning(riffState.tuning).notes,
    drums: riffState.drums,
    bass: riffState.drums,
  };
}

// простой (запасной) генератор
function makeRiff(seed) {
  return generateRiff({
    genre: riffState.genre,
    bars: riffState.bars,
    tempo: riffState.tempoAuto ? undefined : riffState.tempo,
    tuningId: riffState.tuning === 'auto' ? undefined : riffState.tuning,
    withDrums: riffState.drums,
    seed,
  });
}
function openRiff(r) {
  loadTex(r.tex, { id: null, title: r.title, artist: `${r.genre} · ${r.tempo} BPM · ${r.tuning}`, riff: r });
}
function openAiRiff(r, st) {
  const meta = { ...r, ai: true, styleKey: st.key, styleName: st.name, style: st };
  loadTex(r.tex, { id: null, title: r.title, artist: `${st.name} · ${r.tempo} BPM · ${tuningLabel(r.tuning)}`, riff: meta });
}

async function composeRiff() {
  const useAi = riffState.mode === 'ai' && getApiBase();
  if (!useAi) return openRiff(makeRiff());
  const st = riffState.style;
  try {
    const m = await ensureModel(st);
    openAiRiff(aiRiff(m, riffOpts()), st);
  } catch (e) {
    toast((e && e.message) || 'Не получилось обучиться', 4500);
  }
}
$('#btn-generate').onclick = composeRiff;

// «Ещё рифф» в плеере: тем же способом, каким сделан текущий
$('#chip-dice').onclick = () => {
  if (lastRiff && lastRiff.ai) {
    const m = models.get(lastRiff.styleKey) || getModel(lastRiff.style);
    if (m) return openAiRiff(aiRiff(m, { ...lastRiff.opts, tempo: riffState.tempoAuto ? undefined : lastRiff.opts.tempo }), lastRiff.style);
  }
  openRiff(makeRiff());
};
// «Вариация»: тот же рифф, но развитый
$('#chip-vary').onclick = () => {
  if (!lastRiff || !lastRiff.ai) return;
  const m = models.get(lastRiff.styleKey) || getModel(lastRiff.style);
  if (!m) return toast('Модель стиля не найдена — сочини рифф заново');
  openAiRiff(varyRiff(m, lastRiff), lastRiff.style);
  toast('Вариация ' + ((lastRiff.gen || 0)), 1400);
};

/* --- песни стиля: на чём учился ИИ, или образцы жанра --- */
let similarCache = {};
async function loadSimilar() {
  const box = $('#similar');
  const st = riffState.style;
  const m = riffState.mode === 'ai' ? getModel(st) : null;
  if (m && m.songs.length) {
    $('#similar-h').textContent = 'На чём учился ИИ';
    return renderSimilar(m.songs.filter((s) => s.id));
  }
  $('#similar-h').textContent = 'Похожие песни на Songsterr';
  if (!getApiBase()) { box.innerHTML = '<div class="note-box">Подключи воркер Cloudflare в настройках на вкладке «Песни» — здесь появятся песни этого стиля с табами.</div>'; return; }
  const id = st.key;
  if (similarCache[id]) return renderSimilar(similarCache[id]);
  box.innerHTML = '<div class="spinner-line">Ищу песни…</div>';
  const queries = GENRES[id] && st.builtin ? GENRES[id].queries : st.artists.slice(0, 5);
  const results = await Promise.all(queries.map((q) => searchSongs(q, 1).then((r) => r[0]).catch(() => null)));
  similarCache[id] = results.filter(Boolean);
  if (riffState.style.key === id) renderSimilar(similarCache[id]);
}
function renderSimilar(list) {
  const box = $('#similar');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="spinner-line">Не удалось получить песни</div>'; return; }
  list.forEach((s) => box.append(songRow(s)));
}
setRiffMode(riffState.mode);
loadSimilar();
syncTempoUi();
renderSongs();
