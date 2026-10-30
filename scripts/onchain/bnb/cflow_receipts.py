"""Public-RPC variant of cflow.py (publicnode refuses address-less getLogs): every tx in the ET day where a custom pool
sent/received a stock token, read by receipt; keep all ERC20 Transfers touching a custom pool -> cflow-DAY.json.gz"""
import json,gzip,sys,time
from rpc import batch
day=sys.argv[1]; P=json.load(open(f'nopair{day[-2:]}.json')); S=set(P); TOP='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
TX=sorted({l['tx'] for l in json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs'] if '0x'+l['t'][1][-40:] in S or '0x'+l['t'][2][-40:] in S})
t0=time.time(); out=[]
for i in range(0,len(TX),50):
  for r in batch([('eth_getTransactionReceipt',[h]) for h in TX[i:i+50]]):
    for l in (r or {}).get('logs',[]):
      t=l['topics']
      if t and t[0]==TOP and len(t)==3 and ('0x'+t[1][-40:] in S or '0x'+t[2][-40:] in S):
        out.append({'a':l['address'].lower(),'t':t,'d':l['data'],'b':int(l['blockNumber'],16),'tx':l['transactionHash'],'i':int(l['logIndex'],16)})
  if i%1000==0: print(i,len(TX),len(out),round(time.time()-t0),flush=True)
json.dump({'pools':P,'logs':out},gzip.open(f'cflow-{day}.json.gz','wt')); print('cflow',len(TX),'txs',len(out),'transfers',round(time.time()-t0))
