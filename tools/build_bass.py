# Бас Yamaha RBX медиатором (FreePats PickedBassYR, CC0) → Bass_Live.sf3, программы 33 и 34
import sys, os, re
import numpy as np, soundfile as sf
from scipy import signal
sys.path.insert(0, os.path.dirname(__file__))
import amp
from sfz import parse_sfz
from sfwrite import write_sf, ogg_bytes, tc, RELEASE

SRC = sys.argv[1]; OUT = sys.argv[2]
SR = 32000
_, groups = parse_sfz(os.path.join(SRC, 'PickedBassYR 20190930.sfz'))
regions = [r for g in groups for r in g['regions']]

def f0_cents(x, sr, midi):
    seg = x[int(.12 * sr):int(.12 * sr) + 16384]; seg = seg - seg.mean(); n = len(seg)
    ac = np.fft.irfft(np.abs(np.fft.rfft(seg, 2 * n)) ** 2)[:n]
    fe = 440 * 2 ** ((midi - 69) / 12); lo = int(sr / (fe * 1.06)); hi = int(sr / (fe / 1.06))
    k = lo + np.argmax(ac[lo:hi])
    if 1 < k < n - 1:
        a, b, c = ac[k - 1], ac[k], ac[k + 1]; k = k + 0.5 * (a - c) / (a - 2 * b + c)
    return 1200 * np.log2((sr / k) / fe)

samples = []; zones = []
regs = []
for r in regions:
    if 'key' in r: lo = hi = root = int(r['key'])
    else: lo, hi, root = int(r['lokey']), int(r['hikey']), int(r['pitch_keycenter'])
    regs.append([lo, hi, root, r['sample']])
regs.sort()
regs[0][0] = 21    # ниже E1 — 5 струн и опущенные строи (B0, A0)
regs[-1][1] = 72   # выше — растягиваем верхнюю запись
for lo, hi, root, f in regs:
    x, sr = sf.read(os.path.join(SRC, f.replace('/', os.sep)), dtype='float64')
    if x.ndim > 1: x = x.mean(axis=1)
    pk = np.abs(x).max(); on = max(0, int(np.argmax(np.abs(x) > 0.03 * pk)) - int(0.002 * sr))
    y = x[on:on + int(4.0 * sr)].copy()
    fo = int(0.5 * sr); y[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    y = y / (np.sqrt(np.mean(y[:int(0.6 * sr)] ** 2)) + 1e-9) * 0.16
    y = np.tanh(y * 1.4) / 1.4
    cents = f0_cents(x[on:], sr, root)
    y = signal.resample_poly(y, SR, sr)
    samples.append({'name': 'bass' + os.path.basename(f)[:-5], 'ogg': ogg_bytes(y, SR, q=3), 'sr': SR, 'root': root, 'corr': -cents})
    zones.append({'sample': len(samples) - 1, 'key': (lo, hi), 'vel': (0, 127), 'gens': {RELEASE: tc(0.3)}})
    print(os.path.basename(f), lo, hi, root, f'{cents:+.1f}c', f"{len(samples[-1]['ogg'])//1024} KB", flush=True)

instruments = [{'name': 'Picked Bass YR', 'zones': zones}]
presets = [{'name': 'Picked Bass YR', 'prog': p, 'bank': 0, 'inst': 0} for p in (33, 34)]
size = write_sf(OUT, 'Picked Bass YR (FreePats, CC0)', samples, instruments, presets)
print('wrote', OUT, f'{size/1e6:.2f} MB')
