// Генератор рифов: собирает alphaTex (гитара + простая ударная партия)
import { getTuning, tuningToTex } from './tunings.js';

export const GENRES = {
  numetal: {
    name: 'Nu metal',
    tuning: 'dropc',
    tempo: [82, 108],
    program: 30,
    cells: [
      [2, 2, 2, 2, 2, 2, 2, 2],
      [2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
      [4, 2, 2, 4, 4],
      [1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2],
    ],
    degrees: [0, 0, 0, 0, 1, 3, 5, 6, 10],
    chord: 0.18,
    pm: true,
    drums: 'rock',
    queries: ['Korn Blind', 'Slipknot Wait and Bleed', 'Linkin Park One Step Closer', 'Deftones My Own Summer', 'System of a Down Chop Suey'],
  },
  metalcore: {
    name: 'Metalcore',
    tuning: 'dropc',
    tempo: [118, 150],
    program: 30,
    cells: [
      [2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
      [4, 4, 4, 4],
      [1, 1, 2, 1, 1, 2, 4, 4],
      [2, 2, 4, 2, 2, 4],
    ],
    degrees: [0, 0, 0, 1, 3, 6, 8],
    chord: 0.2,
    pm: true,
    drums: 'double',
    queries: ['Killswitch Engage My Curse', 'Bullet for My Valentine Tears Dont Fall', 'Trivium Strife', 'As I Lay Dying Nothing Left'],
  },
  thrash: {
    name: 'Thrash',
    tuning: 'std',
    tempo: [170, 205],
    program: 30,
    cells: [
      [1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2],
      [2, 2, 2, 2, 2, 2, 2, 2],
      [2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
    ],
    degrees: [0, 0, 0, 1, 3, 0, 5, 6, 7, 8],
    chord: 0.1,
    pm: true,
    drums: 'thrash',
    queries: ['Metallica Master of Puppets', 'Slayer Raining Blood', 'Megadeth Holy Wars', 'Anthrax Caught in a Mosh'],
  },
  djent: {
    name: 'Djent',
    tuning: '7dropa',
    tempo: [108, 140],
    program: 30,
    cells: [
      [1, 1, 2, 1, 1, 2, 4, 4],
      [2, 1, 1, 2, 1, 1, 4, 4],
      [1, 1, 1, 1, 2, 2, 4, 4],
      [1, 1, 2, 2, 2, 1, 1, 2, 2, 2],
    ],
    degrees: [0, 0, 0, 0, 0, 1, 3, 6, 10],
    chord: 0.12,
    pm: true,
    drums: 'double',
    queries: ['Periphery Icarus Lives', 'Meshuggah Bleed', 'Animals as Leaders CAFO', 'Tesseract Concealing Fate'],
  },
  doom: {
    name: 'Doom',
    tuning: 'd',
    tempo: [52, 72],
    program: 30,
    cells: [[16], [8, 8], [8, 4, 4], [4, 4, 8]],
    degrees: [0, 0, 3, 5, 6, 7],
    chord: 0.85,
    pm: false,
    drums: 'slow',
    queries: ['Black Sabbath Black Sabbath', 'Electric Wizard Funeralopolis', 'Sleep Dopesmoker', 'Candlemass Solitude'],
  },
  hardrock: {
    name: 'Hard rock',
    tuning: 'std',
    tempo: [105, 140],
    program: 29,
    cells: [
      [4, 4, 4, 4],
      [2, 2, 4, 2, 2, 4],
      [4, 2, 2, 4, 4],
      [2, 2, 2, 2, 4, 4],
    ],
    degrees: [0, 3, 5, 7, 10, 0],
    chord: 0.7,
    pm: false,
    drums: 'rock',
    queries: ['AC/DC Back in Black', 'Black Sabbath Iron Man', 'Deep Purple Smoke on the Water', 'Led Zeppelin Whole Lotta Love'],
  },
  punk: {
    name: 'Punk',
    tuning: 'std',
    tempo: [150, 185],
    program: 29,
    cells: [[2, 2, 2, 2, 2, 2, 2, 2], [4, 4, 2, 2, 4], [2, 2, 2, 2, 4, 4]],
    degrees: [0, 0, 5, 7, 3, 0],
    chord: 0.9,
    pm: false,
    drums: 'punk',
    queries: ['Ramones Blitzkrieg Bop', 'Green Day Basket Case', 'Sex Pistols Anarchy in the UK', 'The Offspring Self Esteem'],
  },
};

// Детерминированный ГСЧ (чтобы «ещё вариант» = новый seed)
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const LEN_TO_DUR = { 1: 16, 2: 8, 4: 4, 8: 2, 16: 1 };

function makeBar(rng, g, cell, prev) {
  const events = [];
  let last = 0;
  cell.forEach((len, i) => {
    let deg;
    if (i === 0) deg = rng() < 0.92 ? 0 : pick(rng, g.degrees);
    else if (prev && rng() < 0.55) deg = last; // повтор — то самое «чаггинг»
    else deg = pick(rng, g.degrees);
    last = deg;
    const chord = len >= 2 && rng() < g.chord * (len >= 4 ? 1.4 : 0.5);
    events.push({ len, deg, chord, pm: g.pm && !chord && len <= 2 && deg === 0 });
    prev = true;
  });
  return events;
}

function varyBar(rng, g, events, strength) {
  const out = events.map((e) => ({ ...e }));
  const n = Math.max(1, Math.round(strength));
  for (let k = 0; k < n; k++) {
    const i = 1 + Math.floor(rng() * (out.length - 1 || 1));
    if (!out[i]) continue;
    out[i].deg = pick(rng, g.degrees);
    out[i].pm = g.pm && !out[i].chord && out[i].len <= 2 && out[i].deg === 0;
  }
  return out;
}

function barToTex(events, lowStr, fifthStr, fifthOff, state) {
  const parts = [];
  for (const ev of events) {
    const dur = LEN_TO_DUR[ev.len];
    if (state.dur !== dur) {
      parts.push(':' + dur);
      state.dur = dur;
    }
    const pm = ev.pm ? '{pm}' : '';
    const f5 = Math.max(0, ev.deg + fifthOff);
    if (ev.chord) parts.push(`(${ev.deg}.${lowStr}${pm} ${f5}.${fifthStr}${pm})`);
    else parts.push(`${ev.deg}.${lowStr}${pm}`);
  }
  return parts.join(' ');
}

// Ударные в GM-номерах: 36 бочка, 38 малый, 42 хэт, 46 открытый хэт, 49 крэш
function drumBar(kind, first) {
  const K = '36', S = '38', H = '42', C = '49';
  const hat8 = (kick, snare) => kick.map((k, i) => (k ? `(${K} ${H})` : snare[i] ? `(${S} ${H})` : H)).join(' ');
  switch (kind) {
    case 'slow':
      return ':4 ' + (first ? `(${K} ${C})` : K) + ` ${S} ${K} ${S}`;
    case 'thrash':
      return ':8 ' + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i % 4 === 0 ? `(${K} ${H})` : i % 4 === 2 ? `(${S} ${H})` : H)).join(' ');
    case 'punk':
      return ':8 ' + [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (i % 4 === 0 ? `(${K} ${H})` : i % 4 === 2 ? `(${S} ${H})` : H)).join(' ');
    case 'double': {
      // вторая половина такта — бочка шестнадцатыми
      return `:8 ${first ? `(${K} ${C})` : `(${K} ${H})`} ${H} (${S} ${H}) ${H} :16 ${K} ${K} ${K} ${K} (${S} ${H}) ${K} ${K} ${K}`;
    }
    default:
      return ':8 ' + hat8([1, 0, 0, 0, 1, 1, 0, 0], [0, 0, 1, 0, 0, 0, 1, 0]).replace(/^\(36 42\)/, first ? `(${K} ${C})` : `(${K} ${H})`);
  }
}

export function generateRiff({ genre = 'numetal', bars = 4, tempo, tuningId, seed, withDrums = true } = {}) {
  const g = GENRES[genre] || GENRES.numetal;
  seed = seed == null ? Math.floor(Math.random() * 1e9) : seed;
  const rng = mulberry32(seed);
  const tuning = getTuning(tuningId || g.tuning);
  const n = tuning.notes.length;
  const lowStr = n;
  const fifthStr = n - 1;
  const fifthOff = 7 - (tuning.notes[1] - tuning.notes[0]);
  tempo = tempo || Math.round(g.tempo[0] + rng() * (g.tempo[1] - g.tempo[0]));

  const cell = pick(rng, g.cells);
  const A = makeBar(rng, g, cell, false);
  const A2 = varyBar(rng, g, A, 1);
  const B = varyBar(rng, g, A, 3);
  const plan = [];
  for (let i = 0; i < bars; i++) {
    if (i === bars - 1) plan.push(B);
    else plan.push(i % 2 === 0 ? A : A2);
  }

  const state = { dur: null };
  const guitarBars = plan.map((b) => barToTex(b, lowStr, fifthStr, fifthOff, state));
  const title = `${g.name} — рифф #${String(seed).slice(-4)}`;

  let tex = `\\title "${title}"\n\\artist "Riff Lab"\n\\tempo ${tempo}\n`;
  tex += `\\track "Guitar"\n\\instrument ${g.program}\n\\tuning (${tuningToTex(tuning.notes)})\n`;
  tex += guitarBars.join(' |\n') + '\n';
  if (withDrums) {
    tex += `\\track "Drums"\n\\instrument percussion\n\\staff{score}\n`;
    tex += plan.map((_, i) => drumBar(g.drums, i === 0)).join(' |\n') + '\n';
  }
  return { tex, title, seed, tempo, tuning: tuning.name, genre: g.name };
}
