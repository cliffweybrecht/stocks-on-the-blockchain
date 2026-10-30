# resolve leftover singleton ids: match Swap amount0/amount1 to ERC20 Transfer values into/out of the vault in the same tx
import json,gzip,collections,sys
from rpc import batch
day=sys.argv[1]; left=json.load(open(f'v4left2-{day}.json'))
SP=json.load(open('singleton_pools.json')); L=json.load(gzip.open(f'sing-{day}.json.gz','rt'))
VAULT={'0x498581ff718922c3f8e6a244956af099b2652b2b':'498581ff718922c3f8e6a244956af099b2652b2b'}
TOP='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
def s(h):
  v=int(h,16); return v-(1<<256) if v>>255 else v
res={}
for pid in left:
  sw=[l for l in L if l['t'][1]==pid][:6]; V=VAULT.get(sw[0]['a'],'')
  m0=collections.Counter(); m1=collections.Counter(); un0=0
  for l,r in zip(sw,batch([('eth_getTransactionReceipt',[l['tx']]) for l in sw])):
    d=l['d'][2:]; a0=abs(s(d[:64])); a1=abs(s(d[64:128]))
    vals=collections.defaultdict(set)
    for g in r['logs']:
      if g['topics'][0]==TOP and len(g['topics'])==3 and V and V in g['topics'][1]+g['topics'][2]: vals[int(g['data'],16)].add(g['address'].lower())
    for t in vals.get(a0,()): m0[t]+=1
    for t in vals.get(a1,()): m1[t]+=1
    if a0 not in vals: un0+=1
  c0=m0.most_common(1)[0][0] if m0 else None; c1=m1.most_common(1)[0][0] if m1 else None
  if c0 is None and c1 and un0==len(sw): c0='0x'+'0'*40   # currency0 never an ERC20 transfer -> native ETH
  res[pid]=(c0,c1,len(sw))
  if c0 and c1 and c0<c1: SP[pid]={'manager':sw[0]['a'],'dex':'uniswap-v4','c0':c0,'c1':c1,'via':'Swap amounts matched to vault Transfer values'}
# Ids still without a pool key: use the pair GeckoTerminal reported for this pool id (known_pools.json).
# V4 PoolKey orders currency0 < currency1, so the two addresses are sorted.
import os
KN=json.load(open('known_pools.json')) if os.path.exists('known_pools.json') else {}
for pid in [x[0] if isinstance(x,list) else x for x in (json.load(open(f'v4left2-{day}.json')) if os.path.exists(f'v4left2-{day}.json') else [])]:
  k=KN.get(pid)
  if pid in SP or not k or not k.get('base') or not k.get('quote'): continue
  c0,c1=sorted([k['base'].lower(),k['quote'].lower()])
  SP[pid]={'manager':None,'dex':k.get('dex'),'c0':c0,'c1':c1,'via':'GeckoTerminal pool metadata (known_pools)'}; print(pid[:12],'resolved via known_pools')
json.dump(SP,open('singleton_pools.json','w'))
U=set(json.load(open('universe.json')))
for k,v in res.items(): print(k[:12],v,'STOCK' if (v[0] in U or v[1] in U) else '', 'resolved' if k in SP else 'LEFT')
