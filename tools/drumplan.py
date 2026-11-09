# План барабанов: какой звук MuldjordKit на какую GM-ноту и какие записи под какую силу удара
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from sfz import parse_sfz

# GM-нота → (папка-звук, длительность хвоста, набор полос силы удара)
FIVE = [((0, 70), 35), ((71, 87), 50), ((88, 103), 98), ((104, 119), 113), ((120, 127), 125)]
THREE = [((0, 87), 55), ((88, 110), 98), ((111, 127), 120)]
MAP = {
    36: ('KdrumR', 0.9, FIVE), 35: ('KdrumL', 0.9, FIVE),
    38: ('Snare1', 1.3, FIVE), 40: ('Snare2', 1.3, FIVE),
    42: ('HihatClosed', 0.7, FIVE), 44: ('HihatClosed', 0.5, [((0, 127), 40)]), 46: ('HihatOpen', 1.6, THREE),
    49: ('CrashL', 3.5, THREE), 57: ('CrashR', 3.5, THREE), 52: ('China', 3.0, THREE),
    51: ('RideR', 2.6, THREE), 59: ('RideL', 2.6, THREE), 53: ('RideRBell', 2.6, THREE),
    50: ('Tom1', 1.8, THREE), 48: ('Tom2', 1.8, THREE), 47: ('Tom2', 1.8, THREE),
    45: ('Tom3', 2.0, THREE), 43: ('Tom4', 2.2, THREE), 41: ('Tom4', 2.2, THREE),
}

def plan(sfz_path):
    _, groups = parse_sfz(sfz_path)
    by_dir = {}
    for g in groups:
        o = g['opts']
        d = g['regions'][0]['sample'].split('/')[1]
        by_dir.setdefault(d, []).append((int(o.get('lovel', 0)), int(o.get('hivel', 127)), [r['sample'] for r in g['regions']]))
    out = []
    for note, (d, dur, bands) in MAP.items():
        for (vlo, vhi), src in bands:
            cand = [g for g in by_dir[d] if g[0] <= src <= g[1]] or by_dir[d]
            files = cand[0][2]
            # для левой/правой бочки и пар томов берём разные дубли, чтобы дробь не звучала одинаково
            pick = files[(note + vlo) % len(files)]
            out.append({'note': note, 'dir': d, 'vel': [vlo, vhi], 'src': src, 'file': pick, 'dur': dur})
    return out

if __name__ == '__main__':
    p = plan(sys.argv[1])
    files = sorted({x['file'] for x in p})
    print(len(p), 'zones,', len(files), 'files')
    json.dump(p, open(sys.argv[2], 'w'), indent=0)
    base = 'D:\\CLAUDE\\guitar\\MuldjordKit SFZ+FLAC-20201018\\'
    json.dump([base + f.replace('/', '\\') for f in files], open(sys.argv[3], 'w'))
