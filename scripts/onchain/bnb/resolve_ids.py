import json,gzip,sys
from rpc import batch
SING={'0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f','0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237','0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861'}
V4='0x28e2ea090877bf75740558f6bfb36a5ffee9e9df'; POSM='0x7a4a5c919ae2541aed11041a1aeee68f1287f95b'
DEX={V4:'uniswap-v4','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b':'pancakeswap-infinity-cl','0xc697d2898e0d09264376196696c51d7abbbaa4a9':'pancakeswap-infinity-bin'}
SP=json.load(open('singleton_pools.json'))
need={}
for day in sys.argv[1:]:
  for l in json.load(gzip.open(f'logs-{day}.json.gz','rt'))['logs']:
    if l['t'][0] in SING and l['t'][1] not in SP: need[l['t'][1]]=l['a']
  try:
    for k,a in json.load(open(f'sids-{day}.json')).items():
      if k not in SP: need[k]=a
  except FileNotFoundError: pass
ids=list(need); print('need',len(ids))
for i in range(0,len(ids),20):
  ch=ids[i:i+20]
  req=[('eth_call',[{'to':POSM,'data':'0x86b6be7d'+pid[2:52]+'0'*14},'latest']) if need[pid]==V4 else ('eth_call',[{'to':need[pid],'data':'0x0e2d484a'+pid[2:]},'latest']) for pid in ch]
  for pid,r in zip(ch,batch(req)):
    if r and len(r)>=130 and int(r[2:66],16)|int(r[66:130],16):
      SP[pid]={'manager':need[pid],'dex':DEX[need[pid]],'c0':'0x'+r[26:66],'c1':'0x'+r[90:130],'via':'poolKey getter'}
  json.dump(SP,open('singleton_pools.json','w'))
print('unresolved',sum(1 for p in ids if p not in SP))
