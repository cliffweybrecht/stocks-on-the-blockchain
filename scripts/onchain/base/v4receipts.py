import json,gzip,collections,sys
from rpc import batch
day=sys.argv[1]
SP=json.load(open('singleton_pools.json')); need=json.load(open(f'unres_ids{day[-2:]}.json'))
L=json.load(gzip.open(f'sing-{day}.json.gz','rt')); cnt=collections.Counter(l['tx'] for l in L)
VAULT={'0x498581ff718922c3f8e6a244956af099b2652b2b':'0x498581ff718922c3f8e6a244956af099b2652b2b','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b':'0x238a358808379702088667322f80ac48bad5e6c4','0xc697d2898e0d09264376196696c51d7abbbaa4a9':'0x238a358808379702088667322f80ac48bad5e6c4'}
DEX={'0x498581ff718922c3f8e6a244956af099b2652b2b':'uniswap-v4','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b':'pancakeswap-infinity-cl','0xc697d2898e0d09264376196696c51d7abbbaa4a9':'pancakeswap-infinity-bin'}
TOP='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
mgr={l['t'][1]:l['a'] for l in L}; left=[]
for pid in need:
  txs=[l['tx'] for l in L if l['t'][1]==pid and cnt[l['tx']]==1][:3]
  toks=collections.Counter(); V=VAULT[mgr[pid]][2:]
  for r in batch([('eth_getTransactionReceipt',[tx]) for tx in txs]) if txs else []:
    for g in (r or {}).get('logs',[]):
      if g['topics'][0]==TOP and len(g['topics'])==3 and V in g['topics'][1]+g['topics'][2]: toks[g['address'].lower()]+=1
  t=[x for x,_ in toks.most_common()]
  if len(t)==2: a,b=sorted(t)
  elif len(t)==1 and txs: a,b='0x'+'0'*40,t[0]
  else: left.append((pid,sum(1 for l in L if l['t'][1]==pid),len(txs))); continue
  SP[pid]={'manager':mgr[pid],'dex':DEX[mgr[pid]],'c0':a,'c1':b,'via':'tokens transferred to/from vault in single-swap txs'}
json.dump(SP,open('singleton_pools.json','w'))
json.dump(left,open(f'v4left-{day}.json','w')); print('need',len(need),'left',len(left),left[:10])
