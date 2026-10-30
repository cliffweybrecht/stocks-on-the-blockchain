"""Auto-rule for singleton ids still without a token pair after getter/receipts/Initialize/amount-match:
if every tracked-stock Transfer in that id's swap txs is dust (< DUST units) it is a non-stock hop -> $0;
otherwise the day is NOT READY. Writes leftover-DAY.json {zero:[...], blocking:[...]}"""
import json,gzip,sys,collections,os
day=sys.argv[1]; DUST=float(os.environ.get('LEFTOVER_DUST_UNITS','1e-6'))
left=json.load(open(f'v4left2-{day}.json')) if os.path.exists(f'v4left2-{day}.json') else []
SP=json.load(open('singleton_pools.json')); left=[p for p in left if p not in SP]
DEC=json.load(open('dec.json')); U=set(json.load(open('universe.json')))
L=json.load(gzip.open(f'sing-{day}.json.gz','rt')); txs=collections.defaultdict(set)
for l in L: txs[l['t'][1]].add(l['tx'])
mx=collections.defaultdict(float)
alltx=set().union(*[txs[p] for p in left]) if left else set()
for l in json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs']:
  if l['tx'] in alltx and l['a'] in U:
    d=DEC.get(l['a'])
    v=int(l['d'],16)/10**(d if d is not None else 0)
    for p in left:
      if l['tx'] in txs[p]: mx[p]=max(mx[p],v if d is not None else float('inf'))
zero=[{'id':p,'maxStockUnits':mx[p]} for p in left if mx[p]<DUST]
block=[{'id':p,'maxStockUnits':mx[p]} for p in left if mx[p]>=DUST]
json.dump({'zero':zero,'blocking':block},open(f'leftover-{day}.json','w'),indent=1); print('leftover ids',len(left),'dust->$0',len(zero),'blocking',len(block))
