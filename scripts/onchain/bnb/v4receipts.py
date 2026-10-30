import json,gzip,collections,sys
from rpc import call
day=sys.argv[1]
SP=json.load(open('singleton_pools.json'));ids=json.load(open(f'sids-{day}.json'))
T=json.load(gzip.open(f'tr-{day}.json.gz','rt'));stx={l['tx'] for l in T['logs']};del T
L=json.load(gzip.open(f'sing-{day}.json.gz','rt'))
un={k for k in ids if k not in SP}; cnt=collections.Counter(l['tx'] for l in L)
cand=sorted({l['t'][1] for l in L if l['t'][1] in un and l['tx'] in stx})
PM='0x28e2ea090877bf75740558f6bfb36a5ffee9e9df';TOP='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
left=[]
for pid in cand:
  txs=[l['tx'] for l in L if l['t'][1]==pid and cnt[l['tx']]==1][:3]
  toks=collections.Counter()
  for tx in txs:
    for g in call('eth_getTransactionReceipt',[tx])['logs']:
      if g['topics'][0]==TOP and len(g['topics'])==3 and PM[2:] in g['topics'][1]+g['topics'][2]: toks[g['address'].lower()]+=1
  t=[x for x,_ in toks.most_common()]
  if len(t)==2: a,b=sorted(t)
  elif len(t)==1: a,b='0x'+'0'*40,t[0]
  else: left.append((pid,sum(1 for l in L if l['t'][1]==pid))); continue
  SP[pid]={'manager':PM,'dex':'uniswap-v4','c0':a,'c1':b,'via':'tokens transferred to/from PoolManager in single-swap txs'}
json.dump(SP,open('singleton_pools.json','w'))
json.dump(left,open(f'v4left-{day}.json','w')); print('v4 receipts: candidates',len(cand),'unresolvable',left)
