import json,sys,gzip
from rpc import logs
from blocks import day_range
P='0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca'
for day in sys.argv[1:]:
  s,e,a,b=day_range(day)
  L=logs({'address':P,'topics':['0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67']},a,b,20000)
  json.dump([{'b':int(l['blockNumber'],16),'d':l['data']} for l in L],gzip.open(f'eth-{day}.json.gz','wt')); print(day,len(L),flush=True)
