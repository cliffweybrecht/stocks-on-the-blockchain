"""For pools with swap events we cannot decode, fetch receipts of their swap txs (batched) and keep Transfer logs touching the pool."""
import json,gzip,sys,urllib.request,time
from rpc import RPC
from concurrent.futures import ThreadPoolExecutor
UNK=('0xcad09799','0x97348197','0xad7d6f97','0xc528cda9','0xec36bf57','0x8113d738')
TR='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
day=sys.argv[1]; L=json.load(gzip.open(f'logs-{day}.json.gz','rt'))
import os
ONLY=os.environ.get('ONLY','').split(',') if os.environ.get('ONLY') else None
sw=[l for l in L['logs'] if (l['address'].lower() in ONLY if ONLY else l['topics'][0][:10] in UNK) and (not ONLY or l['topics'][0][:10] in ('0xc42079f9','0x19b47279'))]
pools=sorted({l['address'].lower() for l in sw}); txs=sorted({l['transactionHash'] for l in sw})
print(day,len(pools),len(txs),flush=True)
pt={'0x'+'0'*24+p[2:]:p for p in pools}
def batch(hs):
  body=json.dumps([{"jsonrpc":"2.0","id":i,"method":"eth_getTransactionReceipt","params":[h]} for i,h in enumerate(hs)]).encode()
  for a in range(20):
    try:
      r=json.loads(urllib.request.urlopen(urllib.request.Request(RPC,body,{"content-type":"application/json","user-agent":"curl/8"}),timeout=90).read())
      if all('result' in x and x['result'] for x in r): return [x['result'] for x in r]
      raise Exception('partial')
    except Exception as e: time.sleep(min(30,3*(a+1)))  # public RPC 429s on GH runners: back off longer
  raise Exception('batch failed')
out=[]
with ThreadPoolExecutor(2) as ex:
  for n,rs in enumerate(ex.map(batch,[txs[i:i+40] for i in range(0,len(txs),40)])):
    for r in rs:
      for l in r['logs']:
        if l['topics'] and l['topics'][0]==TR and len(l['topics'])==3 and (l['topics'][1] in pt or l['topics'][2] in pt):
          out.append({'address':l['address'].lower(),'from':'0x'+l['topics'][1][-40:],'to':'0x'+l['topics'][2][-40:],'v':int(l['data'],16) if l['data']!='0x' else 0,'tx':l['transactionHash'],'b':int(l['blockNumber'],16)})
    if n%25==0: print(day,n,len(out),flush=True)
json.dump({'pools':pools,'transfers':out},gzip.open(os.environ.get('OUT',f'xfer-{day}.json.gz'),'wt')); print('done',day,len(out))
