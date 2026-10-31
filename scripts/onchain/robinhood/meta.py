import json,sys
from gecko_http import gecko_get_json
pools=json.load(open('allpools.json')); meta=json.load(open('meta.json')) if __import__('os').path.exists('meta.json') else {}
todo=[p for p in pools if p not in meta]
for i in range(0,len(todo),30):
  b=todo[i:i+30]
  r=gecko_get_json("https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/"+",".join(b)+"?include=base_token,quote_token,dex")
  j=r.body if r.ok else None
  if j is None: print('gecko meta batch failed',r.reason,r.status,file=sys.stderr)
  if not j: continue
  inc={x['id']:x for x in j.get('included',[])}
  for d in j['data']:
    at=d['attributes']; rel=d['relationships']
    def tok(k):
      t=inc.get(rel[k]['data']['id'],{}).get('attributes',{}); return {'address':(t.get('address') or rel[k]['data']['id'].split('_',1)[1]).lower(),'symbol':t.get('symbol'),'decimals':t.get('decimals')}
    meta[at['address'].lower()]={'base':tok('base_token'),'quote':tok('quote_token'),'dex':rel['dex']['data']['id'],'created':at.get('pool_created_at'),'reserve':at.get('reserve_in_usd')}
  json.dump(meta,open('meta.json','w')); print(i,len(meta),flush=True)
