# all logs (by address, 10 per query) of every 42-byte pool that moved a stock token in DAY -> logs-DAY.json.gz
import json,gzip,sys,time
from getlogs import logs,slim
day=sys.argv[1]; t=time.time()
T=json.load(gzip.open(f'tr-{day}.json.gz','rt')); S,E,A,B=T['range']
U=set(json.load(open('universe.json'))); KN=json.load(open('known_pools.json')); C=json.load(open('cp_class.json'))
cps=set()
for l in T['logs']: cps.add('0x'+l['t'][1][-40:]); cps.add('0x'+l['t'][2][-40:])
P=sorted(a for a in cps if (a in KN and len(a)==42) or (a in C and C[a][0] and C[a][1] and (C[a][0] in U or C[a][1] in U)))
print(day,'42-pools that moved stock',len(P),flush=True)
out=[]
for g in range(0,len(P),10):
  out+=[slim(l) for l in logs({'address':P[g:g+10]},A,B)]
  if g%100==0: print(' addr group',g,len(out),round(time.time()-t),flush=True)
json.dump({'range':[S,E,A,B],'pools42':P,'logs':out},gzip.open(f'logs-{day}.json.gz','wt'))
print('done',len(out),'secs',round(time.time()-t))
