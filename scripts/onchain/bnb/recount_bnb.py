#!/usr/bin/env python3
"""BNB Chain (56) exact ET-day volume recount.  python3 recount_bnb.py DAY SNAPSHOT_JSON
Inputs: tr-DAY (stock Transfer logs), logs-DAY (pool logs), px-DAY (hourly ref prices), cflow-DAY (custom pool transfers),
cp_class.json, known_pools.json, singleton_pools.json, dec.json, universe_raw.json. Writes out/DAY.json + out/DAY.report.json"""
import json,gzip,sys,collections,copy,os
from datetime import datetime,timezone
day,snap=sys.argv[1],sys.argv[2]
NATIVE='0x'+'0'*40; WBNB='0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'; BTCB='0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c'; ETH='0x2170ed0880ac9a755fd29b2688956bd959f933f8'
STABLE={'0x55d398326f99059ff775485246999027b3197955','0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d','0xe9e7cea3dedca5984780bafc599bd69add087d56','0xc5f0f7b66764f6ec8c8dff7ba683102295e16409','0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3','0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d'}
VOLQ={WBNB:WBNB,NATIVE:WBNB,'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee':WBNB,BTCB:BTCB,ETH:ETH}
QUOTES=STABLE|set(VOLQ)   # repo BNB_QUOTE_ASSETS
V2='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'; SOLID='0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b'
V3S={'0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67','0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'}
SING={'0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f','0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237','0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861'}
TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
def s256(h):
  v=int(h,16); return v-(1<<256) if v>=1<<255 else v
def W(d): d=d[2:]; return [d[i:i+64] for i in range(0,len(d),64)]
UNI={u['address'].lower():u for u in json.load(open('universe_raw.json'))[0]}
TR=json.load(gzip.open(f'tr-{day}.json.gz','rt')); S,E,A,B=TR['range']
LG=json.load(gzip.open(f'logs-{day}.json.gz','rt'))
if os.path.exists(f'sing-{day}.json.gz'):   # full-day singleton Swap scan (all ids) -> keep stock pools
  _SP=json.load(open('singleton_pools.json')); _U={u['address'].lower() for u in json.load(open('universe_raw.json'))[0]}
  _seen={(l['tx'],l['i']) for l in LG['logs']}; _ids=set(LG['ids'])
  for l in json.load(gzip.open(f'sing-{day}.json.gz','rt')):
    s=_SP.get(l['t'][1])
    if s and (s['c0'] in _U or s['c1'] in _U):
      _ids.add(l['t'][1])
      if (l['tx'],l['i']) not in _seen: LG['logs'].append(l); _seen.add((l['tx'],l['i']))
  LG['ids']=sorted(_ids)
PX=json.load(open(f"px-{day}.json"))
C=json.load(open('cp_class.json')); KN=json.load(open('known_pools.json'))
SP={k:v for k,v in json.load(open('singleton_pools.json')).items() if k.startswith('0x')}
DEC=json.load(open('dec.json'))
CF=json.load(gzip.open(f'cflow-{day}.json.gz','rt')) if os.path.exists(f'cflow-{day}.json.gz') else {'pools':[],'logs':[]}
def qpx(tok,b):
  t=VOLQ[tok]; bl=PX['blocks']; p=PX['px'][t]
  for i in range(len(bl)-1):
    if b<=bl[i+1]: f=(b-bl[i])/max(1,bl[i+1]-bl[i]); return p[i]+(p[i+1]-p[i])*max(0,min(1,f))
  return p[-1]
def pair(pool):
  if len(pool)==66:
    s=SP.get(pool); return (s['c0'],s['c1']) if s else None
  c=C.get(pool); return (c[0],c[1]) if c and c[0] and c[1] else None
by=collections.defaultdict(list)
for l in LG['logs']:
  key=l['t'][1] if l['t'][0] in SING and len(l['t'])>1 else l['a']
  by[key].append(l)
def swaps(pool):
  sw=[]; other=collections.Counter()
  for l in by.get(pool,[]):
    t=l['t'][0]; w=W(l['d'])
    if t in (V2,SOLID) and len(pool)==42: i0,i1,o0,o1=(int(x,16) for x in w[:4]); sw.append((l['b'],abs(i0-o0),abs(i1-o1),l['tx']))
    elif t in V3S and len(pool)==42: sw.append((l['b'],abs(s256(w[0])),abs(s256(w[1])),l['tx']))
    elif t in SING and len(pool)==66:
      a0=int(w[0],16); a1=int(w[1],16)
      a0=a0-(1<<256) if a0>>255 else a0; a1=a1-(1<<256) if a1>>255 else a1
      sw.append((l['b'],abs(a0),abs(a1),l['tx']))
    else: other[t]+=1
  return sw,other
# stock day VWAP from stable/volatile-quoted swaps (for stock-stock pools)
vw=collections.defaultdict(lambda:[0.0,0.0])
def leg_usd(tok,x,b):
  if tok in STABLE: return x
  if tok in VOLQ: return x*qpx(tok,b)
  return None
POOLS=set(LG['pools42'])|set(LG['ids'])
for pool in POOLS:
  tk=pair(pool)
  if not tk or any(DEC.get(t) is None for t in tk): continue
  for b,r0,r1,_ in swaps(pool)[0]:
    x0=r0/10**DEC[tk[0]]; x1=r1/10**DEC[tk[1]]
    for (ta,xa),(tb,xb) in (((tk[0],x0),(tk[1],x1)),((tk[1],x1),(tk[0],x0))):
      if ta in UNI and xa>0:
        u=leg_usd(tb,xb,b)
        if u is not None: vw[ta][0]+=u; vw[ta][1]+=xa
PRICE={t:v[0]/v[1] for t,v in vw.items() if v[1]}
# custom-pool transfer flow
cflow=collections.defaultdict(lambda:collections.defaultdict(lambda:collections.defaultdict(int))); cblk={}
CPOOLS=set(CF['pools'])
seen=set()
for l in CF['logs']:
  if (l['tx'],l['i']) in seen: continue
  seen.add((l['tx'],l['i']))
  if l['t'][0]!=TRANSFER or len(l['t'])<3: continue
  v=int(l['d'],16) if len(l['d'])>2 else 0; f='0x'+l['t'][1][-40:]; t='0x'+l['t'][2][-40:]
  for p,sg in ((t,1),(f,-1)):
    if p in CPOOLS: cflow[p][l['tx']][l['a']]+=sg*v; cblk[l['tx']]=l['b']
def csides(pool):
  tv=collections.Counter()
  for fl in cflow[pool].values():
    for t,v in fl.items(): tv[t]+=abs(v)
  st=[t for t,_ in tv.most_common() if t in UNI]; q=[t for t,_ in tv.most_common() if t in QUOTES]
  if st and q: return (st[0],q[0])
  if len(st)>1: return (st[0],st[1])
  o=[t for t,_ in tv.most_common() if t not in UNI and t!=pool]
  return (st[0],o[0]) if st and o else None   # stock vs non-quote token -> meme rule decides
def owner(pool,tk,rowowner=None):
  """repo attribute_pool: cash-quote pools count on the stock side; stock-vs-stock once on the base; meme pairs excluded"""
  if rowowner: return rowowner
  a,b=tk
  if a in UNI and b in QUOTES: return a
  if b in UNI and a in QUOTES: return b
  if a in UNI and b in UNI: return a   # base unknown for pools no indexer lists: token0
  return None
def usd_of(pool):
  """-> (usd|None, how, nswaps)"""
  if pool in CPOOLS:
    tot=0.0;n=0
    for tx,fl in cflow[pool].items():
      fl={t:v for t,v in fl.items() if v}
      if len(fl)<2: continue
      if any(DEC.get(t) is None for t in fl): return None,'transfer flow: decimals unreadable',0
      ins={t for t,v in fl.items() if v>0}; outs={t for t,v in fl.items() if v<0}
      if not ins or not outs: continue   # liquidity add/remove or one-sided move, not a swap
      amt={t:abs(v)/10**DEC[t] for t,v in fl.items()}
      st=[t for t in amt if t in STABLE]; vq=[t for t in amt if t in VOLQ]; pr=[t for t in amt if t in PRICE]
      if st: u=max(amt[t] for t in st)
      elif vq: u=max(amt[t]*qpx(t,cblk[tx]) for t in vq)
      elif pr: u=max(amt[t]*PRICE[t] for t in pr)
      else: return None,'transfer flow: no USD path',0
      tot+=u;n+=1
    return tot,'per-tx net ERC20 Transfer flow of the pool (stable side; else BNB/BTCB/ETH x hourly PancakeSwap v3 USDT price; else stock x day VWAP)',n
  tk=pair(pool); sw,other=swaps(pool)
  if not tk: return None,'no token pair (not token0/token1 contract, no Initialize event found)',0
  if any(DEC.get(t) is None for t in tk): return None,'token decimals unreadable',0
  if not sw and other: return None,'no standard swap event; other events: '+','.join(k[:10] for k in list(other)[:5]),0
  tot=0.0; how=set()
  for b,r0,r1,_ in sw:
    x0=r0/10**DEC[tk[0]]; x1=r1/10**DEC[tk[1]]
    if tk[0] in STABLE or tk[1] in STABLE: tot+=x0 if tk[0] in STABLE else x1; how.add('stable-side')
    elif tk[0] in VOLQ or tk[1] in VOLQ: tot+=(x0*qpx(tk[0],b) if tk[0] in VOLQ else x1*qpx(tk[1],b)); how.add('BNB/BTCB/ETH side x hourly PancakeSwap v3 USDT price')
    elif tk[0] in PRICE or tk[1] in PRICE: tot+=x0*PRICE[tk[0]] if tk[0] in PRICE else x1*PRICE[tk[1]]; how.add('stock side x onchain day VWAP')
    else: return None,f'no USD price path for {tk}',0
  return tot,'+'.join(sorted(how)) or 'no swaps in ET day',len(sw)
traded=set()
for l in TR['logs']: traded.add('0x'+l['t'][1][-40:]); traded.add('0x'+l['t'][2][-40:])
def pool_value(pool):
  """exact zero when a v2/v3-style pool moved no stock token in the ET day, or singleton id has no Swap log"""
  if len(pool)==42 and pool not in traded and pool not in CPOOLS: return 0.0,'no stock-token Transfer to/from pool in ET day',0
  if len(pool)==66 and pool not in by: return (0.0,'no Swap log for pool id in ET day',0) if pool in SP or pool in LG['ids'] else (None,'pool id not found',0)
  return usd_of(pool)
rows=json.load(open(snap)); rec=[r for r in rows['records'] if r['date']==day][0]
FB=('dexscreener-h24-fallback','geckoterminal-h24-fallback')
new=copy.deepcopy(rec); rep={'day':day,'blocks':[A,B],'recounted':[],'added':[],'unresolved':[],'spot':[],'washExcluded':[],'restored':[],'excludedMeme':0}
assets={a['address'].lower():a for a in new['assets']}; inrow={}
for a in new['assets']:
  for p in a['pools']: inrow[p['pairAddress'].lower()]=a['address'].lower()
old_excl={p['pairAddress'].lower():p for p in rec.get('excludedPools') or []}
ncd={p['pairAddress'].lower():p for p in rec.get('noClosedDayData') or []}
newexcl=[]; unres=[]
def wash(v,liq): return liq and liq>0 and v>50*liq
for a in new['assets']:
  keep=[]
  for p in a['pools']:
    pool=p['pairAddress'].lower()
    if p['source']=='geckoterminal-hourly-et':
      v,how,n=pool_value(pool)
      if v is not None and p['volume24hUsd']: rep['spot'].append({'pool':pool,'symbol':a['symbol'],'gecko':p['volume24hUsd'],'onchain':round(v,2),'diffPct':round(100*(v-p['volume24hUsd'])/p['volume24hUsd'],2),'swaps':n})
      keep.append(p); continue
    v,how,n=pool_value(pool)
    if v is None:
      u={'address':a['address'],'pairAddress':p['pairAddress'],'dexId':p['dexId'],'symbol':a['symbol'],'oldFallbackUsd':p['volume24hUsd'],'oldSource':p['source'],'reason':how}
      rep['unresolved'].append(dict(u,pool=pool,oldUsd=p['volume24hUsd'])); unres.append(u); continue
    q=dict(p,volume24hUsd=round(v,2),source='onchain-swap-logs-et',method='onchain',onchainPricing=how,swapCount=n)
    rep['recounted'].append({'pool':pool,'symbol':a['symbol'],'dexId':p['dexId'],'old':p['volume24hUsd'],'new':round(v,2),'swaps':n,'pricing':how})
    if wash(v,p.get('liquidityUsd')):
      e=dict(q,address=a['address'],symbol=a['symbol'],reason=f"wash: day volume {v/p['liquidityUsd']:.0f}x liquidity (> 50x)"); newexcl.append(e); rep['washExcluded'].append(e); continue
    keep.append(q)
  a['pools']=keep
# previously wash-excluded fallback pools
for pool,p in old_excl.items():
  if p['source'] not in FB: newexcl.append(p); continue
  v,how,n=pool_value(pool)
  if v is None: newexcl.append(p); rep['unresolved'].append({'pool':pool,'symbol':p['symbol'],'oldUsd':0,'reason':'(already wash-excluded) '+how}); continue
  q={k:p[k] for k in('pairAddress','dexId','liquidityUsd')}; q.update(volume24hUsd=round(v,2),source='onchain-swap-logs-et',method='onchain',onchainPricing=how,swapCount=n)
  if wash(v,p.get('liquidityUsd')): newexcl.append(dict(p,**q,reason=f"wash: day volume {v/p['liquidityUsd']:.0f}x liquidity (> 50x)"))
  else: assets.setdefault(p['address'].lower(),None); 
  if not wash(v,p.get('liquidityUsd')):
    if assets.get(p['address'].lower()) is None: rep['unresolved'].append({'pool':pool,'symbol':p['symbol'],'oldUsd':0,'reason':'restored pool asset missing from row'}); continue
    assets[p['address'].lower()]['pools'].append(q); rep['restored'].append(dict(q,symbol=p['symbol']))
  inrow[pool]=p['address'].lower()
for pool,p in ncd.items():
  v,how,n=pool_value(pool); p['onchainDayUsd']=None if v is None else round(v,2); inrow[pool]=p['address'].lower()
  if v: rep['unresolved'].append({'pool':pool,'symbol':p['symbol'],'oldUsd':0,'reason':f'late-run excluded but onchain ${v:,.0f} in ET day (left excluded)'})
# pools not in the row that moved a stock token in the ET day (budget-skipped / undiscovered)
liqmiss=[]
for pool in sorted(POOLS|CPOOLS):
  if pool in inrow or pool in old_excl: continue
  tk=pair(pool) if pool not in CPOOLS else csides(pool)
  own=owner(pool,tk) if tk else None
  if not tk:
    v,how,n=pool_value(pool); rep.setdefault('noSides',[]).append({'pool':pool,'usd':v,'swaps':n,'how':how}); print('NOSIDES',pool,v,n,how); continue
  if tk and own is None and not any(t in UNI for t in tk): continue   # not a tokenized-stock pool at all
  if tk and own is None:
    v,how,n=pool_value(pool); rep['excludedMeme']+=1
    rep.setdefault('memePools',[]).append({'pool':pool,'tokens':list(tk),'stock':[(UNI[t]['symbol']) for t in tk if t in UNI],'usd':v,'swaps':n}); continue
  v,how,n=pool_value(pool)
  if v is None:
    rep['unresolved'].append({'pool':pool,'symbol':(UNI.get(own) or {}).get('symbol'),'oldUsd':0,'reason':'not in row; '+how}); continue
  if not v: continue
  if own not in assets:
    u=UNI[own]; assets[own]={'address':u['address'],'symbol':u['symbol'],'instrumentKind':{'preipo':'private'}.get(u['kind'],u['kind']),'volume24hUsd':None,'displayedLiquidityUsd':None,'pools':[],'issuer':u['issuer'],'poolCount':0,'addedByOnchainRecount':True}
    new['assets'].append(assets[own])
  q={'pairAddress':pool,'dexId':KN.get(pool) or (SP.get(pool,{}).get('dex')) or 'onchain-discovered','volume24hUsd':round(v,2),'liquidityUsd':None,'source':'onchain-swap-logs-et','method':'onchain','onchainPricing':how,'swapCount':n,'discoveredOnchain':True}
  assets[own]['pools'].append(q); rep['added'].append({'pool':pool,'symbol':assets[own]['symbol'],'new':round(v,2),'swaps':n,'pricing':how})
new['unresolvedPools']=unres; new['unresolvedFallbackUsdNotCounted']=round(sum(u['oldFallbackUsd'] or 0 for u in unres),2)
new['excludedPools']=newexcl; new['excludedVolumeUsd']=round(sum(p.get('volume24hUsd') or 0 for p in newexcl),2)
lane={'equity':'publicEquity24hUsd','etf':'etfIndex24hUsd','private':'private24hUsd'}; cnt={'equity':'publicPoolCount','etf':'etfPoolCount','private':'preipoPoolCount'}
for k in list(lane.values())+list(cnt.values()): new[k]=0
for a in new['assets']:
  a['volume24hUsd']=round(sum(p['volume24hUsd'] or 0 for p in a['pools']),2) if a['pools'] else a.get('volume24hUsd'); a['poolCount']=len(a['pools'])
  new[lane[a['instrumentKind']]]+=a['volume24hUsd'] or 0; new[cnt[a['instrumentKind']]]+=len(a['pools'])
for k in lane.values(): new[k]=round(new[k],2)
new['combined24hUsd']=round(sum(new[k] for k in lane.values()),2)
new['withVolumeEquityCount']=sum(1 for a in new['assets'] if a['instrumentKind']=='equity' and a['volume24hUsd'])
for ln,iss in (new.get('issuersByLane') or {}).items():
  for name,cell in iss.items():
    m=[a for a in new['assets'] if a['instrumentKind']==ln and (a.get('issuer') or '').lower()==name]
    vs=[a['volume24hUsd'] for a in m if a['volume24hUsd'] is not None]
    cell['usd']=round(sum(vs),2) if vs else None; cell['pools']=sum(len(a['pools']) for a in m)
new['volumeSource']='geckoterminal-hourly-et+onchain-swap-logs-et'; new['barMethod']='mixed-onchain'
new['onchainRecount']={'blocks':[A,B],'rpc':('BSC_RPC_URL archive' if os.environ.get('BSC_RPC_URL') else 'bsc-rpc.publicnode.com'),'poolsRecounted':len(rep['recounted']),'poolsAdded':len(rep['added']),'unresolvedPools':len(rep['unresolved']),
 'note':'Every pool without GeckoTerminal hourly candles is recounted from Swap event logs in the America/New_York day block range; pools that moved a tokenized-stock Transfer in the day but were missing from the row (Gecko time budget / indexer caps) are added. USD = stable side; else WBNB/BNB/BTCB/ETH side x hourly-interpolated PancakeSwap v3 USDT pool price; else stock side x onchain day VWAP. Repo attribution rule kept (cash-quote pools count on the stock; stock-vs-stock once; meme pairs excluded). Wash rule (>50x liquidity) applied where liquidity is known. No rolling-24h fallback remains; pools that cannot be recounted are listed in unresolvedPools and not counted.',
 'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}
os.makedirs('out',exist_ok=True); json.dump(new,open(f'out/{day}.json','w'),indent=1)
rep['old']=rec['combined24hUsd']; rep['new']=new['combined24hUsd']
json.dump(rep,open(f'out/{day}.report.json','w'),indent=1)
sp=rep['spot']; g=sum(x['gecko'] for x in sp); o=sum(x['onchain'] for x in sp)
print(f"{day} old={rec['combined24hUsd']:,.0f} new={new['combined24hUsd']:,.0f} recounted={len(rep['recounted'])} (${sum(r['old'] or 0 for r in rep['recounted']):,.0f}->${sum(r['new'] for r in rep['recounted']):,.0f}) added={len(rep['added'])} (${sum(r['new'] for r in rep['added']):,.0f}) wash={len(rep['washExcluded'])} unresolved={len(rep['unresolved'])} (${sum(u['oldUsd'] or 0 for u in rep['unresolved']):,.0f}) spot gecko={g:,.0f} onchain={o:,.0f} ({100*(o-g)/g if g else 0:+.2f}%) n={len(sp)}")
