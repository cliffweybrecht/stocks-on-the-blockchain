# token0/token1 for every Transfer counterparty of a stock token on DAY (+known 42-pools) -> cp_class.json cache
import json,gzip,sys,os
from rpc import batch
C=json.load(open('cp_class.json')) if os.path.exists('cp_class.json') else {}
KN=json.load(open('known_pools.json'))
new=set()
for day in sys.argv[1:]:
  for l in json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs']:
    for a in ('0x'+l['t'][1][-40:],'0x'+l['t'][2][-40:]):
      if a not in C and a!='0x'+'0'*40: new.add(a)
new|={k for k in KN if len(k)==42 and k not in C}
new=sorted(new); print('to classify',len(new),flush=True)
def addr(r): return ('0x'+r[-40:]).lower() if r and len(r)==66 else None
for i in range(0,len(new),10):
  ch=new[i:i+10]; rq=[]
  for a in ch: rq+=[('eth_call',[{'to':a,'data':'0x0dfe1681'},'latest']),('eth_call',[{'to':a,'data':'0xd21220a7'},'latest'])]
  r=batch(rq)
  for k,a in enumerate(ch): C[a]=[addr(r[2*k]),addr(r[2*k+1])]
  if i%500==0: print(i,flush=True); json.dump(C,open('cp_class.json','w'))
json.dump(C,open('cp_class.json','w'))
