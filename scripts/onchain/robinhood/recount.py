#!/usr/bin/env python3
"""Recount fallback-pool day volume from onchain swap logs.

Usage: python3 recount.py DAY SNAPSHOT_JSON [--chain robinhood]
Inputs in cwd: logs-DAY.json.gz (fetchlogs.py), eth-DAY.json.gz (ethprice.py),
meta.json (gecko pool tokens), onchain_meta.json (tokens.py).
Writes out/DAY.json (row, same schema) and out/DAY.report.json.
"""
import json,gzip,sys,collections,statistics,copy,os
from datetime import datetime,timezone
day,snap=sys.argv[1],sys.argv[2]
NATIVE='0x'+'0'*40
WETH='0x0bd7d308f8e1639fab988df18a8011f41eacad73'
STABLES={'0x5fc5360d0400a0fd4f2af552add042d716f1d168','0x0453dcf836dc35da9f8523ea2bb928268f16f073','0x3ae0689f64b8a7683d06a9e358d7346dc5e71e18'}
STABLE_SYMS={'USDG','USDC','USDT','USDC.E','USDT0','DAI','PYUSD','USDE'}
T=dict(
 V2='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822',
 SOLID='0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b',
 V3='0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
 PCS3='0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83',
 V4='0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f',
 PCSINF='0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237')
SWAP_TOPICS=set(T.values())
V4_MANAGERS={'0xd01c774d4a66408326bc65728ac5ae5aaf004032':'orvex-v4','0x8366a39cc670b4001a1121b8f6a443a643e40951':'uniswap-v4','0xee04c68742e6bf434be8039580d2e89bbe55bc6f':'pancake-infinity-cl'}
def s256(h):
  v=int(h,16); return v-(1<<256) if v>=1<<255 else v
def words(d): d=d[2:]; return [d[i:i+64] for i in range(0,len(d),64)]

L=json.load(gzip.open(f'logs-{day}.json.gz','rt')); S,E,A,B=L['range']; logs=L['logs']
meta=json.load(open('meta.json')); oc=json.load(open('onchain_meta.json'))
dec=oc['dec']; sym={**{v[k]['address']:v[k]['symbol'] for v in meta.values() for k in('base','quote')},**{k:v for k,v in oc.get('sym',{}).items() if v}}
# block->timestamp: linear interpolation between range ends is not exact; use eth logs' blocks map below
eth=json.load(gzip.open(f'eth-{day}.json.gz','rt'))
# ETH/USD VWAP per block bucket (we only need ETH price; bucket by 1/24 of the block range ~ hourly)
nb=24; bw=(B-A+1)/nb; ev=[[0,0] for _ in range(nb)]
for x in eth:
  w=words(x['d']); a0=abs(s256(w[0]))/1e18; a1=abs(s256(w[1]))/1e6
  i=min(nb-1,int((x['b']-A)/bw)); ev[i][0]+=a1; ev[i][1]+=a0
dayeth=sum(v[0] for v in ev)/sum(v[1] for v in ev)
ethp=[(v[0]/v[1] if v[1] else dayeth) for v in ev]
def eth_at(b): return ethp[min(nb-1,max(0,int((b-A)/bw)))]

V4INIT=json.load(open('v4init.json')) if os.path.exists('v4init.json') else {}
def tokens_for(pool):
  if len(pool)==42:
    t=oc['pairs'].get(pool)
    if t and t[0] and t[1]: return t[0].lower(),t[1].lower()
  if pool in V4INIT: return tuple(V4INIT[pool])  # from PoolManager Initialize event
  m=meta.get(pool)
  if m:
    a,b=m['base']['address'],m['quote']['address']
    return tuple(sorted([a,b]))  # v4 / infinity currency0 < currency1
  return None
def is_stable(t): return t in STABLES or (sym.get(t) or '').upper() in STABLE_SYMS

by_addr=collections.defaultdict(list); by_id=collections.defaultdict(list)
for l in logs:
  by_addr[l['address'].lower()].append(l)
  if len(l['topics'])>1: by_id[l['topics'][1].lower()].append(l)

def swaps(pool):
  """-> (kind, [(block, raw0, raw1)], other_topics) ; raw amounts absolute"""
  out=[]; other=collections.Counter(); kind=None
  if len(pool)==42:
    for l in by_addr.get(pool,[]):
      t=l['topics'][0]; w=words(l['data']); b=int(l['blockNumber'],16)
      if t in (T['V2'],T['SOLID']):
        i0,i1,o0,o1=(int(x,16) for x in w[:4]); out.append((b,abs(i0-o0),abs(i1-o1))); kind='v2'
      elif t in (T['V3'],T['PCS3']):
        out.append((b,abs(s256(w[0])),abs(s256(w[1])))); kind='v3'
      else: other[t]+=1
  elif pool.startswith(EKCORE+'-'):
    if not os.path.exists(f'ekubo-{day}.json.gz'): return None,[],{'ekubo logs not fetched':1}
    return 'ekubo-core',EK.get(pool.split('-')[1],[]),other
  else:
    pid=pool.split('-')[-1]
    for l in by_id.get(pid,[]):
      t=l['topics'][0]; w=words(l['data']); b=int(l['blockNumber'],16)
      if t in (T['V4'],T['PCSINF']) and l['address'].lower() in V4_MANAGERS:
        out.append((b,abs(s256(w[0])),abs(s256(w[1])))); kind=V4_MANAGERS[l['address'].lower()]
      else: other[(l['address'].lower(),t)]+=1
  return kind,out,other

XF=json.load(gzip.open(f'xfer-{day}.json.gz','rt')) if os.path.exists(f'xfer-{day}.json.gz') else {'pools':[],'transfers':[]}
XPOOLS=set(XF['pools']); xflow=collections.defaultdict(lambda:collections.defaultdict(lambda:collections.defaultdict(int)))  # pool->tx->token->net in
xblock={}
for t in XF['transfers']:
  for pool,sg in ((t['to'],1),(t['from'],-1)):
    if pool in XPOOLS: xflow[pool][t['tx']][t['address']]+=sg*t['v']; xblock[t['tx']]=t['b']
from Crypto.Hash import keccak
from rpc import call as _call
V4EXIST=json.load(open('v4exist.json')) if os.path.exists('v4exist.json') else {}
def v4_exists(pid):
  if pid not in V4EXIST:
    h=keccak.new(digest_bits=256); h.update(bytes.fromhex(pid[2:])+(6).to_bytes(32,'big'))
    r=_call('eth_call',[{'to':'0x8366a39cc670b4001a1121b8f6a443a643e40951','data':'0x1e2eaeaf'+h.hexdigest()},'latest'])
    V4EXIST[pid]=int(r,16)!=0; json.dump(V4EXIST,open('v4exist.json','w'))
  return V4EXIST[pid]
def xfer_usd(pool):
  tot=0.0; n=0
  for tx,fl in xflow[pool].items():
    fl={t:v for t,v in fl.items() if v}
    if not fl: continue
    if any(dec.get(t) is None for t in fl): return None,'transfer method: token decimals unreadable',0
    amt={t:abs(v)/10**dec[t] for t,v in fl.items()}
    st=[t for t in amt if is_stable(t)]; we=[t for t in amt if t in (WETH,NATIVE)]; pr=[t for t in amt if t in price]
    if st: u=max(amt[t] for t in st)
    elif we: u=max(amt[t] for t in we)*eth_at(xblock[tx])
    elif pr: u=max(amt[t]*price[t] for t in pr)
    else: return None,'transfer method: no USD price path for '+','.join(str(sym.get(t)) for t in amt),0
    tot+=u; n+=1
  return tot,n

EKCORE='0x00000000000014aa86c5d3c41765bb24e11bd701'
EK=collections.defaultdict(list)
if os.path.exists(f'ekubo-{day}.json.gz'):
  for x in json.load(gzip.open(f'ekubo-{day}.json.gz','rt')):
    d=x['d'][2:]; bu=d[104:168]
    def _s(h):
      v=int(h,16); return v-(1<<128) if v>=1<<127 else v
    EK['0x'+d[40:104]].append((x['b'],abs(_s(bu[:32])),abs(_s(bu[32:]))))
SELF_EMIT_DEX={'metric'}  # pools that emit their own swap events (BinSwapped/Swap) from the pool address

rows=json.load(open(snap)); rec=[r for r in rows['records'] if r['date']==day][0]
FALLBACK=('dexscreener-h24-fallback','geckoterminal-h24-fallback')
# pass 1: per-token day VWAP from stable/ETH-quoted swaps in all pools we have logs for
tv=collections.defaultdict(lambda:[0.0,0.0])
allpools=[(a['address'].lower(),p) for a in rec['assets'] for p in a['pools']]+[(p['address'].lower(),p) for k in('excludedPools','noClosedDayData') for p in rec.get(k) or []]
decoded={}
DEXOF={p['pairAddress'].lower():p['dexId'] for _,p in allpools}
for _,p in allpools:
  pool=p['pairAddress'].lower()
  if pool in decoded: continue
  tk=tokens_for(pool); kind,sw,other=swaps(pool); decoded[pool]=(tk,kind,sw,other)
  if not tk or None in (dec.get(tk[0]),dec.get(tk[1])): continue
  for b,r0,r1 in sw:
    x0=r0/10**dec[tk[0]]; x1=r1/10**dec[tk[1]]
    for (ta,xa),(tb,xb) in (((tk[0],x0),(tk[1],x1)),((tk[1],x1),(tk[0],x0))):
      if is_stable(ta) or is_stable(tb): 
        if not is_stable(ta) and not is_stable(tb): pass
      if not is_stable(ta) and ta not in (WETH,NATIVE):
        usd = xb if is_stable(tb) else (xb*eth_at(b) if tb in (WETH,NATIVE) else None)
        if usd: tv[ta][0]+=usd; tv[ta][1]+=xa
price={t:v[0]/v[1] for t,v in tv.items() if v[1]>0}

NAMES=json.load(open('topicnames.json'))
NONSWAP=('Burn(','Collect(','Mint(','Sync(','Transfer(','Approval(','CollectFees(','CollectProtocol(','SwapFee(address','LiquidityRemoved(','LiquidityAdded(','Fee(uint16','FeeAdjustment(','BinAdditionalFees','IncreaseObservation','PauseLevelUpdated','Initialized(','Initialize(','BidAskRef','ModifyLiquidity(','ProtocolFeesCollected','CreatorFeeRecipient','FeesSwept','DepositedToBin','WithdrawnFromBin','ExcessTokens','SnipeTaxExempted','SetFees(','Donate(','Release(','ProtocolFeeUpdated(')
def nonswap(t):
  t=t[1] if isinstance(t,tuple) else t
  n=(NAMES.get(t) or [''])[0]
  return bool(n) and n.startswith(NONSWAP)
def usd_of(pool):
  tk,kind,sw,other=decoded[pool]
  if kind=='ekubo-core' and not sw: return 0.0,'no Ekubo core swap logs for pool id in ET day','ekubo-core',0
  if len(pool)==42 and not tk and not sw and not other and DEXOF.get(pool) in SELF_EMIT_DEX:
    return 0.0,'no logs from pool contract in ET day (pool emits its own swap events)','no-swaps',0
  if len(pool)==42 and not tk and not sw and other and all(nonswap(k) for k in other) and DEXOF.get(pool) in SELF_EMIT_DEX:
    return 0.0,'only non-swap events from pool contract in ET day','no-swaps',0
  if pool in XPOOLS:
    r=xfer_usd(pool)
    if r[0] is None: return None,r[1],'custom',0
    return r[0],'per-tx net ERC20 Transfer flow of the pool (stable side; else WETH x hourly VWAP; else stock x day VWAP)','custom-transfer-flow',r[1]
  if not sw and not other and len(pool)==66 and v4_exists(pool): return 0.0,'no Swap logs on Uniswap v4 PoolManager in ET day (pool exists)','uniswap-v4',0
  if not tk: return None,'no token pair (pool not resolvable onchain or on Gecko)',kind,0
  if None in (dec.get(tk[0]),dec.get(tk[1])): return None,'token decimals unreadable',kind,0
  if kind is None and other and all(nonswap(k) for k in other) and (len(pool)==42 and tk or len(pool)==66 and any(isinstance(k,tuple) and k[0] in V4_MANAGERS for k in other)):
    return 0.0,'only non-swap events (liquidity/fees) in ET day','no-swaps',0
  if kind is None and other: return None,'unsupported event(s): '+', '.join(str(k) for k in list(other)[:4]),kind,0
  if kind is None and not other and not (len(pool)==42 or (meta.get(pool,{}).get('dex','') in ('uniswap-v4-robinhood','pancakeswap-infinity-clmm-robinhood'))):
    return None,'no logs and pool type has no decoder (singleton/custom DEX)',kind,0
  tot=0.0; how=set()
  for b,r0,r1 in sw:
    x0=r0/10**dec[tk[0]]; x1=r1/10**dec[tk[1]]
    if is_stable(tk[0]) or is_stable(tk[1]): tot+= x0 if is_stable(tk[0]) else x1; how.add('stable-side')
    elif tk[0] in (WETH,NATIVE) or tk[1] in (WETH,NATIVE):
      tot+= (x0 if tk[0] in (WETH,NATIVE) else x1)*eth_at(b); how.add('weth-side x onchain WETH/USDG hourly VWAP')
    elif tk[0] in price or tk[1] in price:
      tot+= x0*price[tk[0]] if tk[0] in price else x1*price[tk[1]]; how.add('stock-side x onchain day VWAP')
    else: return None,f'no USD price path for {sym.get(tk[0])}/{sym.get(tk[1])}',kind,0
  return tot,'+'.join(sorted(how)) or 'no swaps',kind or ('v2/v3' if len(pool)==42 else 'v4'),len(sw)

new=copy.deepcopy(rec); rep={'day':day,'blocks':[A,B],'etDay':[S,E],'ethVwap':dayeth,'recounted':[],'unresolved':[],'spot':[],'washExcluded':[],'restored':[]}
newexcl=[]; unres=[]; old_excl={p['pairAddress'].lower():p for p in rec.get('excludedPools') or []}
for a in new['assets']:
  keep=[]
  for p in a['pools']:
    pool=p['pairAddress'].lower()
    if p['source']=='geckoterminal-hourly-et':
      v,how,kind,n=usd_of(pool)
      if v is not None and p['volume24hUsd']: rep['spot'].append({'pool':pool,'symbol':a['symbol'],'gecko':p['volume24hUsd'],'onchain':round(v,2),'diffPct':round(100*(v-p['volume24hUsd'])/p['volume24hUsd'],2),'swaps':n})
      keep.append(p); continue
    if p['source'] in FALLBACK:
      v,how,kind,n=usd_of(pool)
      if v is None:
        u={'address':a['address'],'pairAddress':p['pairAddress'],'dexId':p['dexId'],'symbol':a['symbol'],'oldFallbackUsd':p['volume24hUsd'],'oldSource':p['source'],'liquidityUsd':p.get('liquidityUsd'),'reason':how}
        rep['unresolved'].append(dict(u,pool=pool,oldUsd=p['volume24hUsd'])); unres.append(u); continue
      liq=p.get('liquidityUsd')
      q=dict(p,volume24hUsd=round(v,2),source='onchain-swap-logs-et',method='onchain',onchainPricing=how,swapCount=n)
      rep['recounted'].append({'pool':pool,'symbol':a['symbol'],'dexId':p['dexId'],'old':p['volume24hUsd'],'new':round(v,2),'swaps':n,'pricing':how})
      if liq and liq>0 and v>50*liq:
        e=dict(q,address=a['address'],symbol=a['symbol'],reason=f'wash: day volume {v/liq:.0f}x liquidity (> 50x)'); newexcl.append(e); rep['washExcluded'].append(e); continue
      keep.append(q); continue
    keep.append(p)
  a['pools']=keep
# re-test previously wash-excluded fallback pools with onchain volume
assets={a['address'].lower():a for a in new['assets']}
for pool,p in old_excl.items():
  if p['source'] not in FALLBACK: newexcl.append(p); continue
  v,how,kind,n=usd_of(pool)
  if v is None: newexcl.append(p); rep['unresolved'].append({'pool':pool,'symbol':p['symbol'],'dexId':p['dexId'],'oldUsd':0,'reason':'(already wash-excluded) '+how}); continue
  liq=p.get('liquidityUsd'); q={k:p[k] for k in('pairAddress','dexId','liquidityUsd')}; q.update(volume24hUsd=round(v,2),source='onchain-swap-logs-et',method='onchain',onchainPricing=how,swapCount=n)
  if liq and v>50*liq: newexcl.append(dict(p,volume24hUsd=round(v,2),source='onchain-swap-logs-et',method='onchain',reason=f'wash: day volume {v/liq:.0f}x liquidity (> 50x)'))
  else: assets[p['address'].lower()]['pools'].append(q); rep['restored'].append(dict(q,symbol=p['symbol']))
# noClosedDayData pools: verify zero onchain swaps inside the ET day
for p in rec.get('noClosedDayData') or []:
  v,how,kind,n=usd_of(p['pairAddress'].lower()); p['onchainDayUsd']=None if v is None else round(v,2)
  if v: rep['unresolved'].append({'pool':p['pairAddress'],'symbol':p['symbol'],'oldUsd':0,'reason':f'late-run excluded but onchain shows ${v:,.0f} in the ET day (left excluded)'})
new['unresolvedPools']=unres; new['unresolvedFallbackUsdNotCounted']=round(sum(u['oldFallbackUsd'] or 0 for u in unres),2)
new['excludedPools']=newexcl; new['excludedVolumeUsd']=round(sum(p.get('volume24hUsd') or 0 for p in newexcl),2)
lane={'equity':'publicEquity24hUsd','etf':'etfIndex24hUsd','private':'private24hUsd','preipo':'private24hUsd'}
cnt={'equity':'publicPoolCount','etf':'etfPoolCount','private':'preipoPoolCount','preipo':'preipoPoolCount'}
for k in set(lane.values())|set(cnt.values()): new[k]=0
for a in new['assets']:
  a['volume24hUsd']=round(sum(p['volume24hUsd'] or 0 for p in a['pools']),2)
  new[lane[a['instrumentKind']]]+=a['volume24hUsd']; new[cnt[a['instrumentKind']]]+=len(a['pools'])
for k in set(lane.values()): new[k]=round(new[k],2)
new['combined24hUsd']=round(new['publicEquity24hUsd']+new['etfIndex24hUsd']+new['private24hUsd'],2)
new['withVolumeEquityCount']=sum(1 for a in new['assets'] if a['instrumentKind']=='equity' and a['volume24hUsd'])
for i in new.get('issuers') or []:
  for k in set(lane.values())|{'combined24hUsd'}: i[k]=new[k]
nunres=len([u for u in rep['unresolved'] if u.get('oldUsd')])
new['volumeSource']='geckoterminal-hourly-et+onchain-swap-logs-et'
new['barMethod']='mixed-onchain'
new['onchainRecount']={'blocks':[A,B],'rpc':'https://rpc.mainnet.chain.robinhood.com','poolsRecounted':len(rep['recounted'])+len(rep['restored']),'unresolvedPools':len(rep['unresolved']),'unresolvedFallbackUsd':round(sum(u['oldUsd'] or 0 for u in rep['unresolved']),2),'ethUsdVwap':round(dayeth,2),
 'note':'Pools without GeckoTerminal hourly candles recounted from Swap event logs in the America/New_York day block range. USD = stable side; else WETH/ETH side x hourly VWAP of the onchain USDG/WETH 0.01% Uniswap v3 pool; else stock side x that stock token\'s onchain day VWAP from stable/WETH pairs. Wash rule (>50x liquidity) applied to recounted volume. Pools that cannot be recounted exactly are NOT counted (no rolling-24h fallback remains); they are listed in unresolvedPools with the reason and their old fallback value. Custom pools without a standard Swap event are valued by the per-transaction net ERC20 Transfer flow into/out of the pool in their swap transactions.',
 'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z')}
new['generatedAt']=new['onchainRecount']['generatedAt']
os.makedirs('out',exist_ok=True)
json.dump(new,open(f'out/{day}.json','w'),indent=1)
rep['old']=rec['combined24hUsd']; rep['new']=new['combined24hUsd']
rep['oldFallbackUsd']=sum(r['old'] or 0 for r in rep['recounted']); rep['newOnchainUsd']=sum(r['new'] for r in rep['recounted'])
json.dump(rep,open(f'out/{day}.report.json','w'),indent=1)
sp=rep['spot']; g=sum(x['gecko'] for x in sp); o=sum(x['onchain'] for x in sp)
print(f"{day} old={rec['combined24hUsd']:,.0f} new={new['combined24hUsd']:,.0f} recounted={len(rep['recounted'])} restored={len(rep['restored'])} wash={len(rep['washExcluded'])} fallback ${rep['oldFallbackUsd']:,.0f} -> onchain ${rep['newOnchainUsd']:,.0f}; unresolved={len(rep['unresolved'])} (${new['onchainRecount']['unresolvedFallbackUsd']:,.0f}); spot gecko={g:,.0f} onchain={o:,.0f} ({100*(o-g)/g if g else 0:+.2f}%) n={len(sp)}")
