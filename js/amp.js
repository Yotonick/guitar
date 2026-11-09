/* Гитарный усилитель в реальном времени.
   AlphaSynth играет гитары (чистые записи) в ЛЕВЫЙ канал, всё остальное — в ПРАВЫЙ.
   Здесь выход синтезатора перехватывается: левый канал идёт через усилитель и кабинет,
   правый — напрямую, потом всё смешивается. Так искажается сумма струн (как в настоящем усилителе). */

const PRESETS = {
  dist:  { hp: 140, tsGain: 10, g: [6.0, 4.0, 2.0], bias: [0.15, 0.05, 0], lp: 6000, low: 3, mid: -4, pres: 3, cabLP: 5000, out: 0.095 },
  od:    { hp: 120, tsGain: 7,  g: [3.0, 2.0, 1.2], bias: [0.10, 0.00, 0], lp: 6500, low: 2, mid: -1, pres: 2, cabLP: 5200, out: 0.16 },
  clean: { hp: 70,  tsGain: 0,  g: [1.0, 1.0, 1.0], bias: [0, 0, 0],       lp: 9000, low: 1.5, mid: 0, pres: 1.5, cabLP: 7500, out: 0.6 },
};

export const AMP = {
  supported: typeof AudioNode !== 'undefined',
  installed: false,
  active: false,        // направлять ли гитарный канал через усилитель
  preset: 'dist',
  drive: 0.5, low: 0, mid: 0, high: 0,   // ручки: низ/середина/верх в дБ (−6..+6)           // 0..1, множитель усиления (0.5 = как в пресете)
  nodes: null,
};

function curve(k, bias) {
  const n = 4096, c = new Float32Array(n + 1), b0 = Math.tanh(bias);
  for (let i = 0; i <= n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(k * x + bias) - b0; }
  return c;
}
// тихий шум струн гасим мягким расширителем (до усиления)
function gateCurve(th) {
  const n = 4096, c = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) { const x = (i / n) * 2 - 1, a = Math.abs(x); c[i] = x * Math.min(1, a / th); }
  return c;
}

const GATE_SRC = `
class Gate extends AudioWorkletProcessor {
  constructor(){ super(); this.env=0; this.g=0; this.hold=0;
    this.fast=0; this.slow=0; this.wait=0; this.lp=0; this.hg=1; this.hgT=1; this.br=0; this.brT=0; }
  process(inputs, outputs){
    const i=inputs[0][0], o=outputs[0][0]; if(!i||!o) return true;
    // мягкий гейт: открывается от тихого щипка, закрывается только когда звук почти угас,
    // держит 80 мс и гасит хвост плавно — ноты не обрываются «рывками»
    const open=0.0025, close=0.0008, rel=Math.exp(-1/(sampleRate*0.06)), att=Math.exp(-1/(sampleRate*0.001));
    // «живая рука»: на каждом новом щипке чуть меняем громкость (±1 дБ) и яркость атаки,
    // чтобы повторы одной ноты (чаги) не звучали как копия — как у гитариста с медиатором
    const fA=Math.exp(-1/(sampleRate*0.0005)), fR=Math.exp(-1/(sampleRate*0.008)), sC=Math.exp(-1/(sampleRate*0.04));
    const lpC=1-Math.exp(-2*Math.PI*2500/sampleRate), sm=1-Math.exp(-1/(sampleRate*0.002)), gap=Math.floor(sampleRate*0.035);
    let env=this.env, g=this.g, hold=this.hold, fast=this.fast, slow=this.slow, wait=this.wait, lp=this.lp;
    let hg=this.hg, hgT=this.hgT, br=this.br, brT=this.brT;
    for(let k=0;k<i.length;k++){
      const x=i[k], a=Math.abs(x);
      env = a>env ? att*env+(1-att)*a : rel*env+(1-rel)*a;
      if(env>open) hold=Math.floor(sampleRate*0.08);
      else if(hold>0) hold--;
      const target = (env>close||hold>0)?1:0;
      g += (target-g)*(target>g?0.02:0.0004);
      fast = a>fast ? fA*fast+(1-fA)*a : fR*fast+(1-fR)*a;
      slow = sC*slow+(1-sC)*a;
      if(wait>0) wait--;
      else if(fast>0.002 && fast>slow*1.7){ hgT=0.88+Math.random()*0.24; brT=Math.random()*0.4; wait=gap; }
      hg += (hgT-hg)*sm; br += (brT-br)*sm;
      lp += lpC*(x-lp);
      o[k]=(x*(1-br)+lp*br)*hg*g;
    }
    this.env=env; this.g=g; this.hold=hold; this.fast=fast; this.slow=slow; this.wait=wait; this.lp=lp;
    this.hg=hg; this.hgT=hgT; this.br=br; this.brT=brT; return true;
  }
}
registerProcessor('guitar-gate', Gate);`;
const gateReady = new WeakMap();
function loadGate(ctx) {
  if (!gateReady.has(ctx)) {
    const url = URL.createObjectURL(new Blob([GATE_SRC], { type: 'application/javascript' }));
    gateReady.set(ctx, ctx.audioWorklet.addModule(url));
  }
  return gateReady.get(ctx);
}

function biq(ctx, type, f, q = 0.707, g = 0) {
  const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; return b;
}
function ws(ctx, c) { const w = ctx.createWaveShaper(); w.curve = c; w.oversample = '4x'; return w; }
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return [nodes[0], nodes[nodes.length - 1]]; }

function buildGraph(src, dest, ctx, origConnect) {
  const n = {};
  const split = ctx.createChannelSplitter(2);
  n.direct = ctx.createGain();           // обход (усилитель выключен)
  n.wet = ctx.createGain();              // путь через усилитель
  n.mix = ctx.createGain();
  origConnect.call(src, n.direct);
  origConnect.call(n.direct, dest);
  origConnect.call(src, split);
  // правый канал (всё кроме усилителя)
  n.others = ctx.createGain();
  split.connect(n.others, 1);
  // без усилителя: просто складываем каналы в моно
  n.plain = ctx.createGain();
  n.plainIn = ctx.createGain(); n.plainIn.gain.value = 0.7;
  split.connect(n.plainIn, 0); split.connect(n.plainIn, 1);
  n.plainIn.connect(n.plain);
  // левый канал → усилитель
  n.gateIn = ctx.createGain();
  n.gate = ws(ctx, gateCurve(0.015)); n.gate.oversample = 'none';
  n.hp = biq(ctx, 'highpass', 120, 0.707);
  n.ts = biq(ctx, 'peaking', 800, 0.8, 8);
  n.g1 = ctx.createGain(); n.s1 = ws(ctx, curve(1, 0.15)); n.lp1 = biq(ctx, 'lowpass', 6000); n.h1 = biq(ctx, 'highpass', 60);
  n.g2 = ctx.createGain(); n.s2 = ws(ctx, curve(1, 0.05)); n.lp2 = biq(ctx, 'lowpass', 6000); n.h2 = biq(ctx, 'highpass', 60);
  n.g3 = ctx.createGain(); n.s3 = ws(ctx, curve(1, 0)); n.h3 = biq(ctx, 'highpass', 60);
  n.low = biq(ctx, 'lowshelf', 110, 0.7, 3);
  n.mid = biq(ctx, 'peaking', 550, 0.7, -4);
  n.pres = biq(ctx, 'peaking', 2200, 0.9, 3);
  n.cHP = biq(ctx, 'highpass', 85, 0.8);
  n.cRes = biq(ctx, 'peaking', 115, 1.2, 4);
  n.cMid = biq(ctx, 'peaking', 2500, 1.0, 3);
  n.cLP1 = biq(ctx, 'lowpass', 5000); n.cLP2 = biq(ctx, 'lowpass', 5750); n.cLP3 = biq(ctx, 'lowpass', 9000);
  n.out = ctx.createGain();
  n.limit = ctx.createDynamicsCompressor();
  n.limit.threshold.value = -6; n.limit.knee.value = 6; n.limit.ratio.value = 8; n.limit.attack.value = 0.003; n.limit.release.value = 0.12;
  n.gateIn.connect(n.gate); n.gate.connect(n.hp);
  const [head] = chain(n.hp, n.ts, n.g1, n.s1, n.lp1, n.h1, n.g2, n.s2, n.lp2, n.h2, n.g3, n.s3, n.h3,
    n.low, n.mid, n.pres, n.cHP, n.cRes, n.cMid, n.cLP1, n.cLP2, n.cLP3, n.out, n.limit);
  split.connect(n.gateIn, 0);
  loadGate(ctx).then(() => {
    const gw = new AudioWorkletNode(ctx, 'guitar-gate');
    n.gateIn.disconnect(); n.gate.disconnect();
    n.gateIn.connect(gw); gw.connect(n.hp); n.gateW = gw;
  }).catch(() => {});
  n.limit.connect(n.wet);
  n.others.connect(n.wet);
  n.wet.connect(n.mix);
  n.plain.connect(n.mix);
  origConnect.call(n.mix, dest);
  if (AMP.nodes) { for (const k of ['direct', 'limit', 'others', 'wet', 'mix', 'plain', 'plainIn']) { try { AMP.nodes[k].disconnect(); } catch (e) {} } }
  AMP.nodes = n;
  applySettings();
}

export function applySettings() {
  const n = AMP.nodes; if (!n) return;
  const p = PRESETS[AMP.preset] || PRESETS.dist;
  const d = Math.pow(2, (AMP.drive - 0.5) * 3);            // 0..1 → ×0.35 … ×2.8
  const t = n.hp.context.currentTime;
  const set = (param, v) => param.setTargetAtTime(v, t, 0.01);
  set(n.hp.frequency, p.hp);
  set(n.ts.gain, p.tsGain);
  set(n.g1.gain, p.g[0] * d); set(n.g2.gain, p.g[1] * Math.sqrt(d)); set(n.g3.gain, p.g[2]);
  set(n.lp1.frequency, p.lp); set(n.lp2.frequency, p.lp);
  set(n.low.gain, p.low + AMP.low); set(n.mid.gain, p.mid + AMP.mid); set(n.pres.gain, p.pres + AMP.high);
  const bright = Math.pow(2, AMP.high / 12);
  set(n.cLP1.frequency, p.cabLP * bright); set(n.cLP2.frequency, p.cabLP * 1.15 * bright);
  set(n.out.gain, p.out);
  set(n.direct.gain, 0);
  set(n.plain.gain, AMP.active ? 0 : 1);
  set(n.wet.gain, AMP.active ? 1 : 0);
  n.s1.curve = curve(1, p.bias[0]); n.s2.curve = curve(1, p.bias[1]);
}

export function setAmp(opts) { Object.assign(AMP, opts); applySettings(); }
export function loadAmpPrefs() {
  try { const v = JSON.parse(localStorage.getItem('ampPrefs') || 'null'); if (v) Object.assign(AMP, v); } catch (e) {}
}
export function saveAmpPrefs() {
  try { localStorage.setItem('ampPrefs', JSON.stringify({ userPreset: AMP.userPreset || null, drive: AMP.drive, low: AMP.low, mid: AMP.mid, high: AMP.high })); } catch (e) {}
}

export function installAmpHook() {
  if (AMP.installed || !AMP.supported || typeof AudioWorkletNode === 'undefined') return;
  const orig = AudioNode.prototype.connect;
  AMP.installed = true;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (this instanceof AudioWorkletNode && typeof AudioDestinationNode !== 'undefined' && target instanceof AudioDestinationNode) {
      try { buildGraph(this, target, this.context, orig); return target; } catch (e) { console.warn('amp hook failed', e); }
    }
    return orig.call(this, target, ...rest);
  };
}
