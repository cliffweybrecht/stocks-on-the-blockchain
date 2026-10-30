"""singleton ids with no poolKey whose swap txs moved a tracked stock token -> unres_idsDD.json"""
import json,gzip,sys
day=sys.argv[1]; SP=json.load(open('singleton_pools.json'))
trtx={l['tx'] for l in json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs']}
need={}
for l in json.load(gzip.open(f'sing-{day}.json.gz','rt')):
  pid=l['t'][1]
  if pid not in SP and l['tx'] in trtx: need[pid]=l['a']
json.dump(sorted(need),open(f'unres_ids{day[-2:]}.json','w')); print('unresolved stock-touching singleton ids',len(need))
