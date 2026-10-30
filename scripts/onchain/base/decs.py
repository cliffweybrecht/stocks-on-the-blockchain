import json,os
from rpc import batch
D=json.load(open('dec.json')) if os.path.exists('dec.json') else {}
C=json.load(open('cp_class.json')); SP=json.load(open('singleton_pools.json')); U=set(json.load(open('universe.json')))
toks={t for v in C.values() for t in v if t and (v[0] in U or v[1] in U)}|{v[k] for v in SP.values() for k in ('c0','c1') if v['c0'] in U or v['c1'] in U}|U|{'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913','0x4200000000000000000000000000000000000006'}
D['0x'+'0'*40]=18; D['0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee']=18
need=sorted(t for t in toks if t not in D)
for i in range(0,len(need),10):
  ch=need[i:i+10]; r=batch([('eth_call',[{'to':t,'data':'0x313ce567'},'latest']) for t in ch])
  for t,x in zip(ch,r): D[t]=int(x,16) if x and len(x)>2 else None
json.dump(D,open('dec.json','w')); print('decimals',len(D),'unreadable',[k for k,v in D.items() if v is None])
