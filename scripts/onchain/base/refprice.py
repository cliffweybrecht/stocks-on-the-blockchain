# hourly USD VWAP of WETH, cbBTC, EURC from Uniswap v3 */USDC 0.05% pool Swap logs over the ET day -> px-DAY.json
import json,gzip,sys
from getlogs import logs
day=sys.argv[1]; S,E,A,B=json.load(gzip.open(f'tr-{day}.json.gz','rt'))['range']
REF={'0x4200000000000000000000000000000000000006':('0xd0b53d9277642d899df5c87a3966a349a798f224',18),'0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf':('0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef',8),'0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42':('0x7279c08a36333e12c3fc81747963264c100d66fb',6)}
USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
def s(h):
  v=int(h,16); return v-(1<<256) if v>>255 else v
nb=B-A+1; H=24; out={'A':A,'B':B,'hours':H,'px':{}}
for tok,(pool,dec) in REF.items():
  L=logs({'address':pool,'topics':['0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67']},A,B,step=5000)
  t0=tok<USDC; u=[0.0]*H; q=[0.0]*H
  for l in L:
    d=l['data'][2:]; a0=abs(s(d[:64])); a1=abs(s(d[64:128]))
    x,usd=(a0/10**dec,a1/1e6) if t0 else (a1/10**dec,a0/1e6)
    h=min(H-1,(int(l['blockNumber'],16)-A)*H//nb); u[h]+=usd; q[h]+=x
  px=[u[h]/q[h] if q[h] else None for h in range(H)]
  for h in range(H):
    if px[h] is None: px[h]=next(p for p in px[h:]+px[::-1] if p)
  out['px'][tok]=px; print(tok[:8],len(L),round(min(px),4),round(max(px),4))
json.dump(out,open(f'px-{day}.json','w'))
