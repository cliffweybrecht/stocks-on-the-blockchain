"""READY / NOT READY for the Robinhood row out/DAY.json from out/DAY.report.json."""
import json,sys
day=sys.argv[1]; r=json.load(open(f'out/{day}.json')); rep=json.load(open(f'out/{day}.report.json'))
FB=('dexscreener-h24-fallback','geckoterminal-h24-fallback')
reasons=[]
if rep['unresolved']: reasons.append(f"{len(rep['unresolved'])} pools unresolved: "+'; '.join(f"{u['pool']} {u.get('symbol')} ({u['reason']})" for u in rep['unresolved'][:10]))
fb=[p['pairAddress'] for a in r['assets'] for p in a['pools'] if p.get('source') in FB]
if fb: reasons.append(f"{len(fb)} rolling-24h fallback pools still in row")
if r.get('dexscreenerH24Fallbacks'): reasons.append('dexscreenerH24Fallbacks present')
sp=rep['spot']; g=sum(x['gecko'] for x in sp); o=sum(x['onchain'] for x in sp)
st={'chain':'robinhood','day':day,'ready':not reasons,'reasons':reasons,'combined24hUsd':r['combined24hUsd'],'recounted':len(rep['recounted']),'wash':len(rep['washExcluded']),'spotGeckoUsd':round(g,2),'spotOnchainUsd':round(o,2),'spotDiffPct':round(100*(o-g)/g,2) if g else None}
json.dump(st,open(f'out/{day}.status.json','w'),indent=1); print(json.dumps(st))
