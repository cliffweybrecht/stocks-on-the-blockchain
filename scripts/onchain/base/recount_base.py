#!/usr/bin/env python3
"""Base (8453) exact ET-day pool volumes from onchain logs.  python3 recount_base.py DAY -> vol-DAY.json
per pool: usd, swaps, pricing, tokens, owner(repo pool_owner rule), dex, liquidity, wash flag; plus unresolved list."""
import json,gzip,sys,collections,os
sys.path.insert(0,os.environ.get('REPO_SCRIPTS','../..')); from base_gecko_et import pool_owner
day=sys.argv[1]
NATIVE='0x'+'0'*40; WETH='0x4200000000000000000000000000000000000006'; CBBTC='0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf'; EURC='0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42'
STABLE={'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913','0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca','0x50c5725949a6f0c72e6c4a641f24049a917db0cb','0xfde4c96c8593536e31f229ea8f37b2ada2699bb2','0x820c137fa70c8691f0e44dc420a5e53c168921dc','0xb79dd08ea68a908a97220c76d19a6aa9cbde4376'}
VOLQ={WETH:WETH,NATIVE:WETH,'0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee':WETH,CBBTC:CBBTC,EURC:EURC}
V2='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'; SOLID='0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b'
V3S={'0x121cb44ee54098b1a04743c487e7460d8dd429b27f88b1f4d4767396e1a59f79','0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67','0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'}
SING={'0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f','0x04206ad2b7c0f463bff3dd4f33c5735b0f2957a351e4f79763a4fa9e775dd237','0x3e8aae37f890eb1f9d63dd4d2062f3f0be757848a0f0760e4f3e53dad556e861'}
TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
def s256(h):
  v=int(h,16); return v-(1<<256) if v>>255 else v
def W(d): d=d[2:]; return [d[i:i+64] for i in range(0,len(d),64)]
UNI=json.load(open('universe.json')); TOK={a:{'address':u['address'],'symbol':u['symbol'],'issuer':u['issuer'] or 'unknown','kind':{'private':'preipo'}.get(u['kind'] or 'equity',u['kind'] or 'equity')} for a,u in UNI.items()}
TR=json.load(gzip.open(f'tr-{day}.json.gz','rt')); S,E,A,B=TR['range']
LG=json.load(gzip.open(f'logs-{day}.json.gz','rt')) if os.path.exists(f'logs-{day}.json.gz') else {'pools42':[],'logs':[]}
SP=json.load(open('singleton_pools.json')) if os.path.exists('singleton_pools.json') else {}
KN=json.load(open('known_pools.json')); C=json.load(open('cp_class.json')); DEC=json.load(open('dec.json')); PX=json.load(open(f'px-{day}.json'))
CF=json.load(gzip.open(f'cflow-{day}.json.gz','rt')) if os.path.exists(f'cflow-{day}.json.gz') else {'pools':[],'logs':[]}
ONLY=set(json.load(open(sys.argv[2]))) if len(sys.argv)>2 else None   # optional: restrict to listed pools (row rechecks)
nb=B-A+1
def qpx(tok,b): return PX['px'][VOLQ[tok]][min(23,max(0,(b-A)*24//nb))]
by=collections.defaultdict(list)
for l in LG['logs']: by[l['a']].append(l)
SL=json.load(gzip.open(f'sing-{day}.json.gz','rt')) if os.path.exists(f'sing-{day}.json.gz') else []
for l in SL: by[l['t'][1]].append(l)
def pair(pool):
  if len(pool)==66:
    s=SP.get(pool); return (s['c0'],s['c1']) if s else None
  c=C.get(pool); return (c[0],c[1]) if c and c[0] and c[1] else None
def swaps(pool):
  sw=[]; other=collections.Counter()
  for l in by.get(pool,[]):
    t=l['t'][0]; w=W(l['d'])
    if t in (V2,SOLID) and len(pool)==42: i0,i1,o0,o1=(int(x,16) for x in w[:4]); sw.append((l['b'],abs(i0-o0),abs(i1-o1)))
    elif t in V3S and len(pool)==42: sw.append((l['b'],abs(s256(w[0])),abs(s256(w[1]))))
    elif t in SING and len(pool)==66: sw.append((l['b'],abs(s256(w[0])),abs(s256(w[1]))))
    else: other[t]+=1
  return sw,other
def leg_usd(tok,x,b):
  if tok in STABLE: return x
  if tok in VOLQ: return x*qpx(tok,b)
  return None
STD=V3S|{V2,SOLID}
ev=collections.defaultdict(set)
for l in LG['logs']: ev[l['a']].add(l['t'][0])
CPOOLS=set(CF['pools'])
POOLS=set(LG['pools42'])|{k for k in by if len(k)==66 and pair(k) and (pair(k)[0] in UNI or pair(k)[1] in UNI)}
if ONLY is not None: POOLS&=ONLY; CPOOLS&=ONLY
vw=collections.defaultdict(lambda:[0.0,0.0])
for pool in POOLS-CPOOLS:
  tk=pair(pool)
  if not tk or any(DEC.get(t) is None for t in tk): continue
  for b,r0,r1 in swaps(pool)[0]:
    x0=r0/10**DEC[tk[0]]; x1=r1/10**DEC[tk[1]]
    for (ta,xa),(tb,xb) in (((tk[0],x0),(tk[1],x1)),((tk[1],x1),(tk[0],x0))):
      if ta in UNI and xa>0:
        u=leg_usd(tb,xb,b)
        if u is not None: vw[ta][0]+=u; vw[ta][1]+=xa
PRICE={t:v[0]/v[1] for t,v in vw.items() if v[1]}
cflow=collections.defaultdict(lambda:collections.defaultdict(lambda:collections.defaultdict(int))); cblk={}; seen=set()
for l in CF['logs']:
  if (l['tx'],l['i']) in seen or l['t'][0]!=TRANSFER or len(l['t'])<3: continue
  seen.add((l['tx'],l['i'])); v=int(l['d'],16) if len(l['d'])>2 else 0; f='0x'+l['t'][1][-40:]; t='0x'+l['t'][2][-40:]
  for p,sg in ((t,1),(f,-1)):
    if p in CPOOLS: cflow[p][l['tx']][l['a']]+=sg*v; cblk[l['tx']]=l['b']
def ctoks(pool):
  tv=collections.Counter()
  for fl in cflow[pool].values():
    for t,v in fl.items(): tv[t]+=abs(v)
  return [t for t,_ in tv.most_common()]
def usd_of(pool):
  if pool in CPOOLS:
    tot=0.0;n=0
    for tx,fl in cflow[pool].items():
      fl={t:v for t,v in fl.items() if v}
      ins={t for t,v in fl.items() if v>0}; outs={t for t,v in fl.items() if v<0}
      if not ins or not outs: continue
      if any(DEC.get(t) is None for t in fl): return None,'transfer flow: decimals unreadable',0
      amt={t:abs(v)/10**DEC[t] for t,v in fl.items()}
      st=[t for t in amt if t in STABLE]; vq=[t for t in amt if t in VOLQ]; pr=[t for t in amt if t in PRICE]
      if st: u=max(amt[t] for t in st)
      elif vq: u=max(amt[t]*qpx(t,cblk[tx]) for t in vq)
      elif pr: u=max(amt[t]*PRICE[t] for t in pr)
      else: return None,'transfer flow: no USD path',0
      tot+=u;n+=1
    return tot,'per-tx net ERC20 Transfer flow of the pool',n
  tk=pair(pool); sw,other=swaps(pool)
  if not tk: return None,'no token pair',0
  if any(DEC.get(t) is None for t in tk): return None,'token decimals unreadable',0
  if not sw and other: return None,'no standard swap event; other: '+','.join(k[:10] for k in list(other)[:5]),0
  tot=0.0; how=set()
  for b,r0,r1 in sw:
    x0=r0/10**DEC[tk[0]]; x1=r1/10**DEC[tk[1]]
    if tk[0] in STABLE or tk[1] in STABLE: tot+=x0 if tk[0] in STABLE else x1; how.add('stable-side')
    elif tk[0] in VOLQ or tk[1] in VOLQ: tot+=x0*qpx(tk[0],b) if tk[0] in VOLQ else x1*qpx(tk[1],b); how.add('WETH/cbBTC/EURC side x hourly Uniswap v3 USDC-pool VWAP')
    elif tk[0] in PRICE or tk[1] in PRICE: tot+=x0*PRICE[tk[0]] if tk[0] in PRICE else x1*PRICE[tk[1]]; how.add('stock side x onchain day VWAP')
    else: return None,f'no USD price path for {tk}',0
  return tot,'+'.join(sorted(how)) or 'no swaps in ET day',len(sw)
out={'day':day,'blocks':[A,B],'pools':{},'unresolved':[],'notStock':0}
for pool in sorted(POOLS|CPOOLS):
  tk=list(pair(pool)) if pool not in CPOOLS else ctoks(pool)
  tracked=[t for t in tk if t in UNI]
  if not tracked: out['notStock']+=1; continue
  k=KN.get(pool) or {}
  meta={'baseToken':k.get('base') or '','quoteToken':k.get('quote') or '','holders':tracked}
  own=pool_owner(meta,TOK)
  v,how,n=usd_of(pool)
  rec={'tokens':tk[:4],'owner':own,'holders':tracked,'dex':k.get('dex') or (SP.get(pool,{}).get('dex')) or ('custom' if pool in CPOOLS else 'onchain-discovered'),'usd':None if v is None else round(v,2),'swaps':n,'pricing':how,'liq':k.get('reserveUsd'),'known':bool(k)}
  if v is None: out['unresolved'].append(dict(rec,pool=pool)); continue
  out['pools'][pool]=rec
json.dump(out,open(f'vol-{day}.json','w'),indent=1)
tot=sum(p['usd'] for p in out['pools'].values())
print(day,'pools',len(out['pools']),'usd',f"{tot:,.0f}",'unresolved',len(out['unresolved']),'notStock',out['notStock'])
