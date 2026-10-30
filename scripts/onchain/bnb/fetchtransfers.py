# stock-token Transfer logs for the ET day -> tr-DAY.json.gz ; also writes range
import json,gzip,sys,time
from blocks import day_range
from getlogs import logs,slim
day=sys.argv[1]; t=time.time()
S,E,A,B=day_range(day); print(day,A,B,B-A+1,flush=True)
U=[r['address'] for r in json.load(open('universe_raw.json'))[0]]
out=[]
for g in range(0,len(U),1000):
  r=logs({'address':U[g:g+1000],'topics':['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef']},A,B)
  out+=[slim(l) for l in r]; print(' group',g,len(r),round(time.time()-t),flush=True)
json.dump({'range':[S,E,A,B],'logs':out},gzip.open(f'tr-{day}.json.gz','wt'))
print('done',len(out),'secs',round(time.time()-t))
