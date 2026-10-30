# hourly slot0 prices of BNB/BTCB/ETH vs USDT (PancakeSwap v3 reference pools) at 25 hour-boundary blocks -> px-DAY.json
import json,sys
from blocks import first_at_or_after
from rpc import call
day=sys.argv[1]; S,E,A,B=json.load(__import__('gzip').open(f'tr-{day}.json.gz','rt'))['range']
REF={'0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c':('0x172fcd41e0913e95784454622d1c3724f546f849',1),'0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c':('0x46cf1cf8c69595804ba91dfdd8d6b960c9b0a7c4',1),'0x2170ed0880ac9a755fd29b2688956bd959f933f8':('0xbe141893e4c6ad9272e8c04bab7e6a10604501a5',0)}
out={'blocks':[],'px':{k:[] for k in REF}}
for h in range(25):
  b=min(B,first_at_or_after(S+3600*h)); out['blocks'].append(b)
  for tok,(pool,side) in REF.items():
    sq=int(call('eth_call',[{'to':pool,'data':'0x3850c7bd'},hex(b)])[2:66],16); p=(sq/2**96)**2  # token1 per token0 (both 18 dec)
    out['px'][tok].append(1/p if side==1 else p)
json.dump(out,open(f'px-{day}.json','w')); print(day,{k[:8]:[round(v[0],2),round(v[-1],2)] for k,v in out['px'].items()})
