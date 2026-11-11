// Конвертер: JSON нот Songsterr -> alphaTex (для плеера alphaTab)
import { noteName, noteOctave } from './tunings.js';

const q = (s) => String(s ?? '').replace(/["\\\u0000-\u001f\u007f]/g, ' ').trim();
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;

// Ударные: у Songsterr (как в Guitar Pro 7) часть звуков записана расширенными номерами 82–127
// (91 = малый римшот, 92 = полуоткрытый хэт, 93 = край райда…). Переводим в обычные MIDI-номера,
// иначе эти удары пропадают. Таблица — из alphaTab (Guitar Pro 7 articulations).
const GP_DRUM = {
  82: 70, 83: 53, 84: 53, 86: 41, 87: 41,
  91: 38, 92: 46, 93: 51, 94: 51, 95: 55, 96: 52, 97: 49, 98: 57,
  99: 56, 100: 56, 101: 56, 102: 56, 103: 56, 104: 60, 105: 60, 106: 61, 107: 61,
  108: 64, 109: 64, 110: 63, 111: 54, 112: 54, 113: 54, 114: 43, 115: 49, 116: 49,
  117: 69, 118: 70, 119: 70, 120: 70, 122: 70, 123: 53, 124: 62, 125: 62, 126: 59, 127: 59,
};
export function gmDrum(n) {
  n = Number(n);
  if (GP_DRUM[n]) return GP_DRUM[n];
  return n >= 35 && n <= 81 ? n : 0;
}

// Подбор GM-программы по названию инструмента
function program(instrument, kind) {
  const s = String(instrument || '').toLowerCase();
  if (kind === 'bass') {
    if (/fretless/.test(s)) return 35;
    if (/slap|pop/.test(s)) return 36;
    if (/pick/.test(s)) return 34;
    if (/synth/.test(s)) return 38;
    return 33;
  }
  if (/distort/.test(s)) return 30;
  if (/overdr/.test(s)) return 29;
  if (/muted/.test(s)) return 28;
  if (/clean|jazz/.test(s)) return 27;
  if (/nylon|classical/.test(s)) return 24;
  if (/steel|acoustic/.test(s)) return 25;
  return 29;
}

// Дробь длительности (доля целой ноты) -> значение ноты и эффекты
export function parseDuration(dur) {
  let [n, d] = Array.isArray(dur) && dur.length === 2 ? dur : [1, 4];
  n = Number(n) || 1;
  d = Number(d) || 4;
  const g = gcd(n, d);
  n /= g;
  d /= g;
  if (n === 1 && isPow2(d)) return { value: Math.min(d, 64), fx: '' };
  if (n === 3 && isPow2(d) && d >= 2) return { value: Math.min(d / 2, 64), fx: '{d}' };
  if (n === 7 && isPow2(d) && d >= 4) return { value: Math.min(d / 4, 64), fx: '{dd}' };
  if (n === 1) {
    // триоль/квинтоль: d = m * 2^k
    for (const [m, ratio] of [[3, '3'], [5, '5 4'], [7, '7 4'], [9, '9 8']]) {
      if (d % m === 0 && isPow2(d / m)) {
        const lower = m === 3 ? 2 : m === 9 ? 8 : 4;
        return { value: Math.min(lower * (d / m), 64), fx: `{tu ${ratio}}` };
      }
    }
  }
  // запасной вариант: ближайшая простая длительность
  const v = Math.min(64, Math.max(1, 2 ** Math.round(Math.log2(d / n))));
  return { value: v, fx: '' };
}

// Пауза на весь такт по размеру
function wholeRest(sig) {
  const [n, d] = sig;
  return `:${d} ` + Array(Math.max(1, n)).fill('r').join(' ');
}

function noteFx(note, beat) {
  const fx = [];
  if (beat.palmMute || note.palmMute) fx.push('pm');
  if (beat.letRing || note.letRing) fx.push('lr');
  if (note.ghost) fx.push('g');
  if (note.hp) fx.push('h');
  if (note.slide) fx.push('sl');
  if (note.leftHandVibrato || note.vibrato) fx.push('v');
  if (note.accentuated) fx.push(note.accentuated === 2 ? 'hac' : 'ac'); // акцент → громкий слой сэмплов
  return fx.length ? `{${fx.join(' ')}}` : '';
}

function beatToTex(beat, kind, numStrings) {
  if (beat.graceNote) return null; // не занимает времени
  const { value, fx } = parseDuration(beat.duration);
  const notes = (beat.notes || []).filter((n) => n && n.fret != null);
  const isRest = beat.rest || notes.length === 0;
  const head = `:${value} `;
  if (isRest) return head + 'r' + (fx ? ' ' + fx : '');

  const toks = [];
  const used = new Set();
  for (const n of notes) {
    if (kind === 'drums') {
      const m = gmDrum(n.fret);
      if (m && !used.has(m)) {
        used.add(m);
        const dfx = [n.ghost ? 'g' : '', n.accentuated ? (n.accentuated === 2 ? 'hac' : 'ac') : ''].filter(Boolean);
        toks.push(String(m) + (dfx.length ? `{${dfx.join(' ')}}` : ''));
      }
    } else {
      const str = Number(n.string) + 1; // у Songsterr 0 = высшая струна, в alphaTex 1 = высшая
      if (!(str >= 1 && str <= numStrings) || used.has(str)) continue;
      used.add(str);
      const fret = n.dead ? 'x' : n.tie ? '-' : Number(n.fret);
      toks.push(`${fret}.${str}${noteFx(n, beat)}`);
    }
  }
  if (!toks.length) return head + 'r' + (fx ? ' ' + fx : '');
  const body = toks.length > 1 ? `(${toks.join(' ')})` : toks[0];
  return head + body + (fx ? ' ' + fx : '');
}

function tempoMap(data) {
  const arr = (data.automations && data.automations.tempo) || [];
  const m = new Map();
  for (const t of arr) {
    const bpm = Math.round(Number(t && t.bpm));
    if (bpm > 0 && bpm < 1000) m.set(Number(t.measure) || 0, bpm);
  }
  return m;
}

function partToTex(part, isMaster, tempos) {
  const d = part.data;
  const kind = part.kind;
  const tuning = Array.isArray(d.tuning) ? d.tuning : [];
  const numStrings = kind === 'drums' ? 0 : tuning.length || d.strings || 6;
  const name = q(part.name || part.instrument || (kind === 'drums' ? 'Drums' : 'Guitar'));
  let out = `\\track "${name}"\n`;
  if (kind === 'drums') out += `\\instrument percussion\n\\staff{score}\n`;
  else {
    out += `\\instrument ${program(part.instrument, kind)}\n`;
    const names = tuning.map((m) => noteName(m) + noteOctave(m));
    if (names.length) out += `\\tuning (${names.join(' ')})\n`;
    if (d.capo > 0) out += `\\capo ${d.capo}\n`;
  }

  const measures = d.measures || [];
  let sig = [4, 4];
  const bars0 = [];
  const bars1 = [];
  let hasVoice2 = false;
  measures.forEach((m, i) => {
    if (Array.isArray(m.signature) && m.signature.length === 2) sig = [m.signature[0], m.signature[1]];
    const meta = [];
    if (isMaster) {
      if (Array.isArray(m.signature)) meta.push(`\\ts ${sig[0]} ${sig[1]}`);
      if (m.repeatStart) meta.push('\\ro');
      if (m.marker && m.marker.text) meta.push(`\\section "${q(m.marker.text)}"`);
    }
    const voices = m.voices || [];
    const mk = (v) => {
      const beats = ((v && v.beats) || []).map((b) => beatToTex(b, kind, numStrings)).filter(Boolean);
      return beats;
    };
    let b0 = mk(voices[0]);
    if (!b0.length) b0 = [wholeRest(sig)];
    if (isMaster && tempos.has(i) && i > 0) b0[0] += ` {tempo ${tempos.get(i)}}`;
    let tail = '';
    if (isMaster && m.repeat) tail = ` \\rc ${Number(m.repeat) >= 2 ? Number(m.repeat) : 2}`;
    bars0.push((meta.length ? meta.join(' ') + ' ' : '') + b0.join(' ') + tail);

    const v2 = voices[1];
    const b1 = mk(v2);
    if (b1.some((t) => !/ r(\s|$)/.test(t))) hasVoice2 = true;
    bars1.push(b1.length ? b1.join(' ') : wholeRest(sig));
  });
  out += bars0.join(' |\n') + '\n';
  if (hasVoice2) out += '\\voice\n' + bars1.join(' |\n') + '\n';
  return out;
}

// bundle: { title, artist, parts: [{kind, name, instrument, data}] }
export function bundleToTex(bundle) {
  const parts = (bundle.parts || []).filter((p) => p && p.data && Array.isArray(p.data.measures) && ['guitar', 'bass', 'drums'].includes(p.kind));
  if (!parts.length) throw new Error('В песне нет гитарных дорожек');
  // гитары первыми, ударные последними
  const order = { guitar: 0, bass: 1, drums: 2 };
  parts.sort((a, b) => order[a.kind] - order[b.kind]);
  const first = parts[0].data;
  const tempos = tempoMap(first);
  const bpm = tempos.get(0) || [...tempos.values()][0] || 120;
  let tex = `\\title "${q(bundle.title)}"\n\\artist "${q(bundle.artist)}"\n\\tempo ${bpm}\n`;
  let ok = 0;
  parts.forEach((p, i) => {
    try {
      tex += partToTex(p, i === 0, tempos);
      ok++;
    } catch (e) {
      /* пропускаем дорожку, которую не удалось разобрать */
    }
  });
  if (!ok) throw new Error('Не получилось разобрать ноты');
  return tex;
}
