import json,gzip,sys,time
from rpc import batch
day=sys.argv[1]; P=json.load(open(f'nopair{day[-2:]}.json')); S=set(P)
TX=json.load(open(f'cftx{day[-2:]}.json')); TOP='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
t0=time.time(); out=[]
for i in range(0,len(TX),50):
  for r in batch([('eth_getTransactionReceipt',[h]) for h in TX[i:i+50]]):
    for l in r['logs']:
      t=l['topics']
      if t[0]==TOP and len(t)==3 and ('0x'+t[1][-40:] in S or '0x'+t[2][-40:] in S):
        out.append({'a':l['address'].lower(),'t':t,'d':l['data'],'b':int(l['blockNumber'],16),'tx':l['transactionHash'],'i':int(l['logIndex'],16)})
  if i%1000==0: print(i,len(out),round(time.time()-t0),flush=True)
json.dump({'pools':P,'logs':out},gzip.open(f'cflow-{day}.json.gz','wt')); print('cflow',len(out),round(time.time()-t0))
