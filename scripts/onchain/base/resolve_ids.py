import json,sys,os
from rpc import batch
V4='0x498581ff718922c3f8e6a244956af099b2652b2b'; POSM='0x7c5f5a4bbd8fd63184577525326123b519429bdc'
DEX={V4:'uniswap-v4','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b':'pancakeswap-infinity-cl','0xc697d2898e0d09264376196696c51d7abbbaa4a9':'pancakeswap-infinity-bin'}
SP=json.load(open('singleton_pools.json')) if os.path.exists('singleton_pools.json') else {}
need={}
for day in sys.argv[1:]:
  for k,a in json.load(open(f'sids-{day}.json')).items():
    if k not in SP: need[k]=a
ids=sorted(need); print('need',len(ids),flush=True)
for i in range(0,len(ids),10):
  ch=ids[i:i+10]
  req=[('eth_call',[{'to':POSM,'data':'0x86b6be7d'+pid[2:52]+'0'*14},'latest']) if need[pid]==V4 else ('eth_call',[{'to':need[pid],'data':'0x0e2d484a'+pid[2:]},'latest']) for pid in ch]
  for pid,r in zip(ch,batch(req)):
    if r and len(r)>=130 and int(r[2:66],16)|int(r[66:130],16):
      SP[pid]={'manager':need[pid],'dex':DEX[need[pid]],'c0':'0x'+r[26:66],'c1':'0x'+r[90:130],'via':'poolKey getter'}
  if i%1000==0: print(i,flush=True); json.dump(SP,open('singleton_pools.json','w'))
json.dump(SP,open('singleton_pools.json','w'))
print('unresolved',sum(1 for p in ids if p not in SP))
