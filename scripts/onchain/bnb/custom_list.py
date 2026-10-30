import json,gzip,sys,collections
day=sys.argv[1]; C=json.load(open('cp_class.json')); L=json.load(gzip.open(f'logs-{day}.json.gz','rt'))
STD={'0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822','0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b','0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67','0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'}
ev=collections.defaultdict(set)
for l in L['logs']: ev[l['a']].add(l['t'][0])
bad=[p for p in L['pools42'] if not (C.get(p) and C[p][0] and C[p][1]) or (ev.get(p) and not ev[p]&STD)]
json.dump(bad,open(f'nopair{day[-2:]}.json','w')); print('custom',len(bad))
