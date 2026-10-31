"""Refuse the day if the RPC has pruned its logs: the chain's main stablecoin must have Transfer logs
in the first and last 200 blocks of the ET-day range (some public nodes return [] for old ranges)."""
import json,gzip,sys,time
from rpc import call
day=sys.argv[1]; S,E,A,B=json.load(gzip.open(f'tr-{day}.json.gz','rt'))['range']
for a,b in ((A,A+199),(B-199,B)):
  for att in range(4):  # an empty answer can be a lagging/flaky node: re-ask a few times before declaring the history pruned
    n=len(call('eth_getLogs',[{'address':'0x55d398326f99059ff775485246999027b3197955','topics':['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],'fromBlock':hex(a),'toBlock':hex(b)}]))
    if n>0: break
    if att<3: print('probe empty, retry',att+1,flush=True); time.sleep(10*(att+1))
  print('probe',a,b,'stable transfers',n)
  if n==0:
    json.dump({'chain':'bnb','day':day,'ready':False,'reasons':[f'RPC returned no logs for blocks {a}-{b}: endpoint has pruned history for this day (set an archive RPC secret)']},open('rpc-probe-failed.json','w'))
    sys.exit(3)
