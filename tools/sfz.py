import re
def parse_sfz(path):
    txt=open(path,encoding='utf-8',errors='replace').read()
    txt=re.sub(r'//[^\n]*','',txt)
    groups=[]; glob={}; cur=None; mode=None
    for tok in re.finditer(r'<(\w+)>|([\w]+)=([^\s<]+(?:[^\S\n]+(?![\w]+=)[^\s<]+)*)', txt):
        if tok.group(1):
            mode=tok.group(1)
            if mode=='group': cur={'opts':{},'regions':[]}; groups.append(cur)
            elif mode=='region': cur['regions'].append({})
        else:
            k,v=tok.group(2),tok.group(3).strip()
            if mode=='global': glob[k]=v
            elif mode=='group': cur['opts'][k]=v
            elif mode=='region': cur['regions'][-1][k]=v
    return glob, groups
