// ИИ-генератор риффов: учится на настоящих табах Songsterr и сочиняет новые риффы в том же духе.
// Модель: ритмические рисунки тактов + цепь Маркова по нотам (относительно тоники) + приёмы
// + барабанные грувы, снятые с тех же песен. Всё считается прямо в браузере, без сервера.
import { TUNINGS, matchTuning, noteName, noteOctave } from './tunings.js';

export const MODEL_VERSION = 1;

/* ---------- стили: группы-образцы и как их можно назвать ---------- */
export const STYLES = {
  numetal: { name: 'Nu metal', alias: ['nu metal', 'nu-metal', 'ню метал', 'ню-метал', 'нюметал', 'ню'], artists: ['Korn', 'Slipknot', 'Limp Bizkit', 'Deftones', 'System of a Down', 'Linkin Park', 'Mudvayne', 'Disturbed', 'Static-X', 'Papa Roach'] },
  metalcore: { name: 'Metalcore', alias: ['metalcore', 'металкор', 'метал кор'], artists: ['Killswitch Engage', 'Bullet for My Valentine', 'Trivium', 'As I Lay Dying', 'August Burns Red', 'Parkway Drive', 'Architects', 'Bring Me the Horizon', 'All That Remains'] },
  thrash: { name: 'Thrash', alias: ['thrash', 'трэш', 'треш', 'трэш метал', 'speed metal'], artists: ['Metallica', 'Slayer', 'Megadeth', 'Anthrax', 'Testament', 'Exodus', 'Kreator', 'Sepultura'] },
  djent: { name: 'Djent', alias: ['djent', 'джент', 'джэнт'], artists: ['Periphery', 'Meshuggah', 'Animals as Leaders', 'Tesseract', 'Monuments', 'Northlane', 'Born of Osiris', 'Vildhjarta'] },
  doom: { name: 'Doom', alias: ['doom', 'дум', 'дум метал', 'sludge', 'сладж'], artists: ['Black Sabbath', 'Electric Wizard', 'Sleep', 'Candlemass', 'Saint Vitus', 'Pentagram', 'Cathedral', 'Windhand'] },
  hardrock: { name: 'Hard rock', alias: ['hard rock', 'хард рок', 'хард-рок', 'хардрок'], artists: ['AC/DC', "Guns N' Roses", 'Led Zeppelin', 'Deep Purple', 'Van Halen', 'Aerosmith', 'Def Leppard', 'Whitesnake'] },
  punk: { name: 'Punk', alias: ['punk', 'панк', 'поп-панк', 'pop punk', 'поп панк'], artists: ['Ramones', 'Green Day', 'Sex Pistols', 'The Offspring', 'Bad Religion', 'NOFX', 'Blink-182', 'Rancid'] },
  groove: { name: 'Groove metal', alias: ['groove', 'грув', 'грув метал'], artists: ['Pantera', 'Lamb of God', 'Machine Head', 'Gojira', 'DevilDriver', 'Sepultura'] },
  deathcore: { name: 'Deathcore', alias: ['deathcore', 'дэткор', 'деткор', 'дезкор'], artists: ['Whitechapel', 'Suicide Silence', 'Thy Art Is Murder', 'Lorna Shore', 'Chelsea Grin', 'Carnifex'] },
  death: { name: 'Death metal', alias: ['death metal', 'дэт', 'дэт метал', 'дет метал', 'дез метал', 'мелодик дэт', 'melodic death'], artists: ['Death', 'Cannibal Corpse', 'Morbid Angel', 'Obituary', 'Arch Enemy', 'Amon Amarth', 'In Flames', 'At the Gates'] },
  black: { name: 'Black metal', alias: ['black metal', 'блэк', 'блек', 'блэк метал'], artists: ['Mayhem', 'Darkthrone', 'Emperor', 'Immortal', 'Behemoth', 'Dissection', 'Burzum'] },
  grunge: { name: 'Grunge', alias: ['grunge', 'гранж'], artists: ['Nirvana', 'Alice in Chains', 'Soundgarden', 'Pearl Jam', 'Stone Temple Pilots', 'Silverchair'] },
  altmetal: { name: 'Alt metal', alias: ['alternative metal', 'alt metal', 'альт метал', 'альтернативный метал', 'альтернатива', 'alternative'], artists: ['Tool', 'Rage Against the Machine', 'Breaking Benjamin', 'Three Days Grace', 'Chevelle', 'Godsmack', 'Staind'] },
  posthardcore: { name: 'Post-hardcore', alias: ['post-hardcore', 'post hardcore', 'пост-хардкор', 'пост хардкор', 'хардкор', 'hardcore'], artists: ['Underoath', 'Silverstein', 'Pierce the Veil', 'Alexisonfire', 'Thursday', 'Senses Fail'] },
  stoner: { name: 'Stoner', alias: ['stoner', 'стоунер', 'стонер', 'desert rock'], artists: ['Kyuss', 'Queens of the Stone Age', 'Clutch', 'Fu Manchu', 'Monster Magnet', 'Truckfighters'] },
  prog: { name: 'Prog metal', alias: ['prog', 'прог', 'прог метал', 'progressive'], artists: ['Dream Theater', 'Mastodon', 'Opeth', 'Gojira', 'Haken', 'Tool'] },
  heavy: { name: 'Heavy metal', alias: ['heavy metal', 'хэви', 'хеви', 'хэви метал', 'хеви метал', 'nwobhm'], artists: ['Iron Maiden', 'Judas Priest', 'Ozzy Osbourne', 'Dio', 'Motörhead', 'Saxon'] },
  industrial: { name: 'Industrial', alias: ['industrial', 'индастриал', 'индастриал метал', 'ндх', 'neue deutsche härte'], artists: ['Rammstein', 'Ministry', 'Fear Factory', 'Nine Inch Nails', 'Marilyn Manson', 'Pain'] },
};

// Что пользователь написал → какой стиль или какие группы
export function parseStyleQuery(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/ё/g, 'е');
  for (const [id, st] of Object.entries(STYLES)) {
    if (st.name.toLowerCase() === low || st.alias.some((a) => a.replace(/ё/g, 'е') === low)) return { key: id, name: st.name, artists: st.artists, builtin: true };
  }
  for (const [id, st] of Object.entries(STYLES)) {
    if (st.alias.some((a) => a.length >= 4 && low.includes(a.replace(/ё/g, 'е')))) return { key: id, name: st.name, artists: st.artists, builtin: true };
  }
  const artists = raw.split(/\s*(?:,|;|\+|\/|&| и | and )\s*/i).map((s) => s.trim()).filter(Boolean).slice(0, 8);
  return { key: 'q:' + artists.map((a) => a.toLowerCase()).join(','), name: artists.join(', '), artists, builtin: false };
}

/* ---------- мелочи ---------- */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const inc = (obj, k, w = 1) => { obj[k] = (obj[k] || 0) + w; };
function wpick(rng, table) {
  // table: {key: weight} или [[key, weight]]
  const arr = Array.isArray(table) ? table : Object.entries(table);
  let sum = 0;
  for (const [, w] of arr) sum += w;
  if (!sum) return null;
  let r = rng() * sum;
  for (const [k, w] of arr) { r -= w; if (r <= 0) return k; }
  return arr[arr.length - 1][0];
}
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const lenClass = (l) => (l <= 1 ? 's' : l <= 2 ? 'e' : l <= 4 ? 'q' : 'L');
const sixteenths = (dur) => {
  const [n, d] = Array.isArray(dur) && dur.length === 2 ? dur : [1, 4];
  const x = (16 * n) / d;
  return Math.abs(x - Math.round(x)) < 1e-6 && x >= 1 ? Math.round(x) : null;
};

/* ---------- разбор табов Songsterr ---------- */
function partProgram(part) {
  const id = part.data && part.data.instrumentId;
  if (typeof id === 'number') return id;
  const s = String(part.instrument || '').toLowerCase();
  if (/distort/.test(s)) return 30;
  if (/overdr/.test(s)) return 29;
  if (/clean|jazz/.test(s)) return 27;
  if (/acoustic|nylon|steel/.test(s)) return 25;
  return 29;
}

// Такты гитары в сетке шестнадцатых (только 4/4, без триолей и тридцать вторых)
function guitarBars(part) {
  const d = part.data || {};
  const tun = Array.isArray(d.tuning) ? d.tuning : [];
  if (tun.length < 4) return [];
  let sig = [4, 4];
  return (d.measures || []).map((m) => {
    if (Array.isArray(m.signature) && m.signature.length === 2) sig = m.signature;
    if (sig[0] !== 4 || sig[1] !== 4) return null;
    const v = m.voices && m.voices[0];
    if (!v) return null;
    let p = 0;
    const ev = [];
    for (const b of v.beats || []) {
      if (b.graceNote) continue;
      const l = sixteenths(b.duration);
      if (!l) return null;
      const notes = (b.notes || []).filter((n) => n && !n.rest && n.fret != null && tun[n.string] != null);
      if (b.rest || !notes.length) ev.push({ p, l, r: 1 });
      else if (notes.every((n) => n.tie)) {
        const prev = ev[ev.length - 1];
        if (prev && !prev.r) prev.l += l;
        else ev.push({ p, l, r: 1 });
      } else {
        const live = notes.filter((n) => !n.tie);
        const dead = live.every((n) => n.dead);
        const ns = live.filter((n) => !n.dead).map((n) => ({
          m: tun[n.string] + Number(n.fret),
          sl: !!n.slide, b: !!n.bend, h: !!n.hp, v: !!n.leftHandVibrato, st: !!n.staccato,
        }));
        ev.push({ p, l, x: dead ? 1 : 0, pm: !!b.palmMute, ns });
      }
      p += l;
    }
    if (p !== 16 || !ev.some((e) => !e.r)) return null;
    return ev;
  });
}

function drumBars(part) {
  const d = part.data || {};
  let sig = [4, 4];
  return (d.measures || []).map((m) => {
    if (Array.isArray(m.signature) && m.signature.length === 2) sig = m.signature;
    if (sig[0] !== 4 || sig[1] !== 4) return null;
    const slots = Array.from({ length: 16 }, () => new Set());
    for (const v of m.voices || []) {
      let p = 0;
      for (const b of v.beats || []) {
        if (b.graceNote) continue;
        const l = sixteenths(b.duration);
        if (!l) return null;
        if (!b.rest) for (const n of b.notes || []) if (n && !n.rest && n.fret != null && !n.tie) { const c = canonDrum(Number(n.fret)); if (c) slots[p].add(c); }
        p += l;
      }
      if (p !== 16 && p !== 0) return null;
    }
    if (!slots.some((s) => s.size)) return null;
    return slots.map((s) => [...s].sort((a, b) => a - b));
  });
}
function canonDrum(n) {
  if (n === 35 || n === 36) return 36;
  if (n === 37 || n === 38 || n === 39 || n === 40) return 38;
  if (n === 42 || n === 44 || n === 22) return 42;
  if (n === 46 || n === 26) return 46;
  if (n === 49 || n === 55 || n === 57) return 49;
  if (n === 51 || n === 53 || n === 59) return 51;
  if (n === 52) return 52;
  if ([41, 43, 45, 47, 48, 50].includes(n)) return n;
  return 0;
}

// Тоника песни: самая «весомая» нота среди низов
function songTonic(bars, lowOpen) {
  const pc = new Array(12).fill(0);
  for (const ev of bars) {
    if (!ev) continue;
    for (const e of ev) {
      if (e.r || e.x || !e.ns.length) continue;
      const root = Math.min(...e.ns.map((n) => n.m));
      if (root > lowOpen + 14) continue;
      // чаг на открытой низкой струне и глушёные ноты — почти всегда тоника
      const w = e.l * (e.p % 4 === 0 ? 1.6 : 1) * (e.p === 0 ? 1.5 : 1) * (root === lowOpen ? 2.5 : root - lowOpen < 5 ? 1.3 : 1) * (e.pm ? 1.5 : 1);
      pc[root % 12] += w;
    }
  }
  const best = pc.indexOf(Math.max(...pc));
  return lowOpen + ((best - (lowOpen % 12) + 12) % 12);
}

function tokenOf(e, tonic) {
  const ms = e.ns.map((n) => n.m).sort((a, b) => a - b);
  const root = ms[0];
  let rel = root - tonic;
  while (rel > 19) rel -= 12;
  if (rel < -11) rel += 12;
  const iv = [...new Set(ms.slice(1).map((m) => m - root))].filter((x) => x > 0 && x <= 24).sort((a, b) => a - b).slice(0, 3);
  return iv.length ? `${rel}:${iv.join('.')}` : String(rel);
}
export function parseToken(t) {
  const [rel, sh] = String(t).split(':');
  return { rel: Number(rel), shape: sh ? sh.split('.').map(Number) : [] };
}
const isRiffBar = (ev, tonic) => {
  const roots = ev.filter((e) => !e.r && !e.x && e.ns.length).map((e) => Math.min(...e.ns.map((n) => n.m)) - tonic);
  if (!roots.length) return ev.some((e) => e.x);
  roots.sort((a, b) => a - b);
  return roots[Math.floor(roots.length / 2)] <= 12;
};

/* ---------- обучение ---------- */
// songs: [{ title, artist, parts:[{kind, name, instrument, data}] }] — то, что отдаёт воркер /tab
export function trainModel(songs, meta = {}) {
  const M = {
    v: MODEL_VERSION, key: meta.key || '', name: meta.name || '', at: Date.now(),
    songs: [], tempos: [], tunings: {}, programs: {}, bassPrograms: {},
    rhythms: {}, first: {}, o0: {}, o1: {}, o2: {},
    tech: { notes: 0, sl: 0, b: 0, v: 0, st: 0, pmShort: 0, short: 0, x: 0, onsets: 0 },
    drums: {}, fills: {}, kick: { hit: 0, tot: 0 }, bars: 0,
  };
  for (const song of songs) {
    const parts = (song.parts || []).filter((p) => p && p.data && Array.isArray(p.data.measures));
    const gtrs = parts.filter((p) => p.kind === 'guitar' && [28, 29, 30, 31, 26, 27].includes(partProgram(p)));
    const heavy = gtrs.filter((p) => partProgram(p) >= 29);
    const use = (heavy.length ? heavy : gtrs).slice(0, 3);
    if (!use.length) continue;
    let used = 0;
    const tempo = ((parts[0].data.automations || {}).tempo || [])[0];
    if (tempo && tempo.bpm) M.tempos.push(Math.round(tempo.bpm));
    const drumPart = parts.find((p) => p.kind === 'drums');
    const dBars = drumPart ? drumBars(drumPart) : [];
    const bassPart = parts.find((p) => p.kind === 'bass');
    if (bassPart) inc(M.bassPrograms, partProgram(bassPart));

    let mainGtrBars = null;
    for (const part of use) {
      const tun = part.data.tuning;
      const lowOpen = Math.min(...tun);
      const bars = guitarBars(part);
      const tonic = songTonic(bars, lowOpen);
      const seen = new Map();
      let a = '^', b = '^';
      let riffBars = 0;
      bars.forEach((ev) => {
        if (!ev || !isRiffBar(ev, tonic)) { a = b = '^'; return; }
        const sig = ev.map((e) => (e.r ? 'r' : e.x ? 'x' : tokenOf(e, tonic)) + '@' + e.p + '/' + e.l + (e.pm ? 'p' : '')).join(' ');
        const rep = (seen.get(sig) || 0) + 1;
        seen.set(sig, rep);
        if (rep > 3) return; // одинаковые такты не перевешивают модель
        const w = rep === 1 ? 1 : 0.4;
        riffBars++;
        inc(M.rhythms, ev.map((e) => `${e.p}.${e.l}.${e.r ? 'r' : e.x ? 'x' : e.pm ? 'm' : 'n'}`).join(','), w);
        let firstNote = true;
        for (const e of ev) {
          if (e.r) continue;
          M.tech.onsets += w;
          if (e.x) { M.tech.x += w; continue; }
          const tok = tokenOf(e, tonic);
          const c = lenClass(e.l) + (e.pm ? 'p' : '');
          if (firstNote) { inc(M.first, c + '|' + tok, w); firstNote = false; }
          inc((M.o2[`${a}|${b}|${c}`] = M.o2[`${a}|${b}|${c}`] || {}), tok, w);
          inc((M.o1[`${b}|${c}`] = M.o1[`${b}|${c}`] || {}), tok, w);
          inc((M.o0[c] = M.o0[c] || {}), tok, w);
          a = b; b = tok;
          const one = e.ns.length === 1;
          M.tech.notes += w;
          if (e.ns.some((n) => n.sl)) M.tech.sl += w;
          if (one && e.ns[0].b) M.tech.b += w;
          if (e.ns.some((n) => n.v)) M.tech.v += w;
          if (e.ns.some((n) => n.st)) M.tech.st += w;
          if (e.l <= 2) { M.tech.short += w; if (e.pm) M.tech.pmShort += w; }
        }
      });
      if (riffBars) {
        used++;
        M.bars += riffBars;
        inc(M.programs, partProgram(part));
        inc(M.tunings, tun.slice().sort((x, y) => x - y).join(','), riffBars);
        if (!mainGtrBars) mainGtrBars = bars.map((ev) => (ev && isRiffBar(ev, tonic) ? ev : null));
      }
    }
    if (!used) continue;
    M.songs.push({ id: song.id, title: song.title, artist: song.artist });

    // барабаны: грувы и сбивки; насколько бочка повторяет гитару
    const seenD = new Map();
    dBars.forEach((slots, i) => {
      if (!slots) return;
      const key = slots.map((s) => s.join('+')).join(' ');
      const rep = (seenD.get(key) || 0) + 1;
      seenD.set(key, rep);
      if (rep > 4) return;
      const toms = slots.filter((s) => s.some((n) => n >= 41 && n <= 50 && n !== 42 && n !== 46 && n !== 49)).length;
      const hasBeat = slots.some((s) => s.includes(38)) && slots.some((s) => s.includes(36));
      if (toms >= 3) inc(M.fills, key, rep === 1 ? 1 : 0.4);
      else if (hasBeat) inc(M.drums, key, rep === 1 ? 1 : 0.4);
      const g = mainGtrBars && mainGtrBars[i];
      if (g && hasBeat) {
        for (const e of g) {
          if (e.r) continue;
          M.kick.tot++;
          if (slots[e.p].includes(36)) M.kick.hit++;
        }
      }
    });
  }
  // обрезаем редкое, чтобы модель была компактной
  M.rhythms = top(M.rhythms, 220);
  M.drums = top(M.drums, 120);
  M.fills = top(M.fills, 40);
  return M;
}
function top(obj, n) {
  return Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n));
}

export function modelSummary(M) {
  const tk = sum(M.o0 ? Object.fromEntries(Object.entries(M.o0).map(([k, v]) => [k, sum(v)])) : {});
  return { songs: M.songs.length, bars: Math.round(M.bars), rhythms: Object.keys(M.rhythms).length, notes: Math.round(tk), drums: Object.keys(M.drums).length };
}

/* ---------- генерация ---------- */
function parseRhythm(key) {
  return key.split(',').map((s) => {
    const [p, l, t] = s.split('.');
    return { p: +p, l: +l, t };
  });
}

function sampleToken(M, rng, a, b, c, opts = {}) {
  const novelty = opts.novelty ?? 0.25;
  const o2 = M.o2[`${a}|${b}|${c}`];
  const o1 = M.o1[`${b}|${c}`];
  const o0 = M.o0[c] || M.o0[c.replace('p', '')] || M.o0.e || Object.values(M.o0)[0];
  const n2 = sum(o2), n1 = sum(o1);
  let table;
  const r = rng();
  if (n2 >= 3 && r > novelty) table = o2;
  else if (n1 >= 2 && r > novelty * 0.25) table = o1;
  else table = o1 && n1 && rng() < 0.6 ? o1 : o0;
  let tok = wpick(rng, filterTable(table, opts));
  if (tok == null) tok = wpick(rng, filterTable(o0, opts)) || '0';
  return tok;
}
// не даём уходить слишком высоко (это уже соло, а не рифф)
function filterTable(t, opts) {
  if (!t) return {};
  const maxRel = opts.maxRel ?? 15;
  const out = {};
  for (const [k, w] of Object.entries(t)) if (parseToken(k).rel <= maxRel) out[k] = w;
  return Object.keys(out).length ? out : t;
}

function techProb(M, k) { const t = M.tech; return t.notes ? t[k] / t.notes : 0; }

// Новый такт: ритм из корпуса (иногда чуть изменённый) + ноты из цепи Маркова
// ритм «с мясом»: не меньше minOn ударов и не больше половины такта пауз
function pickRhythm(M, rng, minOn = 3) {
  let k = null;
  for (let i = 0; i < 16; i++) {
    k = wpick(rng, M.rhythms);
    const rh = parseRhythm(k);
    const on = rh.filter((s) => s.t !== 'r').length;
    const rest = rh.filter((s) => s.t === 'r').reduce((a, s) => a + s.l, 0);
    if (on >= minOn && rest <= 8) return k;
  }
  return k;
}

function makeBar(M, rng, ctx, rhythmKey) {
  const rh = parseRhythm(rhythmKey || pickRhythm(M, rng, 2));
  const bar = [];
  let first = true;
  for (const s of rh) {
    if (s.t === 'r') { bar.push({ p: s.p, l: s.l, r: 1 }); continue; }
    if (s.t === 'x') { bar.push({ p: s.p, l: s.l, x: 1 }); continue; }
    const pm = s.t === 'm';
    const c = lenClass(s.l) + (pm ? 'p' : '');
    let tok;
    // первая нота риффа: чаще всего тоника (как у настоящих риффов)
    if (first && ctx.a === '^') tok = wpick(rng, Object.fromEntries(Object.entries(M.first).filter(([k]) => k.startsWith(c + '|')).map(([k, w]) => { const t = k.split('|')[1]; return [t, w * (parseToken(t).rel === 0 ? 2.5 : 1)]; }))) || sampleToken(M, rng, '^', '^', c);
    else tok = sampleToken(M, rng, ctx.a, ctx.b, c);
    first = false;
    ctx.a = ctx.b; ctx.b = tok;
    bar.push({ p: s.p, l: s.l, tok, pm });
  }
  return decorate(M, rng, bar);
}

// Приёмы: слайды, бенды, вибрато, стаккато — с частотой, как в песнях жанра
function decorate(M, rng, bar) {
  let prev = null;
  for (const e of bar) {
    if (e.r || e.x) { prev = null; continue; }
    const { rel, shape } = parseToken(e.tok);
    e.fx = {};
    if (!e.pm && prev != null && rel !== prev && Math.abs(rel - prev) <= 5 && e.l >= 2 && rng() < techProb(M, 'sl') * 1.4) e.fx.sl = 1;
    if (!e.pm && !shape.length && rel > 0 && e.l >= 2 && rng() < techProb(M, 'b') * 1.5) e.fx.b = 1;
    if (!e.pm && e.l >= 4 && rng() < techProb(M, 'v') * 2.5) e.fx.v = 1;
    if (e.l <= 2 && !e.pm && rng() < techProb(M, 'st')) e.fx.st = 1;
    prev = rel;
  }
  return bar;
}

const clone = (bar) => bar.map((e) => ({ ...e, fx: e.fx ? { ...e.fx } : undefined }));

// Вариация такта: меняем часть нот, ритм или концовку — как гитарист развивает тему
export function varyBar(M, rng, bar, strength = 0.3) {
  let out = clone(bar);
  const ops = [];
  if (rng() < 0.55 + strength * 0.3) ops.push('notes');
  if (rng() < 0.35 + strength * 0.3) ops.push('rhythm');
  if (rng() < 0.3 + strength * 0.4) ops.push('ending');
  if (rng() < 0.18) ops.push('shift');
  if (!ops.length) ops.push('notes');
  for (const op of ops) {
    if (op === 'notes') {
      const idx = out.map((e, i) => (!e.r && !e.x && i > 0 ? i : -1)).filter((i) => i >= 0);
      const k = Math.max(1, Math.round(idx.length * strength * 0.5));
      for (let j = 0; j < k && idx.length; j++) {
        const i = idx.splice(Math.floor(rng() * idx.length), 1)[0];
        const prevT = lastTok(out, i);
        const e = out[i];
        e.tok = sampleToken(M, rng, prevT[0], prevT[1], lenClass(e.l) + (e.pm ? 'p' : ''), { novelty: 0.4 });
      }
    } else if (op === 'rhythm') {
      out = tweakRhythm(rng, out);
    } else if (op === 'ending') {
      const cut = rng() < 0.5 ? 12 : 8;
      const keep = out.filter((e) => e.p + e.l <= cut);
      const end = keep.length ? keep[keep.length - 1].p + keep[keep.length - 1].l : 0;
      const tail = pickTail(M, rng, end);
      const ctx = { a: lastTok(keep, keep.length)[0], b: lastTok(keep, keep.length)[1] };
      for (const s of tail) {
        if (s.t === 'r') { keep.push({ p: s.p, l: s.l, r: 1 }); continue; }
        if (s.t === 'x') { keep.push({ p: s.p, l: s.l, x: 1 }); continue; }
        const pm = s.t === 'm';
        const tok = sampleToken(M, rng, ctx.a, ctx.b, lenClass(s.l) + (pm ? 'p' : ''), { novelty: 0.35 });
        ctx.a = ctx.b; ctx.b = tok;
        keep.push({ p: s.p, l: s.l, tok, pm });
      }
      out = keep;
    } else if (op === 'shift') {
      // сдвиг куска по ладам — классический приём «ответной фразы»
      const steps = [1, 2, 3, 5, -1, -2, 7];
      const d = steps[Math.floor(rng() * steps.length)];
      const from = rng() < 0.5 ? 8 : 12;
      for (const e of out) if (e.p >= from && e.tok) {
        const t = parseToken(e.tok);
        const rel = Math.max(0, Math.min(15, t.rel + d));
        e.tok = t.shape.length ? `${rel}:${t.shape.join('.')}` : String(rel);
      }
    }
  }
  return decorate(M, rng, out.map((e) => { if (e.fx) e.fx = {}; return e; }));
}
// вариация, которая точно отличается от оригинала
const barSig = (bar) => bar.map((e) => `${e.p}/${e.l}/${e.r ? 'r' : e.x ? 'x' : e.tok}${e.pm ? 'p' : ''}`).join(' ');
export function surelyVary(M, rng, bar, strength) {
  const base = barSig(bar);
  let v = null;
  for (let i = 0; i < 8; i++) {
    v = varyBar(M, rng, bar, strength + i * 0.08);
    if (barSig(v) !== base) return v;
  }
  return v;
}
function lastTok(bar, i) {
  const toks = bar.slice(0, i).filter((e) => e.tok).map((e) => e.tok);
  return [toks[toks.length - 2] || '^', toks[toks.length - 1] || '^'];
}
// хвост такта от позиции from: берём концовку настоящего ритма из корпуса
function pickTail(M, rng, from) {
  for (let tries = 0; tries < 30; tries++) {
    const rh = parseRhythm(wpick(rng, M.rhythms));
    const tail = rh.filter((s) => s.p >= from);
    if (tail.length && tail[0].p === from) return tail;
  }
  const out = [];
  for (let p = from; p < 16; p += 2) out.push({ p, l: Math.min(2, 16 - p), t: 'm' });
  return out;
}
function tweakRhythm(rng, bar) {
  const out = clone(bar);
  const i = Math.floor(rng() * out.length);
  const e = out[i];
  if (!e) return out;
  if (!e.r && e.l === 2 && rng() < 0.6) {
    // восьмая → две шестнадцатые («тр-р»)
    out.splice(i, 1, { ...e, l: 1, fx: {} }, { ...e, p: e.p + 1, l: 1, fx: {} });
  } else if (e.r && i > 0 && rng() < 0.6) {
    out[i] = { p: e.p, l: e.l, x: 1 };
  } else if (!e.r && !e.x && i > 0 && e.l <= 2 && rng() < 0.5) {
    out[i] = { p: e.p, l: e.l, r: 1 };
  } else if (i + 1 < out.length && !e.r && out[i + 1].r) {
    e.l += out[i + 1].l; out.splice(i + 1, 1);
  }
  return out;
}

// Фраза: A A' A B (8 тактов: A A' A B A A' A C)
export function generateRiff(M, opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const rng = mulberry32(seed);
  const bars = opts.bars || 4;
  const ctx = { a: '^', b: '^' };
  const A = makeBar(M, rng, ctx, pickRhythm(M, rng, 4));
  const A2 = surelyVary(M, rng, A, 0.25);
  const Bb = rng() < 0.5 ? surelyVary(M, rng, A, 0.8) : makeBar(M, rng, { ...ctx }, null);
  const sections = { A, A2, B: Bb };
  let labels = ['A', 'A2', 'A', 'B'];
  if (bars === 8) {
    sections.C = surelyVary(M, rng, Bb, 0.5);
    labels = ['A', 'A2', 'A', 'B', 'A', 'A2', 'A', 'C'];
  }
  if (bars === 2) labels = ['A', 'B'];
  return finish(M, { seed, labels, sections, gen: 0 }, opts, rng);
}

// Кнопка «Вариация»: тот же рифф, но развитый
export function varyRiff(M, riff, opts = {}) {
  const seed = Math.floor(Math.random() * 1e9);
  const rng = mulberry32(seed);
  const s = riff.sections;
  const A = surelyVary(M, rng, s.A, 0.35);
  const sections = { A, A2: surelyVary(M, rng, A, 0.25), B: surelyVary(M, rng, s.B, 0.45) };
  if (s.C) sections.C = surelyVary(M, rng, sections.B, 0.5);
  return finish(M, { seed: riff.seed, vseed: seed, labels: riff.labels, sections, gen: (riff.gen || 0) + 1 }, { ...riff.opts, ...opts }, rng);
}

function finish(M, riff, opts, rng) {
  riff.opts = { ...opts };
  riff.tempo = opts.tempo || riff.opts.tempo || pickTempo(M, rng);
  riff.opts.tempo = riff.tempo;
  riff.tuning = opts.tuningNotes || bestTuning(M);
  riff.program = opts.program || +wpick(rng, M.programs) || 30;
  riff.bassProgram = +Object.entries(M.bassPrograms).sort((a, b) => b[1] - a[1])[0]?.[0] || 34;
  riff.drumBars = opts.drums === false ? null : makeDrums(M, rng, riff);
  riff.tex = riffToTex(M, riff, opts);
  return riff;
}

function pickTempo(M, rng) {
  const t = M.tempos.filter((x) => x >= 50 && x <= 260);
  if (!t.length) return 110;
  const base = t[Math.floor(rng() * t.length)];
  return Math.round(base * (0.95 + rng() * 0.1));
}
export function bestTuning(M) {
  const k = Object.entries(M.tunings).sort((a, b) => b[1] - a[1])[0];
  return k ? k[0].split(',').map(Number) : [40, 45, 50, 55, 59, 64];
}
export function tuningLabel(notes) {
  return matchTuning(notes) || notes.map((m) => noteName(m)).join(' ');
}

/* ---------- барабаны ---------- */
function makeDrums(M, rng, riff) {
  const grooves = Object.keys(M.drums).length ? M.drums : null;
  if (!grooves) return null;
  const follow = M.kick.tot ? M.kick.hit / M.kick.tot : 0;
  const n = riff.labels.length;
  // один грув на А-такты, другой (или тот же) на Б — как барабанщик держит партию
  const gA = pickGroove(M, rng);
  const gB = rng() < 0.5 ? gA : pickGroove(M, rng);
  const out = [];
  riff.labels.forEach((lab, i) => {
    const bar = riff.sections[lab];
    let key = lab.startsWith('A') ? gA : gB;
    if (i === n - 1 && n >= 4 && Object.keys(M.fills).length && rng() < 0.55) key = wpick(rng, M.fills);
    const slots = key.split(' ').map((s) => (s ? s.split('+').map(Number) : []));
    // бочка в унисон с гитарой, если в жанре так принято
    if (follow > 0.45 && !(i === n - 1 && key !== gA && key !== gB)) {
      for (const s of slots) { const k = s.indexOf(36); if (k >= 0) s.splice(k, 1); }
      for (const e of bar) if (!e.r && !e.x && (rng() < follow + 0.15 || e.p % 4 === 0)) slots[e.p].push(36);
    }
    if (i === 0) { if (!slots[0].includes(49)) slots[0].push(49); const h = slots[0].indexOf(42); if (h >= 0) slots[0].splice(h, 1); }
    out.push(slots.map((s) => [...new Set(s)].sort((a, b) => a - b)));
  });
  return out;
}
function pickGroove(M, rng) {
  // предпочитаем «полные» грувы с тарелками
  for (let i = 0; i < 10; i++) {
    const k = wpick(rng, M.drums);
    if (/42|46|51|52/.test(k)) return k;
  }
  return wpick(rng, M.drums);
}

/* ---------- аппликатура и alphaTex ---------- */
// Ставим ноты на гриф: низкие струны, рука в одной позиции, растяжка не больше 4 ладов
function fingerBar(bar, tuning, tonic, hand) {
  const n = tuning.length;
  const out = [];
  for (const e of bar) {
    if (e.r) { out.push({ ...e, notes: [] }); continue; }
    if (e.x) { out.push({ ...e, notes: [{ s: 0, f: 'x' }, { s: 1, f: 'x' }] }); continue; }
    const { rel, shape } = parseToken(e.tok);
    let root = tonic + rel;
    while (root < tuning[0]) root += 12;
    let best = null;
    for (let s = 0; s < Math.min(n, 4); s++) {
      const f = root - tuning[s];
      if (f < 0 || f > 17) continue;
      const notes = [{ s, f }];
      let ok = true;
      for (const iv of shape) {
        const m = root + iv;
        let place = null;
        for (let s2 = s + 1; s2 < n; s2++) {
          if (notes.some((x) => x.s === s2)) continue;
          const f2 = m - tuning[s2];
          if (f2 < 0 || f2 > 20) continue;
          const fretted = [...notes.filter((x) => x.f > 0).map((x) => x.f), f2].filter((x) => x > 0);
          if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 4) continue;
          place = { s: s2, f: f2 };
          break;
        }
        if (place) notes.push(place); else ok = false;
      }
      let cost = s * 1.4 + (ok ? 0 : 3) + (f > 0 ? Math.max(0, Math.abs(f - hand.f) - 3) * 1.3 + f * 0.06 : 0);
      if (!best || cost < best.cost) best = { cost, notes };
    }
    if (!best) best = { notes: [{ s: 0, f: Math.max(0, root - tuning[0]) }] };
    const fr = best.notes.filter((x) => x.f > 0).map((x) => x.f);
    if (fr.length) hand.f = Math.min(...fr);
    out.push({ ...e, notes: best.notes });
  }
  return out;
}

const DUR = [[16, '1', ''], [12, '2', ' {d}'], [8, '2', ''], [6, '4', ' {d}'], [4, '4', ''], [3, '8', ' {d}'], [2, '8', ''], [1, '16', '']];
function splitLen(l) {
  const out = [];
  while (l > 0) { const d = DUR.find(([x]) => x <= l); out.push(d); l -= d[0]; }
  return out;
}

function barTex(fb, nStr, opts = {}) {
  const toks = [];
  for (const e of fb) {
    const pieces = splitLen(e.l);
    pieces.forEach(([, v, dot], k) => {
      if (e.r || !e.notes.length) { toks.push(`:${v} r${dot}`); return; }
      const fx = [];
      if (k === 0) {
        if (e.pm) fx.push('pm');
        if (e.fx && e.fx.sl) fx.push('sl');
        if (e.fx && e.fx.v) fx.push('v');
        if (e.fx && e.fx.st) fx.push('st');
        if (e.fx && e.fx.b && e.notes.length === 1) fx.push('b (0 4)');
      } else if (e.pm) fx.push('pm');
      const f = fx.length ? `{${fx.join(' ')}}` : '';
      const ns = e.notes.map((x) => `${k > 0 && x.f !== 'x' ? '-' : x.f}.${nStr - x.s}${x.f === 'x' ? '' : f}`);
      toks.push(`:${v} ${ns.length > 1 ? '(' + ns.join(' ') + ')' : ns[0]}${dot}`);
    });
  }
  return toks.join(' ');
}

function drumTex(slots) {
  const toks = [];
  let i = 0;
  // пустые позиции в начале — паузы
  while (i < 16 && !slots[i].length) i++;
  if (i > 0) for (const [, v, dot] of splitLen(i)) toks.push(`:${v} r${dot}`);
  while (i < 16) {
    let j = i + 1;
    while (j < 16 && !slots[j].length) j++;
    const notes = slots[i];
    splitLen(j - i).forEach(([, v, dot], k) => {
      if (k > 0) toks.push(`:${v} r${dot}`);
      else toks.push(`:${v} ${notes.length > 1 ? '(' + notes.join(' ') + ')' : notes[0]}${dot}`);
    });
    i = j;
  }
  return toks.join(' ');
}

const texName = (notes) => [...notes].reverse().map((m) => noteName(m) + noteOctave(m)).join(' ');

export function riffToTex(M, riff, opts = {}) {
  const tuning = riff.tuning;
  const tonic = tuning[0];
  const hand = { f: 0 };
  // одинаковые такты играются одинаково (одна аппликатура на метку)
  const cache = {};
  const gBars = riff.labels.map((lab) => (cache[lab] = cache[lab] || fingerBar(riff.sections[lab], tuning, tonic, hand)));
  const title = riff.title || `${M.name || 'ИИ'} — рифф #${String(riff.seed).slice(-4)}${riff.gen ? ' · вар. ' + riff.gen : ''}`;
  riff.title = title;
  const q = (s) => String(s).replace(/["\\]/g, ' ');
  let tex = `\\title "${q(title)}"\n\\artist "Riff Lab · ИИ"\n\\tempo ${riff.tempo}\n`;
  tex += `\\track "Guitar"\n\\instrument ${riff.program}\n\\tuning (${texName(tuning)})\n`;
  tex += gBars.map((b) => barTex(b, tuning.length)).join(' |\n') + '\n';
  if (opts.bass !== false) {
    // бас в унисон с гитарой октавой ниже, строй под гитару
    const bt = tuning.slice(0, 4).map((m) => m - 12);
    const hb = { f: 0 };
    const bcache = {};
    const bassBars = riff.labels.map((lab) => bcache[lab] = bcache[lab] || fingerBar(riff.sections[lab].map((e) => (e.tok ? { ...e, tok: String(parseToken(e.tok).rel), fx: {} } : e.x ? { p: e.p, l: e.l, r: 1 } : e)), bt, bt[0], hb));
    tex += `\\track "Bass"\n\\instrument ${riff.bassProgram}\n\\tuning (${texName(bt)})\n`;
    tex += bassBars.map((b) => barTex(b, bt.length)).join(' |\n') + '\n';
  }
  if (riff.drumBars) {
    tex += `\\track "Drums"\n\\instrument percussion\n\\staff{score}\n`;
    tex += riff.drumBars.map(drumTex).join(' |\n') + '\n';
  }
  return tex;
}

/* ---------- сбор песен для обучения ---------- */
// api: { searchSongs(q, size), fetchTab(id) }; onProgress(done, total, text)
export async function collectSongs(style, api, onProgress = () => {}, target = 22) {
  const artists = style.artists;
  const per = Math.max(2, Math.min(8, Math.ceil(target / artists.length)));
  onProgress(0, 1, 'Ищу песни…');
  const lists = await Promise.all(artists.map((a) => api.searchSongs(a, 12).catch(() => [])));
  const picked = [];
  const seen = new Set();
  lists.forEach((list, i) => {
    const want = artists[i].toLowerCase();
    const own = list.filter((s) => s && s.artist && s.artist.toLowerCase().replace(/[^a-zа-я0-9]/g, '').includes(want.replace(/[^a-zа-я0-9]/g, '')));
    const src = own.length ? own : (style.builtin ? [] : list);
    let n = 0;
    for (const s of src) {
      const k = (s.artist + '|' + s.title).toLowerCase().replace(/\(.*?\)|live|remaster(ed)?/g, '').trim();
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push(s);
      if (++n >= per) break;
    }
  });
  const songs = [];
  let done = 0;
  const queue = picked.slice(0, Math.max(target + 4, 8));
  const total = queue.length;
  if (!total) throw new Error('Не нашёл песен по этому запросу');
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      try {
        const tab = await api.fetchTab(s.id);
        songs.push(tab);
      } catch (e) { /* песню пропускаем */ }
      done++;
      onProgress(done, total, `${s.artist} — ${s.title}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return songs;
}
