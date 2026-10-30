"""Build the Base volume-snapshot row for DAY from vol-DAY.json (onchain recount) and decide READY / NOT READY.
Writes out/DAY.json (row) and out/DAY.status.json. Never uses DexScreener h24.
Usage: build_row.py DAY   (cwd = work dir; REPO_SCRIPTS, REPO_DATA env)"""
import json,copy,sys,os,gzip,datetime
S=os.environ['REPO_SCRIPTS']; D=os.environ['REPO_DATA']; sys.path.insert(0,S)
import base_gecko_et as bge
day=sys.argv[1]; os.makedirs('out',exist_ok=True)
recs=json.load(open(os.path.join(D,'volume-snapshots','base.json')))['records']
prior=[r for r in recs if r['date']<day]
tmpl=copy.deepcopy(prior[-1]); tmpl.pop('originalCombined24hUsd',None); tmpl['date']=day; tmpl['t']=bge.eastern_midnight(day)
for k in [k for k in tmpl if 'allback' in k or k.startswith('backfill') or k=='onchainRecount']: tmpl.pop(k,None)
desk=json.load(open('desk_rows.json')); known=json.load(open('universe.json'))
tokens=bge.index_tokens(desk,known,recs)
V=json.load(open(f'vol-{day}.json')); G=json.load(open(f'gres-{day}.json')) if os.path.exists(f'gres-{day}.json') else {}
A,B=V['blocks']
# unresolved pools: $0 only when provably no swap in the day (0 Swap logs and no stock Transfer touching the pool)
trp=set()
for l in json.load(gzip.open(f'tr-{day}.json.gz','rt'))['logs']: trp.add('0x'+l['t'][1][-40:]); trp.add('0x'+l['t'][2][-40:])
zero_pools=[u for u in V['unresolved'] if u['swaps']==0 and (len(u['pool'])==66 or u['pool'] not in trp)]
block_pools=[u for u in V['unresolved'] if u not in zero_pools]
LO=json.load(open(f'leftover-{day}.json')) if os.path.exists(f'leftover-{day}.json') else {'zero':[],'blocking':[]}
pools={};candles={};liq={};wash=[];noowner=[]
ts=bge.eastern_midnight(day)
for k,v in V['pools'].items():
  key=k.lower(); g=G.get(key); r=g['res'] if g else None
  if r and v['usd']>50*r: wash.append({'pool':key,'usd':round(v['usd'],2),'reserveUsd':round(r,2)}); continue
  o=v['owner'].lower()
  if o not in tokens: noowner.append(key); continue
  other=[t.lower() for t in v['tokens'] if t.lower()!=o]
  pools[key]={'pairAddress':key,'dexId':v.get('dex') or 'unknown','baseToken':o,'quoteToken':other[0] if other else '','holders':[h.lower() for h in v['holders']],'listedOnDex':bool(v.get('known'))}
  candles[key]=[[ts,0,0,0,0,v['usd']]]
  if r is not None: liq[key]=r
f=bge.fold_day(tokens,pools,candles,day,{},liq)
bge.apply_folded_record(tmpl,tokens,f,backfill=False)
r=tmpl
for k in ['publicMintCount','etfMintCount','preipoMintCount','uncheckedMintCount','originalCombined24hUsd','dayKeySource']: r[k]=None
for i in r.get('issuers') or []:
  for k in ['publicMintCount','preipoMintCount','etfMintCount']: i[k]=None
for a in r['assets']:
  v=[q['liquidityUsd'] for q in a['pools'] if q.get('liquidityUsd') is not None]
  a['displayedLiquidityUsd']=round(sum(v),2) if v else None
r['generatedAt']=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
r['method']=(f"ET-day volume for {day} (00:00:00-23:59:59 America/New_York, Base blocks {A}-{B}), recounted onchain: "
 "every pool's Swap logs (Uniswap/Aerodrome v2, Solidly, v3, Algebra, Pancake v3, Uniswap v4 and Pancake Infinity singletons) "
 "plus per-transaction net ERC20 flow for non-standard pools; USD from the stable side, WETH/cbBTC/EURC at hourly Uniswap v3 USDC-pool VWAP, else the stock's onchain day VWAP; "
 "a pool on two tracked tokens counts once on the base token; pools with volume above 50x GeckoTerminal reserve_in_usd are excluded as wash; "
 "no fallback pools; mint counts not recomputed (null); date is the America/New_York calendar day")
s=r.setdefault('sources',{}); s.pop('universeDexScreenerSearch',None); s['discoveredFrom']=None
s['volume']=(f"Base RPC Swap logs and ERC20 Transfer logs summed over the America/New_York day (blocks {A}-{B}), priced as in method; "
 "pool universe from the repo Base token list plus onchain discovery")
s['liquidity']="GeckoTerminal reserve_in_usd per pool read after the close; displayedLiquidityUsd sums reported pool liquidity; missing is null"
r['notes']=[f"Onchain recount of {day} (GitHub Actions); {len(wash)} pools over 50x reserve excluded as wash; {len(LO['zero'])} singleton hop ids with only dust stock flow and {len(zero_pools)} zero-swap pools contribute $0"]
r['onchainRecount']={'blocks':[A,B],'pools':len(pools),'unresolved':len(block_pools)+len(LO['blocking']),'washExcluded':wash,'washRule':'pool volume > 50x GeckoTerminal reserve_in_usd excluded','poolsWithoutReserve':sum(1 for k in V['pools'] if k.lower() not in G)}
reasons=[]
if block_pools: reasons.append(f"{len(block_pools)} pools unresolved with swaps: "+'; '.join(f"{u['pool']} ({u['pricing']}, {u['swaps']} swaps)" for u in block_pools[:10]))
if LO['blocking']: reasons.append(f"{len(LO['blocking'])} singleton ids without token pair moved non-dust stock: "+', '.join(x['id'] for x in LO['blocking'][:10]))
if noowner: reasons.append(f"{len(noowner)} pools whose owner token is not in the universe")
if f['fallbacks']: reasons.append(f"{len(f['fallbacks'])} fallback pools")
if 'dexscreener' in json.dumps({k:r.get(k) for k in ('method','sources','notes')}).lower(): reasons.append('DexScreener text in method/sources')
json.dump(r,open(f'out/{day}.json','w'),indent=1)
st={'chain':'base','day':day,'ready':not reasons,'reasons':reasons,'combined24hUsd':r['combined24hUsd'],'equity':f['equity'],'etf':f['etf'],'private':f['private'],'pools':len(pools),'wash':len(wash),'zeroPools':len(zero_pools),'zeroLeftoverIds':len(LO['zero'])}
json.dump(st,open(f'out/{day}.status.json','w'),indent=1); print(json.dumps(st))
