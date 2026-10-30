# day logs for (a) every v2/v3-style or known pool that moved a stock token that day (all topics, by address)
# (b) singleton pools (uniswap v4 / pancake infinity CL+Bin) by pool id from Initialize scan + known ids  -> logs-DAY.json.gz
import json,gzip,sys,time
from getlogs import logs,slim
day=sys.argv[1]; t=time.time()
T=json.load(gzip.open(f'tr-{day}.json.gz','rt')); S,E,A,B=T['range']
U={r['address'].lower() for r in json.load(open('universe_raw.json'))[0]}
known=json.load(open('known_pools.json')); C=json.load(open('cp_class.json'))
cps=set()
for l in T['logs']: cps.add('0x'+l['t'][1][-40:]); cps.add('0x'+l['t'][2][-40:])
P=sorted(a for a in cps if (a in known and len(a)==42) or (a in C and C[a][0] and C[a][1] and (C[a][0] in U or C[a][1] in U)))
print(day,'42-pools that moved stock',len(P),flush=True)
out=[]
for g in range(0,len(P),500):
  out+=[slim(l) for l in logs({'address':P[g:g+500]},A,B)]; print(' addr group',g,len(out),round(time.time()-t),flush=True)
SP=json.load(open('singleton_pools.json')) if __import__('os').path.exists('singleton_pools.json') else {}
ids=sorted({k for k in SP if k.startswith('0x')}|{k for k in known if len(k)==66})
MG=['0x28e2ea090877bf75740558f6bfb36a5ffee9e9df','0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b','0xc697d2898e0d09264376196696c51d7abbbaa4a9']
SW=['0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f','0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237','0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861']
for g in range(0,len(ids),900):
  out+=[slim(l) for l in logs({'address':MG,'topics':[SW,ids[g:g+900]]},A,B)]; print(' id group',g,len(out),round(time.time()-t),flush=True)
json.dump({'range':[S,E,A,B],'pools42':P,'ids':ids,'logs':out},gzip.open(f'logs-{day}.json.gz','wt'))
print('done',len(out),'secs',round(time.time()-t))
