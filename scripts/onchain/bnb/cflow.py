import json,gzip,sys,time
from getlogs import logs,slim
day=sys.argv[1]; T=json.load(gzip.open(f'tr-{day}.json.gz','rt')); A,B=T['range'][2:]
P=json.load(open(f'nopair{day[-2:]}.json')); TOP='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
pt=['0x'+'0'*24+p[2:] for p in P]; t0=time.time()
L=logs({'topics':[TOP,pt]},A,B)+logs({'topics':[TOP,None,pt]},A,B)
L=[slim(l) for l in L]
json.dump({'pools':P,'logs':L},gzip.open(f'cflow-{day}.json.gz','wt')); print('cflow',len(L),round(time.time()-t0))
