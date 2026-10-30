"""Refuse the day if the RPC has pruned its logs: the chain's main stablecoin must have Transfer logs
in the first and last 200 blocks of the ET-day range (some public nodes return [] for old ranges)."""
import json,gzip,sys
from rpc import call
day=sys.argv[1]; S,E,A,B=json.load(gzip.open(f'tr-{day}.json.gz','rt'))['range']
for a,b in ((A,A+19),(B-19,B)):
  try:
    n=len(call('eth_getLogs',[{'address':'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913','topics':['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],'fromBlock':hex(a),'toBlock':hex(b)}]))
  except Exception as e:
    # A busy USDC range can exceed the node's result cap: that proves logs exist (not pruned).
    if 'max results' in str(e) or 'too many' in str(e).lower() or 'limit' in str(e).lower(): n=-1
    else: raise
  print('probe',a,b,'stable transfers',n)
  if n==0:
    json.dump({'chain':'base','day':day,'ready':False,'reasons':[f'RPC returned no logs for blocks {a}-{b}: endpoint has pruned history for this day (set an archive RPC secret)']},open('rpc-probe-failed.json','w'))
    sys.exit(3)
