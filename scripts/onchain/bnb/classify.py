# classify transfer counterparties: token0/token1 (v2/v3-style pools) -> cp_class.json cache
import json,gzip,sys,collections
from rpc import batch
from concurrent.futures import ThreadPoolExecutor
C=json.load(open('cp_class.json')) if __import__('os').path.exists('cp_class.json') else {}
U={r['address'].lower() for r in json.load(open('universe_raw.json'))[0]}
new=set()
known=json.load(open('known_pools.json'))
for day in sys.argv[1:]:
  for a in json.load(open(f'cand-{day}.json'))+[k for k in known if len(k)==42]:
    if a not in C: new.add(a)
new=sorted(new); print('to classify',len(new),flush=True)
def addr(r): return ('0x'+r[-40:]).lower() if r and len(r)>=66 else None
def job(ch):
  rq=[]
  for a in ch: rq+= [('eth_call',[{'to':a,'data':'0x0dfe1681'},'latest']),('eth_call',[{'to':a,'data':'0xd21220a7'},'latest'])]
  r=batch(rq); return {a:[addr(r[2*i]),addr(r[2*i+1])] for i,a in enumerate(ch)}
chs=[new[i:i+12] for i in range(0,len(new),12)]
with ThreadPoolExecutor(1) as ex:
  for k,res in enumerate(ex.map(job,chs)):
    C.update(res)
    if k%20==0: print(k,len(chs),flush=True); json.dump(C,open('cp_class.json','w'))
json.dump(C,open('cp_class.json','w'))
pools={a:v for a,v in C.items() if v[0] and v[1] and (v[0] in U or v[1] in U)}
print('pool-like counterparties with a stock token',len(pools))
