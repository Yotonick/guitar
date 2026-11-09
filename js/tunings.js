// Строи: ноты в MIDI, от самой низкой струны к самой высокой
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12];
export const noteOctave = (m) => Math.floor(m / 12) - 1;
export const midiToLabel = (m) => noteName(m) + noteOctave(m);
export const midiToFreq = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f, a4 = 440) => 69 + 12 * Math.log2(f / a4);

const shift = (arr, n) => arr.map((x) => x + n);
const STD = [40, 45, 50, 55, 59, 64];

export const TUNINGS = [
  { id: 'std', name: 'Стандарт (E)', notes: STD },
  { id: 'eb', name: 'Полтона вниз (Eb)', notes: shift(STD, -1) },
  { id: 'd', name: 'Тон вниз (D)', notes: shift(STD, -2) },
  { id: 'csharp', name: 'C# стандарт', notes: shift(STD, -3) },
  { id: 'c', name: 'C стандарт', notes: shift(STD, -4) },
  { id: 'dropd', name: 'Drop D', notes: [38, 45, 50, 55, 59, 64] },
  { id: 'dropcsharp', name: 'Drop C#', notes: [37, 44, 49, 54, 58, 63] },
  { id: 'dropc', name: 'Drop C', notes: [36, 43, 48, 53, 57, 62] },
  { id: 'dropb', name: 'Drop B', notes: [35, 42, 47, 52, 56, 61] },
  { id: 'dadgad', name: 'DADGAD', notes: [38, 45, 50, 55, 57, 62] },
  { id: 'opend', name: 'Open D', notes: [38, 45, 50, 54, 57, 62] },
  { id: 'openg', name: 'Open G', notes: [38, 43, 50, 55, 59, 62] },
  { id: '7std', name: '7 струн (B)', notes: [35, 40, 45, 50, 55, 59, 64] },
  { id: '7dropa', name: '7 струн Drop A', notes: [33, 40, 45, 50, 55, 59, 64] },
];

export const getTuning = (id) => TUNINGS.find((t) => t.id === id) || TUNINGS[0];

// Строй из GP-файла: определить название, если совпадает с пресетом
export function matchTuning(notes) {
  const t = TUNINGS.find((x) => x.notes.length === notes.length && x.notes.every((n, i) => n === notes[i]));
  return t ? t.name : null;
}

// Строка для alphaTex: от самой высокой к самой низкой
export const tuningToTex = (notes) =>
  [...notes]
    .reverse()
    .map((m) => noteName(m) + noteOctave(m))
    .join(' ');
