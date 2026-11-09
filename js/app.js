import { TUNINGS, NOTE_NAMES, getTuning, noteName, noteOctave, midiToLabel, midiToFreq, freqToMidi, matchTuning } from './tunings.js';
import { PitchDetector } from './tuner.js';
import { GENRES, generateRiff } from './riff.js';
import { bundleToTex } from './songsterr.js';
import { store, getApiBase, setApiBase, searchSongs, fetchTab, favorites, history } from './data.js';

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
    tg.setHeaderColor && tg.setHeaderColor('#000000');
    tg.setBackgroundColor && tg.setBackgroundColor('#000000');
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
const saveTuner = () => store.set('tuner', { tuningId: tuner.tuningId, custom: tuner.custom, a4: tuner.a4 });
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
})();

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
    b.innerHTML = `<b>${noteName(m)}</b><small>${notes.length - i}</small>`;
    b.onclick = () => {
      tuner.locked = tuner.locked === i ? null : i;
      renderStrings();
      if (tuner.locked != null) toast(`Строю только ${notes.length - i}-ю струну (${midiToLabel(m)}). Нажми ещё раз, чтобы снять`);
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
  $('#needle').classList.add('live');
  gaugeWrap.classList.toggle('in-tune', inTune);
  $('#note-big').textContent = noteName(tMidi) + noteOctave(tMidi);
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
    $('#needle').classList.remove('live');
    gaugeWrap.classList.remove('in-tune');
    $('#note-hint').textContent = ' ';
    $('#note-hint').className = 'hint';
    $('#note-big').textContent = '–';
    $('#note-hz').textContent = 'Сыграйте струну';
    setLiveActive(-1);
  }
}

const detector = new PitchDetector({ onPitch, onSilence });

let rafOn = false;
function animateNeedle() {
  if (!tuner.listening) { rafOn = false; return; }
  tuner.angle += (tuner.targetAngle - tuner.angle) * 0.22;
  $('#needle').setAttribute('transform', `rotate(${tuner.angle.toFixed(2)} 150 150)`);
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
  $('#needle').setAttribute('transform', 'rotate(0 150 150)');
  $('#needle').classList.remove('live');
  gaugeWrap.classList.remove('in-tune');
  $('#note-big').textContent = '–';
  $('#note-hz').textContent = 'Сыграйте струну';
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
  b.innerHTML = `<div class="meta"><div class="t">${esc(song.title)}</div><div class="a">${esc(song.artist || '')}${extra ? ' · ' + esc(extra) : ''}</div></div><span class="go">›</span>`;
  b.onclick = () => openSong(song);
  return b;
}

function noApiBox() {
  const d = document.createElement('div');
  d.className = 'note-box';
  d.innerHTML = `<b>Поиск Songsterr ещё не подключён.</b><br>Нужен адрес вашего воркера Cloudflare (см. README). Вставьте его в настройках — шестерёнка сверху. Пока можно открыть свой файл Guitar Pro или сгенерировать рифф.`;
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

function renderSongs() {
  if ($('#search-input').value.trim()) return;
  const box = $('#songs-content');
  box.innerHTML = '';
  if (!getApiBase()) box.append(noApiBox());
  box.append(section('Избранное', favorites.list()));
  box.append(section('Недавние', history.list().slice(0, 15)));
}

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#search-input').value.trim();
  $('#search-input').blur();
  const box = $('#songs-content');
  if (!q) return renderSongs();
  if (!getApiBase()) { box.innerHTML = ''; box.append(noApiBox()); return; }
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
    body.innerHTML = `<div class="label" style="margin-top:0">Адрес воркера Cloudflare</div>
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
  api = new A.AlphaTabApi($('#at'), {
    core: { fontDirectory: abs('vendor/alphatab/font/'), useWorkers: true },
    display: {
      layoutMode: A.LayoutMode.Page,
      staveProfile: A.StaveProfile.Tab,
      scale: 0.9,
      resources: {
        staffLineColor: 'rgba(255,255,255,0.35)',
        barSeparatorColor: 'rgba(255,255,255,0.5)',
        mainGlyphColor: '#f2f2f2',
        secondaryGlyphColor: 'rgba(255,255,255,0.45)',
        scoreInfoColor: '#cfcfcf',
        barNumberColor: 'rgba(217,178,124,0.9)',
      },
    },
    player: {
      enablePlayer: true,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      soundFont: abs('vendor/alphatab/soundfont/GeneralUser-GS.sf2'),
      scrollElement: $('#viewport'),
      scrollOffsetY: -40,
    },
  });

  api.error.on((e) => { hideLoader(); toast('Ошибка: ' + (e && e.message ? e.message : e), 5000); });
  api.scoreLoaded.on((score) => {
    curScore = score;
    muted = new Set();
    soloed = new Set();
    const idx = score.tracks.findIndex((t) => !t.isPercussion && t.staves[0] && t.staves[0].stringTuning.tunings.length > 0);
    const want = idx >= 0 ? idx : 0;
    renderedTrack = score.tracks[want];
    updateHeader();
    setTimeout(() => {
      if (api.tracks.length !== 1 || api.tracks[0] !== score.tracks[want]) api.renderTracks([score.tracks[want]]);
    }, 0);
  });
  api.renderFinished.on(() => hideLoader());
  api.soundFontLoad.on((e) => {
    if (!playerReady && e.total && e.loaded === 0) toast('Загружаю звуки гитары…');
  });
  api.playerReady.on(() => {
    playerReady = true;
    $('#btn-play').disabled = false;
    toast('Звуки готовы — можно играть', 1800);
  });
  api.playerStateChanged.on((e) => { $('#btn-play').innerHTML = e.state === 1 ? PAUSE_SVG : PLAY_SVG; });
  api.playerPositionChanged.on((e) => {
    totalMs = e.endTime;
    $('#t-cur').textContent = fmtTime(e.currentTime);
    $('#t-end').textContent = fmtTime(e.endTime);
    if (!seeking && e.endTime) $('#seek').value = Math.round((e.currentTime / e.endTime) * 1000);
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

$('#btn-tracks').onclick = () => {
  if (!api || !curScore) return toast('Сначала откройте песню');
  openSheet('Дорожки', (body) => {
    const vol = document.createElement('div');
    vol.className = 'stepper';
    vol.innerHTML = `<span>Громкость</span><input type="range" min="0" max="100" value="${Math.round(api.masterVolume * 100)}" style="width:55%">`;
    $('input', vol).oninput = (e) => (api.masterVolume = e.target.value / 100);
    body.append(vol);
    curScore.tracks.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'trk';
      const shown = api.tracks.includes(t);
      row.innerHTML = `<div class="n"><div>${esc(t.name || 'Дорожка ' + (i + 1))}</div><small>${t.isPercussion ? 'ударные' : esc(t.shortName || '')}${shown ? ' · на экране' : ''}</small></div>`;
      if (!t.isPercussion) {
        const show = document.createElement('button');
        show.className = 'mini' + (shown ? ' on' : '');
        show.textContent = '👁';
        show.onclick = () => { renderedTrack = t; api.renderTracks([t]); updateHeader(); closeSheet(); };
        row.append(show);
      }
      const m = document.createElement('button');
      m.className = 'mini' + (muted.has(i) ? ' on' : '');
      m.textContent = 'M';
      m.onclick = () => { const on = !muted.has(i); on ? muted.add(i) : muted.delete(i); api.changeTrackMute([t], on); m.classList.toggle('on', on); };
      const s = document.createElement('button');
      s.className = 'mini' + (soloed.has(i) ? ' on' : '');
      s.textContent = 'S';
      s.onclick = () => { const on = !soloed.has(i); on ? soloed.add(i) : soloed.delete(i); api.changeTrackSolo([t], on); s.classList.toggle('on', on); };
      row.append(m, s);
      body.append(row);
    });
  });
};

/* ================= РИФФ ================= */
const riffState = { genre: 'numetal', tempoAuto: true, tempo: 100, bars: 4, tuning: 'auto', drums: true };
const genresBox = $('#genres');
Object.entries(GENRES).forEach(([id, g]) => {
  const b = document.createElement('button');
  b.textContent = g.name;
  b.dataset.id = id;
  if (id === riffState.genre) b.className = 'on';
  b.onclick = () => {
    riffState.genre = id;
    $$('#genres button').forEach((x) => x.classList.toggle('on', x === b));
    loadSimilar();
  };
  genresBox.append(b);
});

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
$('#btn-generate').onclick = () => openRiff(makeRiff());
$('#chip-dice').onclick = () => openRiff(makeRiff());

let similarCache = {};
async function loadSimilar() {
  const box = $('#similar');
  if (!getApiBase()) { box.innerHTML = '<div class="note-box">Подключите воркер Cloudflare (настройки на вкладке «Песни»), и здесь появятся настоящие песни этого стиля с табами.</div>'; return; }
  const id = riffState.genre;
  if (similarCache[id]) return renderSimilar(similarCache[id]);
  box.innerHTML = '<div class="spinner-line">Ищу песни…</div>';
  const results = await Promise.all(
    GENRES[id].queries.map((q) => searchSongs(q, 1).then((r) => r[0]).catch(() => null))
  );
  similarCache[id] = results.filter(Boolean);
  if (riffState.genre === id) renderSimilar(similarCache[id]);
}
function renderSimilar(list) {
  const box = $('#similar');
  box.innerHTML = '';
  if (!list.length) { box.innerHTML = '<div class="spinner-line">Не удалось получить песни</div>'; return; }
  list.forEach((s) => box.append(songRow(s)));
}
loadSimilar();
syncTempoUi();
renderSongs();
