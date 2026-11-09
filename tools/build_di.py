import numpy as np, soundfile as sf, io, struct, sys
from scipy import signal
import amp
from amp import FS, flt, sos
OUT='/home/claude/build/guitar_di.sf3'
SR=32000; DUR=6.0

def encode_ogg(x):
    b=io.BytesIO()
    f=sf.SoundFile(b,'w',samplerate=SR,channels=1,format='OGG',subtype='VORBIS')
    f.write(x.astype(np.float32)); f.close()
    return b.getvalue()

def render(x,kind,dur):
    if kind=='di':
        on=np.argmax(np.abs(x)>0.03*np.abs(x).max()); on=max(0,on-int(0.003*FS))
        y=x[on:on+int(dur*FS)].astype(np.float64)
        y=flt(y,sos('hp',55,FS,0.707))
        fo=int(0.4*FS); y[-fo:]*=np.linspace(1,0,fo)
        rms=np.sqrt(np.mean(y[:int(1.0*FS)]**2))+1e-9
        y=y*0.10/rms
        return signal.resample_poly(y,SR,FS)
    on=np.argmax(np.abs(x)>0.03*np.abs(x).max()); on=max(0,on-int(0.003*FS))
    x=x[on:on+int((dur+1)*FS)]
    if kind=='muted':
        y=amp.amp(x,'dist')
        n=int(0.55*FS); y=y[:n]
        t=np.arange(n)/FS
        y=y*np.exp(-t/0.11)
        y=flt(y,sos('lp',2600,FS,0.8),sos('peak',300,FS,1.0,3))
    else:
        y=amp.amp(x,kind)
        y=y[:int(dur*FS)]
    n=len(y); fo=int(0.35*FS) if kind!='muted' else int(0.05*FS)
    y[-fo:]*=np.linspace(1,0,fo)
    # normalise: loudness over first 1s
    seg=y[:int(1.0*FS)] if kind!='muted' else y[:int(0.3*FS)]
    rms=np.sqrt(np.mean(seg**2))+1e-9
    target={'clean':0.12,'od':0.13,'dist':0.13,'muted':0.14}[kind]
    y=y*target/rms
    y=np.tanh(y*1.1)/1.1*1.0  # safety limiter
    y=signal.resample_poly(y,SR,FS)
    return y

def chunk(tag,data):
    if len(data)%2: data+=b'\0'
    return tag+struct.pack('<I',len(data))+data
def lst(tag,data): return chunk(b'LIST',tag+data)
def z(s,n): return s.encode()[:n].ljust(n,b'\0')

S=amp.load_samples(); notes=sorted(S)
tunings={}
for m in notes:
    x,sr=sf.read(S[m]); tunings[m]=amp.f0_cents(x,m)
print('cents',{m:round(c,1) for m,c in tunings.items()})
zones=[]
for i,m in enumerate(notes):
    lo=0 if i==0 else (notes[i-1]+m)//2+1
    hi=127 if i==len(notes)-1 else (m+notes[i+1])//2
    zones.append((m,lo,hi))

smpl=b''; shdr=[]; kinds=['di']
inst_defs={k:[] for k in kinds}   # kind -> list of (sampleIdx, lo, hi, root, cents)
for k in kinds:
    for (m,lo,hi) in zones:
        x,sr=sf.read(S[m]); assert sr==FS
        y=render(x,k,8.0)
        ogg=encode_ogg(y)
        st=len(smpl); smpl+=ogg; en=len(smpl)
        shdr.append((f'{k}{m}',st,en,0,0,SR,m,0))
        inst_defs[k].append((len(shdr)-1,lo,hi,m,int(round(-tunings[m]))))
        print(k,m,len(ogg)//1024,'KB',flush=True)
# ---- pdta
def gen(op,val,signed=False):
    return struct.pack('<Hh' if signed or val<0 else '<HH',op,val)
phdr=b'';pbag=b'';pgen=b'';pmod=b'';inst=b'';ibag=b'';igen=b'';imod=b''
ibi=0;igi=0
instnames={'di':'EGuitar DI'}
attn={'di':0}  # cB
rel={'di':-3300}   # timecents release
for ii,k in enumerate(kinds):
    inst+=z(instnames[k],20)+struct.pack('<H',ibi)
    for (sidx,lo,hi,root,cents) in inst_defs[k]:
        ibag+=struct.pack('<HH',igi,0); ibi+=1
        g=b''
        g+=struct.pack('<HBB',43,lo,hi)
        g+=struct.pack('<Hh',38,rel[k])            # releaseVolEnv
        g+=struct.pack('<Hh',48,attn[k])
        g+=struct.pack('<Hh',52,0)
        g+=struct.pack('<Hh',51,0)
        g+=struct.pack('<Hh',58,root) if False else b''
        g+=struct.pack('<HH',58,root)             # overridingRootKey
        g+=struct.pack('<HH',53,sidx)             # sampleID (last)
        igen+=g; igi+=len(g)//4
    # terminal handled below
inst+=z('EOI',20)+struct.pack('<H',ibi)
ibag+=struct.pack('<HH',igi,0)
igen+=struct.pack('<HH',0,0)
imod=struct.pack('<HHhHH',0,0,0,0,0)*1+b'\0'*0
imod=b'\0'*10
# fine-tune per sample: use pitch correction in shdr instead
shdr_b=b''
inv={}
for k in kinds:
    for (sidx,lo,hi,root,cents) in inst_defs[k]: inv[sidx]=cents
for i,(nm,st,en,ls,le,sr,pit,pc) in enumerate(shdr):
    shdr_b+=z(nm,20)+struct.pack('<IIIIIBbHH',st,en,ls,le,sr,pit,max(-99,min(99,inv[i])),0,1|0x10)
shdr_b+=z('EOS',20)+struct.pack('<IIIIIBbHH',0,0,0,0,0,0,0,0,0)
# presets: program -> instrument (bank 0)
pmap=[(28,'di'),(29,'di'),(30,'di'),(31,'di')]
pbi=0;pgi=0
for (prog,k) in pmap:
    phdr+=z(instnames[k],20)+struct.pack('<HHHIII',prog,0,pbi,0,0,0)
    pbag+=struct.pack('<HH',pgi,0); pbi+=1
    pgen+=struct.pack('<HH',41,kinds.index(k)); pgi+=1
phdr+=z('EOP',20)+struct.pack('<HHHIII',0,0,pbi,0,0,0)
pbag+=struct.pack('<HH',pgi,0)
pgen+=struct.pack('<HH',0,0)
pmod=b'\0'*10
info=lst(b'INFO',chunk(b'ifil',struct.pack('<HH',2,1))+chunk(b'isng',z('EMU8000',8))+chunk(b'INAM',z('Electric Guitar Amp (FSBS DI, CC0)',40)))
sdta=lst(b'sdta',chunk(b'smpl',smpl))
pdta=lst(b'pdta',chunk(b'phdr',phdr)+chunk(b'pbag',pbag)+chunk(b'pmod',pmod)+chunk(b'pgen',pgen)+chunk(b'inst',inst)+chunk(b'ibag',ibag)+chunk(b'imod',imod)+chunk(b'igen',igen)+chunk(b'shdr',shdr_b))
body=b'sfbk'+info+sdta+pdta
open(OUT,'wb').write(b'RIFF'+struct.pack('<I',len(body))+body)
print('wrote',OUT,len(body)/1e6,'MB')
