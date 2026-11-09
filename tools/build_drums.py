# Живые барабаны MuldjordKit (FreePats) → Drums_Live.sf3, раскладка General MIDI, банк 128
import sys, os, json
import numpy as np, soundfile as sf
from scipy import signal
sys.path.insert(0, os.path.dirname(__file__))
from drumplan import plan
from sfwrite import write_sf, ogg_bytes, tc, RELEASE, EXCL

SRC = sys.argv[1]; OUT = sys.argv[2]
P = plan(os.path.join(SRC, 'MuldjordKit 20201018.sfz'))

PEAK = {  # громкость основного слоя (удар «f») по типам — баланс установки
    'KdrumR': 0.95, 'KdrumL': 0.95, 'Snare1': 0.9, 'Snare2': 0.9,
    'HihatClosed': 0.42, 'HihatOpen': 0.5, 'CrashL': 0.55, 'CrashR': 0.55, 'China': 0.55,
    'RideR': 0.4, 'RideL': 0.4, 'RideRBell': 0.45, 'Tom1': 0.8, 'Tom2': 0.8, 'Tom3': 0.85, 'Tom4': 0.9,
}
HIFI = {'HihatClosed', 'HihatOpen', 'CrashL', 'CrashR', 'China', 'RideR', 'RideL', 'RideRBell'}

def load(f, dur):
    x, sr = sf.read(os.path.join(SRC, f.replace('/', os.sep)), dtype='float64')
    if x.ndim > 1: x = x.mean(axis=1)
    pk = np.abs(x).max()
    on = max(0, int(np.argmax(np.abs(x) > 0.02 * pk)) - int(0.0015 * sr))
    y = x[on:on + int(dur * sr)].copy()
    fo = int(len(y) * 0.35)
    y[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
    return y, sr

# множитель громкости на звук считаем по основному слою (ближайший к удару 95)
gains = {}
for z in P:
    if z['vel'][0] <= 95 <= z['vel'][1] and z['dir'] not in gains:
        y, _ = load(z['file'], z['dur'])
        gains[z['dir']] = PEAK[z['dir']] / (np.abs(y).max() + 1e-9)

samples = []; zones = []; cache = {}
for z in P:
    key = (z['file'], z['dur'])
    if key not in cache:
        y, sr = load(z['file'], z['dur'])
        y = y * gains[z['dir']]
        out_sr = 44100 if z['dir'] in HIFI else 32000
        if out_sr != sr: y = signal.resample_poly(y, out_sr, sr)
        cache[key] = len(samples)
        samples.append({'name': os.path.basename(z['file'])[:-5][:20], 'ogg': ogg_bytes(y, out_sr, q=4 if z['dir'] in HIFI else 3), 'sr': out_sr, 'root': 60, 'corr': 0})
        print(z['dir'], os.path.basename(z['file']), f"{len(samples[-1]['ogg'])//1024} KB", flush=True)
    gens = {RELEASE: tc(z['dur'])}         # отпускание ноты не обрывает звук — звучит весь хвост
    if z['note'] in (42, 44, 46): gens[EXCL] = 1   # хэты глушат друг друга
    # корень 60 + overridingRootKey не нужен: ставим keyRange = нота и тянем высоту так, чтобы не транспонировалось
    zones.append({'sample': cache[key], 'key': (z['note'], z['note']), 'vel': tuple(z['vel']), 'gens': {**gens, 58: z['note']}})

instruments = [{'name': 'MuldjordKit', 'zones': zones}]
presets = [{'name': 'MuldjordKit', 'prog': p, 'bank': 128, 'inst': 0} for p in (0, 1, 8, 16, 24, 25, 32, 40, 48)]
size = write_sf(OUT, 'MuldjordKit by Lars Muldjord (FreePats, CC-BY 4.0)', samples, instruments, presets)
print('wrote', OUT, f'{size/1e6:.2f} MB', len(samples), 'samples', len(zones), 'zones')
