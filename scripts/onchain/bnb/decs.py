import json,os
from rpc import batch
D=json.load(open('dec.json')) if os.path.exists('dec.json') else {}
C=json.load(open('cp_class.json')); SP={k:v for k,v in json.load(open('singleton_pools.json')).items() if k.startswith('0x')}
toks={t for v in C.values() for t in v if t}|{v[k] for v in SP.values() for k in ('c0','c1')}|{r['address'].lower() for r in json.load(open('universe_raw.json'))[0]}
D['0x'+'0'*40]=18; D['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']=18
need=sorted(t for t in toks if t not in D)
for i in range(0,len(need),20):
  ch=need[i:i+20]; r=batch([('eth_call',[{'to':t,'data':'0x313ce567'},'latest']) for t in ch])
  for t,x in zip(ch,r): D[t]=int(x,16) if x and len(x)>2 else None
  json.dump(D,open('dec.json','w'))
print('decimals',len(D),'unreadable',sum(1 for v in D.values() if v is None))
