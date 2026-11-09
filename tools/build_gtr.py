# Гитара Fender (FreePats FSBS direct, CC0) → EGuitar_Live.sf3
#  • инструмент 0 «EGuitar DI»: сырой сигнал для живого усилителя (программы 28–31)
#  • инструмент 1 «EGuitar Clean»: тот же Fender, запечённый через чистый усилитель (программы 26–27)
# Два слоя силы удара (≤85 — тихий: призрачные ноты, легато; выше — обычный удар),
# соседние полутона получают разные дубли записи, чтобы ходы не звучали «под копирку».
import sys, re, os
import numpy as np, soundfile as sf
from scipy import signal
sys.path.insert(0, os.path.dirname(__file__))
import amp
from amp import flt, sos
from sfz import parse_sfz
from sfwrite import write_sf, ogg_bytes, tc, RELEASE, ATTN

SRC = sys.argv[1]
OUT = sys.argv[2]
FS = 48000
SR = 32000          # частота в саундфонте: 16 кГц полосы хватает гитаре
SOFT_MAX = 85       # alphaTab: обычная нота = 95, призрачная/легато = 79

def load(path):
    x, sr = sf.read(path, dtype='float64')
    assert sr == FS
    if x.ndim > 1: x = x.mean(axis=1)
    return x

def trim(x, dur):
    pk = np.abs(x).max()
    on = int(np.argmax(np.abs(x) > 0.03 * pk))
    on = max(0, on - int(0.003 * FS))
    y = x[on:on + int(dur * FS)].copy()
    fo = min(len(y) // 3, int(0.45 * FS))
    y[-fo:] *= np.cos(np.linspace(0, np.pi / 2, fo)) ** 2   # мягкое затухание в конце
    return y

def dur_for(root):
    return 6.0 if root < 52 else 4.5 if root < 64 else 3.2

def di_render(x, gain):
    y = flt(x, sos('hp', 55, FS, 0.707)) * gain
    return signal.resample_poly(y, SR, FS)

def clean_render(x, gain, ratio=1.0):
    # чистый усилитель + кабинет из amp.py, лёгкая ламповая теплота и компрессия
    y = amp.amp(x * gain, 'clean')
    y = y / (np.sqrt(np.mean(y[:int(0.8 * FS)] ** 2)) + 1e-9) * 0.24 * ratio   # громкость как у остальных инструментов
    y = np.tanh(y * 1.3) / 1.3                                                 # мягкая компрессия: пики не клиппируют
    y = flt(y, sos('peak', 2800, FS, 0.9, 1.5), sos('lshelf', 160, FS, 0.7, 1.0))
    fo = int(0.3 * FS); y[-fo:] *= np.linspace(1, 0, fo)
    return signal.resample_poly(y, SR, FS)

glob, groups = parse_sfz(os.path.join(SRC, 'EGuitarFSBS-direct bridge 20220911.sfz'))
zones = []   # (lo, hi, root, layer, [files])
for g in groups:
    o = g['opts']
    files = [r['sample'] for r in g['regions']]
    if 'lokey' in o:
        lo, hi, root = int(o['lokey']), int(o['hikey']), int(o['pitch_keycenter'])
    else:  # группа C5 задана одной клавишей
        m = re.search(r'([A-G]#?)(\d)_', files[0]); n = amp.NOTE[m.group(1)] + 12 * (int(m.group(2)) + 1)
        lo = hi = root = n
    layer = 'soft' if o.get('hivel') else 'normal'
    zones.append((lo, hi, root, layer, files))
# у C5 одна клавиша — расширяем, чтобы не было дыр между B4 (до 71) и D5 (с 73)
zones = [(lo, hi, root, layer, files) for lo, hi, root, layer, files in zones]

samples = []; di_zones = []; cl_zones = []
cache = {}
def add_sample(fname, root, kind):
    key = (fname, kind)
    if key in cache: return cache[key]
    path = os.path.join(SRC, fname.replace('/', os.sep))
    x = trim(load(path), dur_for(root))
    # громкость: обычный слой по RMS первой секунды → 0.10 (как калибровали усилитель);
    # тихий слой — тем же множителем, что его обычная пара, чтобы сохранить живую разницу
    base = fname.replace('_soft', '')
    xb = trim(load(os.path.join(SRC, base.replace('/', os.sep))), dur_for(root)) if '_soft' in fname else x
    gain = 0.10 / (np.sqrt(np.mean(xb[:FS] ** 2)) + 1e-9)
    ratio = (np.sqrt(np.mean(x[:FS] ** 2)) / (np.sqrt(np.mean(xb[:FS] ** 2)) + 1e-9)) if '_soft' in fname else 1.0
    y = di_render(x, gain) if kind == 'di' else clean_render(x, gain, min(1.0, ratio))
    cents = amp.f0_cents(x, root)
    idx = len(samples)
    samples.append({'name': f"{kind}{os.path.basename(fname)[:-5]}"[:20], 'ogg': ogg_bytes(y, SR, q=4), 'sr': SR, 'root': root, 'corr': -cents})
    cache[key] = idx
    print(kind, os.path.basename(fname), f'{len(samples[-1]["ogg"])//1024} KB', f'{cents:+.1f}c', flush=True)
    return idx

has_soft = {(lo, hi) for lo, hi, root, layer, f in zones if layer == 'soft'}
for lo, hi, root, layer, files in zones:
    for k in range(lo, hi + 1):
        if layer == 'normal':
            f = files[(k - lo) % len(files)]          # соседние полутона — разные дубли
            vel = (SOFT_MAX + 1, 127) if (lo, hi) in has_soft else (0, 127)
        else:
            f = files[0]; vel = (0, SOFT_MAX)
        for kind, lst, rel in (('di', di_zones, 0.25), ('clean', cl_zones, 0.45)):
            s = add_sample(f, root, kind)
            lst.append({'sample': s, 'key': (k, k), 'vel': vel, 'gens': {RELEASE: tc(rel)}})

# края диапазона: ниже C2 (7 струн, drop A/B) и выше C#6 — растягиваем крайние зоны
def extend(lst):
    lo = min(z['key'][0] for z in lst); hi = max(z['key'][1] for z in lst)
    out = []
    for z in lst:
        a, b = z['key']
        if a == lo: a = 21
        if b == hi: b = 108
        out.append({**z, 'key': (a, b)})
    return out
di_zones = extend(di_zones); cl_zones = extend(cl_zones)

instruments = [{'name': 'EGuitar DI', 'zones': di_zones}, {'name': 'EGuitar Clean', 'zones': cl_zones}]
presets = [{'name': 'EGuitar DI', 'prog': p, 'bank': 0, 'inst': 0} for p in (28, 29, 30, 31)] + \
          [{'name': 'EGuitar Clean', 'prog': p, 'bank': 0, 'inst': 1} for p in (26, 27)]
size = write_sf(OUT, 'Electric Guitar FSBS (FreePats, CC0)', samples, instruments, presets)
print('wrote', OUT, f'{size/1e6:.2f} MB', len(samples), 'samples')
