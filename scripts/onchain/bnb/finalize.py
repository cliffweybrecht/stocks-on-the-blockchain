"""READY / NOT READY for the BNB row out/DAY.json from out/DAY.report.json."""
import json,sys,os
day=sys.argv[1]; r=json.load(open(f'out/{day}.json')); rep=json.load(open(f'out/{day}.report.json'))
FB=('dexscreener-h24-fallback','geckoterminal-h24-fallback')
reasons=[]
if rep['unresolved']: reasons.append(f"{len(rep['unresolved'])} pools unresolved: "+'; '.join(f"{u['pool']} {u.get('symbol')} ({u['reason']})" for u in rep['unresolved'][:10]))
ns=[x for x in rep.get('noSides',[]) if x.get('usd') is None or x.get('usd')]
if ns: reasons.append(f"{len(ns)} stock-moving pools with no token sides: "+', '.join(x['pool'] for x in ns[:10]))
fb=[p['pairAddress'] for a in r['assets'] for p in a['pools'] if p.get('source') in FB]
if fb: reasons.append(f"{len(fb)} rolling-24h fallback pools still in row")
if r.get('dexscreenerH24Fallbacks'): reasons.append('dexscreenerH24Fallbacks present')
sp=rep['spot']; g=sum(x['gecko'] for x in sp); o=sum(x['onchain'] for x in sp)
st={'chain':'bnb','day':day,'ready':not reasons,'reasons':reasons,'combined24hUsd':r['combined24hUsd'],'recounted':len(rep['recounted']),'added':len(rep['added']),'wash':len(rep['washExcluded']),'spotGeckoUsd':round(g,2),'spotOnchainUsd':round(o,2),'spotDiffPct':round(100*(o-g)/g,2) if g else None}
json.dump(st,open(f'out/{day}.status.json','w'),indent=1); print(json.dumps(st))
