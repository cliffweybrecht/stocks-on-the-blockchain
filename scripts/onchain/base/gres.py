"""GeckoTerminal reserve_in_usd for recounted pools (wash rule input) -> gres-DAY.json. Missing = no wash check."""
import json,sys,os,time
from gecko_http import gecko_get_json
day=sys.argv[1]; V=json.load(open(f'vol-{day}.json'))['pools']
P=sorted(V); out={}; t0=time.time(); BUD=float(os.environ.get('GRES_BUDGET_SECONDS','900'))
for i in range(0,len(P),30):
  if time.time()-t0>BUD: break
  url='https://api.geckoterminal.com/api/v2/networks/base/pools/multi/'+','.join(P[i:i+30])
  r=gecko_get_json(url)  # shared paced client: 2.1s pace, 429/5xx/timeout backoff + Retry-After
  j=r.body if r.ok else None
  if j is None: print('gecko batch failed',r.reason,r.status,file=sys.stderr)
  for d in (j or {}).get('data',[]):
    a=d.get('attributes',{}); r=a.get('reserve_in_usd')
    if r is not None: out[a['address'].lower()]={'res':float(r),'v24':float((a.get('volume_usd') or {}).get('h24') or 0)}
json.dump(out,open(f'gres-{day}.json','w')); print('gecko reserves',len(out),'of',len(P),round(time.time()-t0),'s')
