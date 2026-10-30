import json,gzip,sys
from rpc import logs
from blocks import day_range
CORE='0x00000000000014aa86c5d3c41765bb24e11bd701'
for day in sys.argv[1:]:
  s,e,a,b=day_range(day)
  L=[l for l in logs({'address':CORE},a,b,50000) if not l['topics']]
  json.dump([{'b':int(l['blockNumber'],16),'tx':l['transactionHash'],'d':l['data']} for l in L],gzip.open(f'ekubo-{day}.json.gz','wt')); print(day,len(L),flush=True)
