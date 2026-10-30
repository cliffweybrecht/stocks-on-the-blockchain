# unknown counterparties that move >=0.2% of a stock token's day transfer amount in both directions -> cand-DAY.json
import json,gzip,collections,sys
day=sys.argv[1]
L=json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs']
known=json.load(open('known_pools.json'))
io=collections.defaultdict(lambda:[0,0]); tot=collections.Counter()
for l in L:
  v=int(l['d'],16) if len(l['d'])>2 else 0
  f='0x'+l['t'][1][-40:]; t='0x'+l['t'][2][-40:]
  io[(f,l['a'])][1]+=v; io[(t,l['a'])][0]+=v; tot[l['a']]+=v
c=sorted({a for (a,tok),(i,o) in io.items() if a not in known and a!='0x'+'0'*40 and tot[tok] and min(i,o)>=0.002*tot[tok]})
json.dump(c,open(f'cand-{day}.json','w')); print(day,'candidates',len(c))
