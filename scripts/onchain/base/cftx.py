"""tx hashes where a custom (non-standard) pool sent/received a stock token -> cftxDD.json"""
import json,gzip,sys
day=sys.argv[1]; P=set(json.load(open(f'nopair{day[-2:]}.json')))
tx=set()
for l in json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs']:
  if '0x'+l['t'][1][-40:] in P or '0x'+l['t'][2][-40:] in P: tx.add(l['tx'])
json.dump(sorted(tx),open(f'cftx{day[-2:]}.json','w')); print('custom-pool txs',len(tx))
