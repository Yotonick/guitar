import numpy as np, soundfile as sf, glob, re, os, sys
from scipy import signal
SRC="/home/claude/fp/direct/EGuitarFSBS-direct SFZ+FLAC-20220911/samples/bridge"
FS=48000; OS=4; FSO=FS*OS
NOTE={'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}

def sos(kind,f,fs,q=0.707,g=0):
    w=2*np.pi*f/fs; a=np.sin(w)/(2*q); c=np.cos(w); A=10**(g/40)
    if kind=='hp': b=[(1+c)/2,-(1+c),(1+c)/2]; aa=[1+a,-2*c,1-a]
    elif kind=='lp': b=[(1-c)/2,1-c,(1-c)/2]; aa=[1+a,-2*c,1-a]
    elif kind=='peak': b=[1+a*A,-2*c,1-a*A]; aa=[1+a/A,-2*c,1-a/A]
    elif kind=='lshelf':
        s=2*np.sqrt(A)*a
        b=[A*((A+1)-(A-1)*c+s),2*A*((A-1)-(A+1)*c),A*((A+1)-(A-1)*c-s)]
        aa=[(A+1)+(A-1)*c+s,-2*((A-1)+(A+1)*c),(A+1)+(A-1)*c-s]
    elif kind=='hshelf':
        s=2*np.sqrt(A)*a
        b=[A*((A+1)+(A-1)*c+s),-2*A*((A-1)+(A+1)*c),A*((A+1)+(A-1)*c-s)]
        aa=[(A+1)-(A-1)*c+s,2*((A-1)-(A+1)*c),(A+1)-(A-1)*c-s]
    b=np.array(b)/aa[0]; aa=np.array(aa)/aa[0]
    return np.concatenate([b,aa])[None,:]
def flt(x,*secs): 
    return signal.sosfilt(np.vstack(secs),x)

def env(x,ms=20):
    n=int(FS*ms/1000); k=np.ones(n)/n
    return np.sqrt(np.convolve(x*x,k,mode='same'))

def gate(x,lo=-52,hi=-38):
    e=env(x); pk=e.max()+1e-9
    r=20*np.log10(e/pk+1e-9)
    g=np.clip((r-lo)/(hi-lo),0,1)
    g=signal.sosfilt(*[signal.butter(1,30,fs=FS,output='sos')],g)
    return x*np.clip(g,0,1)

PRESETS={
 'clean': dict(hp=70, pre=None, g=[], post=None, cab=False),
 'od':    dict(hp=120, pre=(750,0.8,7), g=[(3.0,0.10),(2.0,0.0)], lp=6500, tone=dict(low=2,mid=-1,pres=2), cab=True, cabLP=5200),
 'dist':  dict(hp=140, pre=(800,0.8,10), g=[(8.0,0.15),(5.0,0.05),(2.5,0.0)], lp=6000, tone=dict(low=3,mid=-4,pres=3), cab=True, cabLP=5000),
}
def amp(x,name):
    p=PRESETS[name]
    x=x/ (np.sqrt(np.mean(x[:int(0.6*FS)]**2))+1e-9) * 0.12   # constant input level
    x=gate(x) if name!='clean' else x
    x=flt(x,sos('hp',p['hp'],FS,0.707))
    if p.get('pre'):
        f,q,g=p['pre']; x=flt(x,sos('peak',f,FS,q,g))
    y=signal.resample_poly(x,OS,1)
    for k,(gain,bias) in enumerate(p['g']):
        y=np.tanh(gain*y+bias)-np.tanh(bias)
        if k<len(p['g'])-1: y=flt(y,sos('lp',p['lp'],FSO,0.707))*0.9
        y=flt(y,sos('hp',60,FSO,0.707))
    y=signal.resample_poly(y,1,OS)
    if p['g']:
        t=p['tone']
        y=flt(y,sos('lshelf',110,FS,0.7,t['low']),sos('peak',550,FS,0.7,t['mid']),sos('peak',2200,FS,0.9,t['pres']))
    if p.get('cab'):
        y=flt(y,sos('hp',85,FS,0.8),sos('peak',115,FS,1.2,4),sos('peak',2500,FS,1.0,3),sos('lp',p['cabLP'],FS,0.707),sos('lp',p['cabLP']*1.15,FS,0.707),sos('lp',9000,FS,0.707))
    else:
        y=flt(y,sos('lp',9500,FS,0.707),sos('peak',3000,FS,0.8,1.5),sos('lshelf',150,FS,0.7,1.5))
    return y

def load_samples():
    out={}
    for f in sorted(glob.glob(SRC+'/*.flac')):
        m=re.match(r'([A-G]#?)(\d)_s(\d)(_soft)?_(\d\d)\.flac',os.path.basename(f))
        if not m: continue
        note,oct_,s,soft,rr=m.groups()
        if soft or rr!='01': continue
        midi=12*(int(oct_)+1)+NOTE[note]
        if midi in out: continue
        out[midi]=f
    return out

def f0_cents(x,midi):
    seg=x[int(.15*FS):int(.15*FS)+16384]
    seg=seg-seg.mean(); n=len(seg)
    ac=np.fft.irfft(np.abs(np.fft.rfft(seg,2*n))**2)[:n]
    f_exp=440*2**((midi-69)/12)
    lo=int(FS/(f_exp*1.06)); hi=int(FS/(f_exp/1.06))
    k=lo+np.argmax(ac[lo:hi])
    if 1<k<n-1:
        a,b,c=ac[k-1],ac[k],ac[k+1]; k=k+0.5*(a-c)/(a-2*b+c)
    f=FS/k
    return 1200*np.log2(f/f_exp)

def prep(x,seconds=6.0):
    x=x.astype(np.float64)
    pk=np.abs(x).max()
    on=np.argmax(np.abs(x)>0.03*pk); on=max(0,on-int(0.004*FS))
    return x[on:], 

if __name__=='__main__':
    S=load_samples(); print(len(S),sorted(S))
    for m in sorted(S)[:3]:
        x,sr=sf.read(S[m]); print(m,sr,len(x)/sr,f0_cents(x,m))
