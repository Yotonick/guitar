// ИИ-соло и мелодии поверх риффа. Учится на сольных тактах тех же песен Songsterr:
// какие ступени лада звучат (и какие на сильных долях), как ходит мелодия (интервалы после
// интервалов), ритмы соло и мелодий, где на грифе играют, как часто бенды, вибрато, легато, слайды.
// Генерация: фразы «вопрос — ответ», опорные ноты аккорда риффа на сильных долях, кульминация
// в конце, аппликатура с позицией руки (Витерби), отдельная дорожка в alphaTex.
import { mulberry32, wpick, guitarBars, songTonic, partProgram, parseToken } from './riffai.js';

export const LEAD_VERSION = 1;

/* ---------- мелочи ---------- */
const inc = (o, k, w = 1) => { o[k] = (o[k] || 0) + w; };
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const mod12 = (x) => ((x % 12) + 12) % 12;
const sixteenths = (dur) => {
  const [n, d] = Array.isArray(dur) && dur.length === 2 ? dur : [1, 4];
  const x = (16 * n) / d;
  return Math.abs(x - Math.round(x)) < 1e-6 && x >= 1 ? Math.round(x) : null;
};
// корзина предыдущего интервала: направление и размер
const ivBucket = (iv) => (iv == null ? 'S' : iv === 0 ? '0' : (iv > 0 ? 'u' : 'd') + (Math.abs(iv) <= 2 ? 1 : Math.abs(iv) <= 5 ? 3 : 'L'));
const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));

// натуральный минор с блюзовой нотой — запас, если в жанре мало соло
const FALLBACK_SCALE = [10, 0.2, 3.5, 8, 0.4, 7, 1.6, 10, 3.5, 0.6, 7, 0.5];
const BASE_IV = (iv) => { const a = Math.abs(iv); return a === 0 ? 2.5 : a === 1 ? 6 : a === 2 ? 8 : a === 3 ? 6 : a === 4 ? 3.5 : a === 5 ? 4 : a === 7 ? 2.2 : a === 12 ? 0.7 : a <= 9 ? 0.8 : 0.25; };

// запасные ритмы (сетка 1/16: позиция.длина.тип)
const BUILTIN = {
  solo: [
    '0.2.n,2.2.n,4.1.n,5.1.n,6.2.n,8.4.n,12.4.n',
    '0.1.n,1.1.n,2.1.n,3.1.n,4.2.n,6.2.n,8.2.n,10.2.n,12.4.n',
    '0.4.n,4.2.n,6.2.n,8.1.n,9.1.n,10.1.n,11.1.n,12.4.n',
    '0.2.r,2.2.n,4.2.n,6.2.n,8.6.n,14.2.n',
    '0.1.n,1.1.n,2.1.n,3.1.n,4.1.n,5.1.n,6.1.n,7.1.n,8.2.n,10.2.n,12.2.n,14.2.n',
    '0.3.n,3.3.n,6.2.n,8.2.n,10.2.n,12.4.n',
    '0.2.n,2.1.n,3.1.n,4.2.n,6.1.n,7.1.n,8.2.n,10.1.n,11.1.n,12.2.n,14.2.n',
    '0.6.n,6.2.n,8.2.n,10.2.n,12.2.n,14.2.n',
  ],
  melody: [
    '0.4.n,4.4.n,8.6.n,14.2.n',
    '0.6.n,6.2.n,8.8.n',
    '0.2.r,2.2.n,4.4.n,8.2.n,10.2.n,12.4.n',
    '0.8.n,8.4.n,12.2.n,14.2.n',
    '0.4.n,4.2.n,6.2.n,8.8.n',
    '0.3.n,3.3.n,6.2.n,8.4.n,12.4.n',
    '0.4.n,4.4.n,8.4.n,12.4.n',
    '0.2.n,2.2.n,4.4.n,8.2.n,10.2.n,12.4.n',
  ],
};

/* ---------- разбор сольных тактов ---------- */
function bendSemis(b) {
  if (!b) return 0;
  let t = typeof b === 'object' ? Number(b.tone) : NaN;
  if (!(t > 0) && b && Array.isArray(b.points)) t = Math.max(0, ...b.points.map((x) => Number(x.tone) || 0));
  if (!(t > 0)) return 2;
  return t >= 75 ? 2 : t >= 25 ? 1 : 0;
}
// Такт → события с одной (верхней) нотой: {p, l, m, n, bd, h, sl, v, pm}
function leadBars(part) {
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
      const notes = (b.notes || []).filter((n) => n && !n.rest && n.fret != null && tun[n.string] != null && !n.dead);
      if (b.rest || !notes.length) ev.push({ p, l, r: 1 });
      else if (notes.every((n) => n.tie)) {
        const prev = ev[ev.length - 1];
        if (prev && !prev.r) prev.l += l; else ev.push({ p, l, r: 1 });
      } else {
        const live = notes.filter((n) => !n.tie);
        const pitched = live.map((n) => ({ n, m: tun[n.string] + Number(n.fret) + bendSemis(n.bend) }));
        pitched.sort((a, b2) => b2.m - a.m);
        const t = pitched[0];
        ev.push({ p, l, m: t.m, n: live.length, bd: t.n.bend ? bendSemis(t.n.bend) : 0, h: !!t.n.hp, sl: !!t.n.slide, v: !!(t.n.leftHandVibrato || t.n.vibrato), pm: !!b.palmMute });
      }
      p += l;
    }
    if (p !== 16) return null;
    return ev;
  });
}
function isLeadBar(ev, lowOpen) {
  const on = ev.filter((e) => !e.r);
  if (on.length < 2) return false;
  if (on.filter((e) => e.n === 1).length < on.length * 0.75) return false;
  if (on.filter((e) => e.pm).length > on.length * 0.4) return false; // глушёнка — это рифф
  const ms = on.map((e) => e.m).sort((a, b) => a - b);
  return ms[Math.floor(ms.length / 2)] >= lowOpen + 15;
}
const isMelodyBar = (ev) => { const on = ev.filter((e) => !e.r); return on.length <= 6 && on.reduce((a, e) => a + e.l, 0) / on.length >= 2; };

/* ---------- обучение ---------- */
export function trainLead(songs) {
  const L = {
    v: LEAD_VERSION, bars: 0, barsS: 0, barsM: 0, songs: 0,
    rhyS: {}, rhyM: {}, pcs: new Array(12).fill(0), strong: new Array(12).fill(0),
    ivC: {}, ivP: {}, ivA: {}, reg: {},
    tech: { notes: 0, b: 0, bHalf: 0, v: 0, vLong: 0, long: 0, sl: 0, h: 0 },
    progS: {}, progM: {},
  };
  for (const song of songs) {
    const parts = (song.parts || []).filter((p) => p && p.kind === 'guitar' && p.data && Array.isArray(p.data.measures) && Array.isArray(p.data.tuning) && p.data.tuning.length >= 4);
    if (!parts.length) continue;
    // тоника песни: по ритм-гитаре (самая низкая по нотам дорожка), так же, как у риффов
    let tonicPc = null;
    let bestLow = Infinity;
    for (const part of parts) {
      const gb = guitarBars(part);
      const ms = [];
      for (const ev of gb) if (ev) for (const e of ev) if (!e.r && !e.x && e.ns.length) ms.push(Math.min(...e.ns.map((n) => n.m)));
      if (ms.length < 16) continue;
      ms.sort((a, b) => a - b);
      const med = ms[Math.floor(ms.length / 2)] - Math.min(...part.data.tuning);
      if (med < bestLow) { bestLow = med; tonicPc = mod12(songTonic(gb, Math.min(...part.data.tuning))); }
    }
    let usedSong = false;
    for (const part of parts) {
      const prog = partProgram(part);
      if (prog < 24 || prog > 31) continue;
      const lowOpen = Math.min(...part.data.tuning);
      const bars = leadBars(part);
      const lb = bars.map((ev) => (ev && isLeadBar(ev, lowOpen) ? ev : null));
      if (lb.filter(Boolean).length < 2) continue;
      // тоника, если ритм-гитары нет: самая весомая нота сольных тактов
      let tpc = tonicPc;
      if (tpc == null) {
        const pc = new Array(12).fill(0);
        for (const ev of lb) if (ev) for (const e of ev) if (!e.r) pc[mod12(e.m)] += e.l * (e.p % 4 === 0 ? 1.5 : 1);
        tpc = pc.indexOf(Math.max(...pc));
      }
      const seen = new Map();
      let prev = null, prevIv = null;
      for (const ev of lb) {
        if (!ev) { prev = null; prevIv = null; continue; }
        const sig = ev.map((e) => `${e.p}/${e.l}/${e.r ? 'r' : e.m}`).join(' ');
        const rep = (seen.get(sig) || 0) + 1;
        seen.set(sig, rep);
        if (rep > 2) continue;
        const w = rep === 1 ? 1 : 0.4;
        usedSong = true;
        L.bars += w;
        const mel = isMelodyBar(ev);
        if (mel) { L.barsM += w; inc(L.progM, prog, w); } else { L.barsS += w; inc(L.progS, prog, w); }
        inc(mel ? L.rhyM : L.rhyS, ev.map((e) => `${e.p}.${e.l}.${e.r ? 'r' : 'n'}`).join(','), w);
        for (const e of ev) {
          if (e.r) { if (e.l >= 4) { prev = null; prevIv = null; } continue; }
          const pc = mod12(e.m - tpc);
          L.pcs[pc] += e.l * w;
          if (e.p % 4 === 0) L.strong[pc] += e.l * w;
          inc(L.reg, e.m - lowOpen, w);
          if (prev != null) {
            const iv = e.m - prev;
            if (Math.abs(iv) <= 12) {
              const ppc = mod12(prev - tpc);
              const ck = ivBucket(prevIv) + '|' + ppc;
              inc((L.ivC[ck] = L.ivC[ck] || {}), iv, w);
              inc((L.ivP[ppc] = L.ivP[ppc] || {}), iv, w);
              inc(L.ivA, iv, w);
              prevIv = iv;
            } else prevIv = null;
          }
          prev = e.m;
          L.tech.notes += w;
          if (e.bd === 2) L.tech.b += w;
          if (e.bd === 1) L.tech.bHalf += w;
          if (e.v) L.tech.v += w;
          if (e.l >= 4) { L.tech.long += w; if (e.v) L.tech.vLong += w; }
          if (e.sl) L.tech.sl += w;
          if (e.h) L.tech.h += w;
        }
      }
    }
    if (usedSong) L.songs++;
  }
  L.rhyS = top(L.rhyS, 160);
  L.rhyM = top(L.rhyM, 120);
  const r1 = (x) => Math.round(x * 10) / 10;
  L.pcs = L.pcs.map(r1);
  L.strong = L.strong.map(r1);
  // контексты с одной-двумя нотами только раздувают модель
  for (const k of Object.keys(L.ivC)) if (sum(L.ivC[k]) < 2) delete L.ivC[k];
  return L;
}

export function leadSummary(L) {
  return L ? { songs: L.songs, bars: Math.round(L.bars), solo: Math.round(L.barsS), melody: Math.round(L.barsM) } : null;
}

/* ---------- генерация ---------- */
const parseRhythm = (key) => key.split(',').map((s) => { const [p, l, t] = s.split('.'); return { p: +p, l: +l, t }; });
const onsets = (rh) => rh.filter((s) => s.t !== 'r').length;

function rhythmPool(L, mode) {
  const learned = (mode === 'melody' ? L && L.rhyM : L && L.rhyS) || {};
  const pool = {};
  for (const [k, w] of Object.entries(learned)) {
    const n = onsets(parseRhythm(k));
    const rest = parseRhythm(k).filter((s) => s.t === 'r').reduce((a, s) => a + s.l, 0);
    if (rest > 8) continue;
    if (mode === 'solo' ? n >= 4 : n >= 2 && n <= 7) pool[k] = w;
  }
  const lw = sum(pool);
  const conf = Math.min(1, Object.keys(pool).length / 25);
  // запасные ритмы весят тем меньше, чем больше выученных
  const bw = Math.max(0.15, 1 - conf) * Math.max(lw, 8) / BUILTIN[mode].length;
  for (const k of BUILTIN[mode]) pool[k] = (pool[k] || 0) + bw;
  return pool;
}
// ритм из нужной «плотности»: band = [от, до] в долях отсортированного по числу нот пула
function pickRhythm(rng, pool, band) {
  const arr = Object.entries(pool).sort((a, b) => onsets(parseRhythm(a[0])) - onsets(parseRhythm(b[0])));
  const lo = Math.floor(arr.length * band[0]);
  const hi = Math.max(lo + 1, Math.ceil(arr.length * band[1]));
  return parseRhythm(wpick(rng, arr.slice(lo, hi)));
}
// концовка фразы: начало настоящего ритма + длинная нота до конца такта
function endRhythm(rng, pool, hold) {
  const rh = pickRhythm(rng, pool, [0.2, 0.8]);
  const cut = 16 - hold;
  const out = [];
  for (const s of rh) {
    if (s.p >= cut) break;
    out.push({ ...s, l: Math.min(s.l, cut - s.p) });
  }
  out.push({ p: cut, l: hold, t: 'n' });
  return out;
}

function scaleOf(L) {
  const lp = L ? L.pcs : null;
  const lmax = lp ? Math.max(...lp) : 0;
  const conf = L && lmax ? Math.min(1, L.bars / 30) : 0;
  const S = FALLBACK_SCALE.map((f, i) => conf * (lmax ? lp[i] / lmax : 0) + (1 - conf) * (f / 10));
  const mx = Math.max(...S);
  // ноты мимо лада почти выключаем: в соло они звучат как ошибка
  return S.map((x) => (x / mx < 0.07 ? x * 0.08 : x / mx));
}

// Главная нота такта риффа (относительно тоники): длинная, на сильной доле
function barRoot(bar) {
  const w = {};
  for (const e of bar) {
    if (!e.tok) continue;
    const rel = mod12(parseToken(e.tok).rel);
    inc(w, rel, e.l * (e.p % 4 === 0 ? 1.5 : 1) * (e.p === 0 ? 1.6 : 1) * (rel === 0 ? 1.15 : 1));
  }
  const best = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : 0;
}
function chordTones(root, S) {
  const third = S[mod12(root + 3)] >= S[mod12(root + 4)] ? 3 : 4;
  return new Set([root, mod12(root + third), mod12(root + 7)]);
}

function regionOf(L, tuning, mode) {
  const lowOpen = tuning[0];
  const maxM = tuning[tuning.length - 1] + 22 - lowOpen;
  const reg = L ? Object.entries(L.reg).map(([k, w]) => [+k, w]).sort((a, b) => a[0] - b[0]) : [];
  const tot = reg.reduce((a, x) => a + x[1], 0);
  const pct = (q) => { let acc = 0; for (const [k, w] of reg) { acc += w; if (acc >= tot * q) return k; } return reg.length ? reg[reg.length - 1][0] : 0; };
  let lo, mid, hi;
  if (tot >= 60) { lo = pct(0.08); mid = pct(0.5); hi = pct(0.95); } else { lo = 22; mid = 29; hi = 41; }
  if (mode === 'melody') { mid = Math.max(lo + 4, mid - 4); lo = Math.max(10, mid - 9); hi = mid + 9; }
  hi = Math.min(hi, maxM);
  lo = Math.max(5, Math.min(lo, hi - 12));
  mid = Math.min(Math.max(mid, lo + 4), hi - 4);
  return { lo: lowOpen + lo, mid: lowOpen + mid, hi: lowOpen + hi };
}

function ivDist(L, prevIv, pc, cache) {
  const key = ivBucket(prevIv) + '|' + pc;
  if (cache[key]) return cache[key];
  const norm = (t) => { const s = sum(t); const o = {}; if (s) for (const [k, w] of Object.entries(t)) o[k] = w / s; return { o, s }; };
  const c = norm((L && L.ivC[key]) || {}), p = norm((L && L.ivP[pc]) || {}), a = norm((L && L.ivA) || {});
  const base = {};
  for (let iv = -12; iv <= 12; iv++) base[iv] = BASE_IV(iv);
  const b = norm(base);
  const wc = c.s >= 5 ? 0.45 : c.s >= 2 ? 0.2 : 0, wp = p.s >= 5 ? 0.25 : 0, wa = a.s >= 10 ? 0.2 : 0;
  const wb = 1 - wc - wp - wa;
  const out = {};
  for (let iv = -12; iv <= 12; iv++) out[iv] = wc * (c.o[iv] || 0) + wp * (p.o[iv] || 0) + wa * (a.o[iv] || 0) + wb * b.o[iv] + 1e-4;
  return (cache[key] = out);
}

// Ноты для одного такта по ритму: интервалы из модели × лад × опорные ноты аккорда × тяга к регистру
function pitchBar(ctx, rh, chord, target, opts = {}) {
  const { rng, L, S, reg, tonicPc, mode, cache } = ctx;
  const out = [];
  const last = rh.reduce((a, s, i) => (s.t !== 'r' ? i : a), -1);
  rh.forEach((s, i) => {
    if (s.t === 'r') { out.push({ p: s.p, l: s.l, r: 1 }); if (s.l >= 4) ctx.prevIv = null; return; }
    const strong = s.p % 4 === 0;
    const isEnd = i === last && opts.cadence;
    const prev = ctx.prev, pprev = ctx.pprev;
    const dist = prev != null ? ivDist(L, ctx.prevIv, mod12(prev - tonicPc), cache) : null;
    const sigma = mode === 'melody' ? 4 : 6;
    const cand = [];
    for (let c = reg.lo; c <= reg.hi; c++) {
      const pc = mod12(c - tonicPc);
      let w = Math.pow(S[pc], 1.3);
      if (strong || s.l >= 4) w *= chord.has(pc) ? (mode === 'melody' ? 4 : 3) : 0.45;
      w *= Math.exp(-((c - target) ** 2) / (2 * sigma * sigma));
      if (prev != null) {
        const iv = c - prev;
        if (Math.abs(iv) > 12) continue;
        w *= dist[iv];
        if (mode === 'melody') w *= Math.abs(iv) <= 2 ? 1.6 : Math.abs(iv) <= 4 ? 1 : 0.45;
        // после скачка — шаг обратно (заполнение скачка)
        if (ctx.prevIv != null && Math.abs(ctx.prevIv) >= 5 && Math.sign(iv) === -Math.sign(ctx.prevIv) && Math.abs(iv) <= 3) w *= 2;
        if (c === prev && c === pprev) w *= 0.15;
      } else w *= chord.has(pc) ? 3 : 0.5;
      if (isEnd) w *= chord.has(pc) ? (pc === opts.endPc ? 6 : 1.5) : 0.02;
      if (w > 0) cand.push([c, w]);
    }
    const m = cand.length ? +wpick(rng, cand) : (prev ?? reg.mid);
    ctx.prevIv = prev != null ? m - prev : null;
    ctx.pprev = prev; ctx.prev = m;
    out.push({ p: s.p, l: s.l, m });
  });
  return out;
}

const SINGLE = new Set([1, 2, 3, 4, 6, 8, 12, 16]); // длительности одним символом (без лиги)
function decorateLead(ctx, bars) {
  const { rng, L, S, tonicPc, mode } = ctx;
  const t = (L && L.tech) || { notes: 0 };
  const pr = (k, def) => (t.notes >= 40 ? t[k] / t.notes : def);
  const pB = pr('b', mode === 'solo' ? 0.08 : 0.02) + pr('bHalf', 0.02) * 0.5;
  const pV = t.long >= 10 ? t.vLong / t.long : mode === 'solo' ? 0.5 : 0.35;
  const pH = pr('h', mode === 'solo' ? 0.18 : 0.08);
  const pS = pr('sl', mode === 'solo' ? 0.06 : 0.1);
  const flat = bars.flat();
  flat.forEach((e, i) => {
    if (e.r) return;
    e.fx = {};
    const next = flat[i + 1] && !flat[i + 1].r ? flat[i + 1] : null;
    // бенд: тянем к нужной ноте с ноты на тон (или полтона) ниже, если она в ладу
    if (SINGLE.has(e.l) && e.l >= 2 && rng() < pB * (e.l >= 4 ? 2.2 : 1.2)) {
      const full = S[mod12(e.m - 2 - tonicPc)] > 0.25;
      const half = S[mod12(e.m - 1 - tonicPc)] > 0.25;
      if (full || half) e.fx.bd = full ? 2 : 1;
    }
    if (e.l >= 4 && rng() < pV * (e.fx.bd ? 1.3 : 1)) e.fx.v = 1;
    if (next && !e.fx.bd && !next.fx) {
      const iv = Math.abs(next.m - e.m);
      if (e.l <= 2 && next.l <= 4 && iv >= 1 && iv <= 4 && rng() < pH * 1.6) e.fx.h = 1;
      else if (e.l >= 2 && iv >= 1 && iv <= 5 && rng() < pS * 1.5) e.fx.sl = 1;
    }
  });
  // легато в ноту с бендом звучит криво — снимаем
  flat.forEach((e, i) => { const nx = flat[i + 1]; if (e.fx && nx && !nx.r && nx.fx && nx.fx.bd) { e.fx.h = 0; e.fx.sl = 0; } });
  // последняя нота соло: долгая, с вибрато (часто — с бендом)
  const lastN = [...flat].reverse().find((e) => !e.r);
  if (lastN) { lastN.fx = lastN.fx || {}; lastN.fx.v = 1; lastN.fx.h = 0; lastN.fx.sl = 0; }
}

export function generateLead(M, riff, mode = 'solo', opts = {}) {
  const L = M.lead || null;
  const rseed = opts.rseed ?? Math.floor(Math.random() * 1e9);
  const pseed = opts.pseed ?? Math.floor(Math.random() * 1e9);
  const rr = mulberry32(rseed); // ритм
  const rng = mulberry32(pseed); // ноты и приёмы
  const tuning = riff.tuning;
  const tonicPc = mod12(tuning[0]);
  const S = scaleOf(L);
  const reg = regionOf(L, tuning, mode);
  const pool = rhythmPool(L, mode);
  const labels = riff.labels;
  const n = labels.length;
  const roots = labels.map((lab) => barRoot(riff.sections[lab]));
  const chords = roots.map((r) => chordTones(r, S));
  const ctx = { rng, L, S, reg, tonicPc, mode, cache: {}, prev: null, pprev: null, prevIv: null };

  // ритмы: фраза из 4 тактов (вопрос — ответ), во второй фразе плотнее и выше
  const rhythms = [];
  const phrases = Math.max(1, Math.ceil(n / 4));
  for (let ph = 0; ph < phrases; ph++) {
    const base = ph * 4;
    if (mode === 'melody') {
      const R1 = ph > 0 && rr() < 0.7 ? rhythms[0] : pickRhythm(rr, pool, [0.1, 0.7]);
      const R2 = ph > 0 && rr() < 0.5 ? rhythms[1] : pickRhythm(rr, pool, [0.1, 0.8]);
      const R3 = rr() < 0.7 ? R1 : pickRhythm(rr, pool, [0.1, 0.7]);
      const hold = ph === phrases - 1 ? (rr() < 0.5 ? 8 : 12) : (rr() < 0.5 ? 4 : 8);
      [R1, R2, R3, endRhythm(rr, pool, hold)].forEach((r, i) => { if (base + i < n) rhythms.push(r); });
    } else {
      const lift = ph * 0.15;
      const R1 = pickRhythm(rr, pool, [0.25 + lift, 0.7 + lift * 0.5]);
      const R2 = rr() < 0.45 ? R1 : pickRhythm(rr, pool, [0.25 + lift, 0.75 + lift * 0.5]);
      const R3 = pickRhythm(rr, pool, [0.6, 1]);
      const hold = ph === phrases - 1 ? (rr() < 0.6 ? 8 : 6) : (rr() < 0.5 ? 4 : 6);
      [R1, R2, R3, endRhythm(rr, pool, hold)].forEach((r, i) => { if (base + i < n) rhythms.push(r); });
    }
  }
  while (rhythms.length < n) rhythms.push(pickRhythm(rr, pool, [0.2, 0.8]));

  // регистр по ходу соло: подъём к кульминации; у мелодии — дуга
  const span = reg.hi - reg.mid;
  const contour = mode === 'melody'
    ? labels.map((_, i) => reg.mid + Math.round([0, 2, 0, -2, 1, 4, 2, -2][i % 8] * 0.6))
    : labels.map((_, i) => Math.round(reg.mid - 3 + (span + 3) * (n > 1 ? i / (n - 1) : 0) * 0.85));

  const bars = [];
  for (let i = 0; i < n; i++) {
    const phraseEnd = i % 4 === 3 || i === n - 1;
    // мелодия: третий такт фразы повторяет первый (если аккорд тот же) — так мелодия запоминается
    if (mode === 'melody' && i % 4 === 2 && rhythms[i] === rhythms[i - 2] && roots[i] === roots[i - 2]) {
      bars.push(bars[i - 2].map((e) => ({ ...e })));
      const lastN = [...bars[i]].reverse().find((e) => !e.r);
      if (lastN) { ctx.pprev = ctx.prev; ctx.prev = lastN.m; ctx.prevIv = null; }
      continue;
    }
    if (mode === 'melody' && i >= 4 && i % 4 === 0 && roots[i] === roots[0] && rhythms[i] === rhythms[0]) {
      bars.push(bars[0].map((e) => ({ ...e })));
      const lastN = [...bars[i]].reverse().find((e) => !e.r);
      if (lastN) { ctx.pprev = ctx.prev; ctx.prev = lastN.m; ctx.prevIv = null; }
      continue;
    }
    const endPc = i === n - 1 ? 0 : [...chords[i]][0];
    bars.push(pitchBar(ctx, rhythms[i], chords[i], contour[i], { cadence: phraseEnd, endPc }));
  }
  decorateLead(ctx, bars);
  const program = mode === 'melody'
    ? (L && L.barsM >= 6 ? +Object.entries(L.progM).sort((a, b) => b[1] - a[1])[0][0] : 27)
    : (riff.program || (L && L.barsS >= 6 ? +Object.entries(L.progS).sort((a, b) => b[1] - a[1])[0][0] : 30));
  return { mode, rseed, pseed, bars, program };
}

/* ---------- аппликатура (Витерби по всей партии) ---------- */
function fingerLead(lead, tuning) {
  const nS = tuning.length;
  const notes = [];
  lead.bars.forEach((bar) => bar.forEach((e) => { if (!e.r) notes.push(e); else if (e.l >= 2) notes.push({ gap: 1 }); }));
  const seq = notes.filter((x) => !x.gap);
  if (!seq.length) return;
  const gapBefore = [];
  { let g = 0; for (const x of notes) { if (x.gap) g = 1; else { gapBefore.push(g); g = 0; } } }
  const solo = lead.mode === 'solo';
  const cands = seq.map((e) => {
    const written = e.m - (e.fx && e.fx.bd ? e.fx.bd : 0);
    const out = [];
    for (let s = 0; s < nS; s++) {
      const f = written - tuning[s];
      if (f < 0 || f > 22) continue;
      let c = 0;
      const fromTop = nS - 1 - s;
      if (fromTop >= 4) c += solo ? 2 : 1;
      if (e.fx && e.fx.bd && fromTop >= 3) c += 2.5; // бенды — на тонких струнах
      if (f === 0) c += solo ? 1 : 0.3;
      if (f > 17) c += (f - 17) * 0.3;
      out.push({ s, f, c });
    }
    if (!out.length) out.push({ s: nS - 1, f: Math.max(0, Math.min(22, written - tuning[nS - 1])), c: 10 });
    return out;
  });
  const cost = [cands[0].map((x) => x.c)];
  const back = [cands[0].map(() => -1)];
  for (let i = 1; i < seq.length; i++) {
    const link = seq[i - 1].fx && (seq[i - 1].fx.h || seq[i - 1].fx.sl);
    cost.push([]); back.push([]);
    cands[i].forEach((b, j) => {
      let best = Infinity, arg = 0;
      cands[i - 1].forEach((a, k) => {
        let t = 0;
        if (link && a.s !== b.s) t += 50;
        if (a.f > 0 && b.f > 0) {
          const d = Math.abs(b.f - a.f);
          t += d > 4 ? (d - 4) * 1.2 + 1 : d * 0.1;
        }
        const ds = Math.abs(b.s - a.s);
        if (ds > 2) t += (ds - 2) * 0.5;
        if (gapBefore[i]) t *= 0.5;
        const v = cost[i - 1][k] + t;
        if (v < best) { best = v; arg = k; }
      });
      cost[i][j] = best + b.c;
      back[i][j] = arg;
    });
  }
  let j = cost[seq.length - 1].indexOf(Math.min(...cost[seq.length - 1]));
  for (let i = seq.length - 1; i >= 0; i--) {
    const c = cands[i][j];
    seq[i].s = c.s; seq[i].f = c.f;
    j = back[i][j];
  }
  // легато, которое не легло на одну струну, снимаем
  for (let i = 0; i < seq.length - 1; i++) {
    const fx = seq[i].fx;
    if (fx && (fx.h || fx.sl) && seq[i + 1].s !== seq[i].s) { fx.h = 0; fx.sl = 0; }
  }
  if (seq[seq.length - 1].fx) { seq[seq.length - 1].fx.h = 0; seq[seq.length - 1].fx.sl = 0; }
}

const DUR = [[16, '1', ''], [12, '2', ' {d}'], [8, '2', ''], [6, '4', ' {d}'], [4, '4', ''], [3, '8', ' {d}'], [2, '8', ''], [1, '16', '']];
function splitLen(l) {
  const out = [];
  while (l > 0) { const d = DUR.find(([x]) => x <= l); out.push(d); l -= d[0]; }
  return out;
}
function leadBarTex(bar, nS) {
  const toks = [];
  for (const e of bar) {
    const pieces = splitLen(e.l);
    pieces.forEach(([, v, dot], k) => {
      if (e.r) { toks.push(`:${v} r${dot}`); return; }
      const fx = [];
      const fx0 = e.fx || {};
      if (k === 0) {
        if (fx0.bd) fx.push(`b (0 ${fx0.bd * 2})`);
        if (fx0.v && pieces.length === 1) fx.push('v');
      }
      if (k === pieces.length - 1) {
        if (fx0.v && pieces.length > 1) fx.push('v');
        if (fx0.h) fx.push('h');
        if (fx0.sl) fx.push('sl');
      }
      const f = fx.length ? `{${fx.join(' ')}}` : '';
      toks.push(`:${v} ${k > 0 ? '-' : e.f}.${nS - e.s}${f}${dot}`);
    });
  }
  return toks.join(' ');
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const texName = (notes) => [...notes].reverse().map((m) => NAMES[mod12(m)] + (Math.floor(m / 12) - 1)).join(' ');

export function leadToTex(lead, tuning) {
  fingerLead(lead, tuning);
  const name = lead.mode === 'melody' ? 'Melody' : 'Lead';
  let tex = `\\track "${name}"\n\\instrument ${lead.program}\n\\tuning (${texName(tuning)})\n`;
  tex += lead.bars.map((b) => leadBarTex(b, tuning.length)).join(' |\n') + '\n';
  return tex;
}

// Рифф + соло/мелодия: новый объект риффа с дорожкой поверх
export function addLead(M, riff, mode, opts = {}, riffToTex) {
  const lead = generateLead(M, riff, mode, opts);
  const out = { ...riff, lead, leadMode: mode, leadSeeds: { r: lead.rseed, p: lead.pseed }, leadGen: opts.gen || 0 };
  out.leadTex = leadToTex(lead, riff.tuning);
  const what = mode === 'melody' ? 'мелодия' : 'соло';
  out.title = `${M.name || 'ИИ'} — ${what} #${String(lead.pseed).slice(-4)}${out.leadGen ? ' · вар. ' + out.leadGen : ''}`;
  out.tex = riffToTex(M, out, out.opts || {});
  return out;
}
