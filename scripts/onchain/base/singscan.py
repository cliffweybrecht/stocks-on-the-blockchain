import json,gzip,sys,time
from getlogs import logs,slim
day=sys.argv[1]; T=json.load(gzip.open(f'tr-{day}.json.gz','rt')) if len(sys.argv)<4 else None
A,B=(T['range'][2:] if T else (int(sys.argv[2]),int(sys.argv[3]))); t0=time.time()
MG=sys.argv[4].split(',') if len(sys.argv)>4 else ['0x498581ff718922c3f8e6a244956af099b2652b2b']
SING=['0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f','0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237','0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861']
L=logs({'address':MG,'topics':[SING]},A,B,step=1000)
ids={}
for l in L: ids.setdefault(l['topics'][1],l['address'].lower())
json.dump(ids,open(f'sids-{day}.json','w')); json.dump([slim(l) for l in L],gzip.open(f'sing-{day}.json.gz','wt')); print('swaplogs',len(L),'ids',len(ids),round(time.time()-t0))
