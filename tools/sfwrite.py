# Запись SoundFont (SF2 со сжатыми Ogg-сэмплами = SF3), как понимает alphaSynth
import struct, subprocess, tempfile, os
import numpy as np, soundfile as sf

def ogg_bytes(x, sr, q=4):
    """Моно float → Ogg Vorbis (libvorbis, качество q: 3–5 хватает для гитары и барабанов)."""
    with tempfile.TemporaryDirectory() as d:
        w = os.path.join(d, 'a.wav'); o = os.path.join(d, 'a.ogg')
        sf.write(w, np.clip(x, -1, 1).astype(np.float32), sr, subtype='FLOAT')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', w, '-c:a', 'libvorbis', '-q:a', str(q), '-ac', '1', o], check=True)
        return open(o, 'rb').read()

def _chunk(tag, data):
    if len(data) % 2: data += b'\0'
    return tag + struct.pack('<I', len(data)) + data
def _list(tag, data): return _chunk(b'LIST', tag + data)
def _z(s, n): return s.encode('latin-1', 'replace')[:n].ljust(n, b'\0')

# генераторы SF2
KEY, VEL, ATTN, RELEASE, ATTACK, HOLD, DECAY, SUSTAIN, EXCL, PAN, SAMPLEID, SAMPLEMODES, ROOT, COARSE, FINE = 43, 44, 48, 38, 34, 35, 36, 37, 57, 17, 53, 54, 58, 51, 52

def write_sf(path, name, samples, instruments, presets):
    """samples: [{name, ogg, sr, root, corr}]
       instruments: [{name, zones:[{sample, key:(lo,hi), vel:(lo,hi), gens:{op:val}}]}]
       presets: [{name, prog, bank, inst}]"""
    smpl = b''; shdr = b''
    for s in samples:
        st = len(smpl); smpl += s['ogg']; en = len(smpl)
        corr = int(max(-99, min(99, round(s.get('corr', 0)))))
        shdr += _z(s['name'], 20) + struct.pack('<IIIIIBbHH', st, en, 0, 0, s['sr'], int(s['root']), corr, 0, 1 | 0x10)
    shdr += _z('EOS', 20) + struct.pack('<IIIIIBbHH', 0, 0, 0, 0, 0, 0, 0, 0, 0)

    inst = b''; ibag = b''; igen = b''; ibi = 0; igi = 0
    for ins in instruments:
        inst += _z(ins['name'], 20) + struct.pack('<H', ibi)
        for zn in ins['zones']:
            ibag += struct.pack('<HH', igi, 0); ibi += 1
            g = b''
            g += struct.pack('<HBB', KEY, zn['key'][0], zn['key'][1])
            if 'vel' in zn: g += struct.pack('<HBB', VEL, zn['vel'][0], zn['vel'][1])
            for op, val in (zn.get('gens') or {}).items():
                g += struct.pack('<Hh', op, int(val))
            g += struct.pack('<HH', SAMPLEID, zn['sample'])
            igen += g; igi += len(g) // 4
    inst += _z('EOI', 20) + struct.pack('<H', ibi)
    ibag += struct.pack('<HH', igi, 0)
    igen += struct.pack('<HH', 0, 0)

    phdr = b''; pbag = b''; pgen = b''; pbi = 0; pgi = 0
    for p in presets:
        phdr += _z(p['name'], 20) + struct.pack('<HHHIII', p['prog'], p['bank'], pbi, 0, 0, 0)
        pbag += struct.pack('<HH', pgi, 0); pbi += 1
        pgen += struct.pack('<HH', 41, p['inst']); pgi += 1
    phdr += _z('EOP', 20) + struct.pack('<HHHIII', 0, 0, pbi, 0, 0, 0)
    pbag += struct.pack('<HH', pgi, 0)
    pgen += struct.pack('<HH', 0, 0)

    info = _list(b'INFO', _chunk(b'ifil', struct.pack('<HH', 2, 1)) + _chunk(b'isng', _z('EMU8000', 8)) + _chunk(b'INAM', _z(name, 64)))
    sdta = _list(b'sdta', _chunk(b'smpl', smpl))
    pdta = _list(b'pdta', _chunk(b'phdr', phdr) + _chunk(b'pbag', pbag) + _chunk(b'pmod', b'\0' * 10) + _chunk(b'pgen', pgen)
                 + _chunk(b'inst', inst) + _chunk(b'ibag', ibag) + _chunk(b'imod', b'\0' * 10) + _chunk(b'igen', igen) + _chunk(b'shdr', shdr))
    body = b'sfbk' + info + sdta + pdta
    open(path, 'wb').write(b'RIFF' + struct.pack('<I', len(body)) + body)
    return len(body) + 8

def tc(seconds):
    """секунды → timecents"""
    return int(round(1200 * np.log2(max(seconds, 0.001))))
