import json,sys,time,urllib.error
from rpc import post_retry as _post
day=sys.argv[1]; left=[x[0] for x in json.load(open(f'v4left-{day}.json'))]
SP=json.load(open('singleton_pools.json'))
MG=['0x498581ff718922c3f8e6a244956af099b2652b2b','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b','0xc697d2898e0d09264376196696c51d7abbbaa4a9']
INIT=['0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438','0x426ba7a1ca1ed1ab5e7fdc1bd7a5ff1e8da4ad19f3bcd1b4a1e0e78dd31b5b16','0x8ee86e74b1d0c29bdc35a4b2a8a6e2b7fbc11a10a7b81b2f7f9b8c28e0ec9a27']
hi=int(_post({'jsonrpc':'2.0','id':1,'method':'eth_blockNumber','params':[]})['result'],16); step=45000; found={}
todo=set(left); b=hi; t=time.time()
MAXSTEPS=int(__import__('os').environ.get('INITFIND_MAX_STEPS','400')); n=0
while todo and b>0 and n<MAXSTEPS:
  n+=1
  try: j=_post({'jsonrpc':'2.0','id':1,'method':'eth_getLogs','params':[{'address':MG,'topics':[None,sorted(todo)],'fromBlock':hex(b-step),'toBlock':hex(b)}]})
  except Exception as e: print('stop at',b,str(e)[:120]); break  # retries exhausted: leave ids unresolved
  if 'error' in j: print('err',b,str(j['error'])[:120]); time.sleep(2); continue
  for l in j['result']:
    pid=l['topics'][1]
    if pid in todo and len(l['topics'])>=4:
      found[pid]=(l['address'].lower(),'0x'+l['topics'][2][-40:],'0x'+l['topics'][3][-40:],l['topics'][0]); todo.discard(pid)
  b-=step+1
  if (hi-b)//step%40==0: print(b,len(found),round(time.time()-t),flush=True)
DEX={'0x498581ff718922c3f8e6a244956af099b2652b2b':'uniswap-v4','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b':'pancakeswap-infinity-cl','0xc697d2898e0d09264376196696c51d7abbbaa4a9':'pancakeswap-infinity-bin'}
for pid,(m,c0,c1,tp) in found.items(): SP[pid]={'manager':m,'dex':DEX[m],'c0':c0,'c1':c1,'via':'Initialize event'}
json.dump(SP,open('singleton_pools.json','w')); json.dump(sorted(todo),open(f'v4left2-{day}.json','w'))
print('found',len(found),'left',len(todo),'scanned back to',b)
