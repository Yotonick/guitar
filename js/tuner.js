// Тюнер: микрофон -> алгоритм YIN -> частота
export class PitchDetector {
  constructor({ onPitch, onSilence }) {
    this.onPitch = onPitch;
    this.onSilence = onSilence;
    this.running = false;
    this.ctx = null;
    this.stream = null;
    this.timer = null;
  }

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('no-mic-api');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.diff = new Float32Array(2048);
    this.running = true;
    this.timer = setInterval(() => this.tick(), 60);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = this.stream = null;
  }

  tick() {
    if (!this.running) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    const x = this.buf;
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / x.length);
    if (rms < 0.006) {
      this.onSilence && this.onSilence(rms);
      return;
    }
    const res = yin(x, this.ctx.sampleRate, this.diff);
    if (res) this.onPitch(res.freq, res.clarity, rms);
    else this.onSilence && this.onSilence(rms);
  }
}

// YIN (de Cheveigné & Kawahara), частоты 50..1200 Гц
export function yin(x, sampleRate, diff) {
  const W = 2048;
  const tauMax = Math.min(W - 1, Math.floor(sampleRate / 50));
  const tauMin = Math.max(2, Math.floor(sampleRate / 1200));
  const d = diff || new Float32Array(W);
  // функция разности
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) {
      const v = x[j] - x[j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  // нормированная кумулятивная
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running === 0 ? 1 : (d[tau] * tau) / running;
  }
  const TH = 0.14;
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < TH) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // параболическая интерполяция
  const a = d[tau - 1];
  const b = d[tau];
  const c = d[Math.min(tau + 1, tauMax)];
  const denom = 2 * (2 * b - c - a);
  const shift = denom !== 0 ? (c - a) / denom : 0;
  const better = tau + shift;
  return { freq: sampleRate / better, clarity: 1 - d[tau] };
}

export const centsOff = (freq, targetFreq) => 1200 * Math.log2(freq / targetFreq);
