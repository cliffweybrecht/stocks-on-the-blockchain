import json,os
from rpc import call
pools=json.load(open('allpools2.json')); meta=json.load(open('meta.json'))
oc=json.load(open('onchain_meta.json')) if os.path.exists('onchain_meta.json') else {'pairs':{},'dec':{}}
def ec(to,data):
  try: return call('eth_call',[{'to':to,'data':data},'latest'],tries=3)
  except Exception: return None
from concurrent.futures import ThreadPoolExecutor
def pair(p):
    t0=ec(p,'0x0dfe1681'); t1=ec(p,'0xd21220a7')
    return p,['0x'+t0[-40:] if t0 and len(t0)>=66 else None,'0x'+t1[-40:] if t1 and len(t1)>=66 else None]
with ThreadPoolExecutor(16) as ex:
  for p,v in ex.map(pair,[p for p in pools if len(p)==42 and p not in oc['pairs']]): oc['pairs'][p]=v
toks=set(x for v in oc['pairs'].values() for x in v if x)|set(v[k]['address'] for v in meta.values() for k in('base','quote'))
oc.setdefault('sym',{})
def tk(t):
  if t==NATIVE: return t,18,'ETH'
  r=ec(t,'0x313ce567'); d=int(r,16) if r and len(r)>2 else None
  s=ec(t,'0x95d89b41'); n=None
  try:
    b=bytes.fromhex(s[2:]); n=b[64:64+int(b[32:64].hex(),16)].decode() if len(b)>=96 else b.rstrip(b'\0').decode()
  except Exception: pass
  return t,d,n
NATIVE='0x'+'0'*40
with ThreadPoolExecutor(16) as ex:
  for t,d,n in ex.map(tk,[t for t in toks if t not in oc['dec']]): oc['dec'][t]=d; oc['sym'][t]=n
for t in []:
  if t in oc['dec']: continue
  if t=='0x'+'0'*40: oc['dec'][t]=18; continue
  r=ec(t,'0x313ce567'); oc['dec'][t]=int(r,16) if r and len(r)>2 and r!='0x' else None
  oc.setdefault('sym',{})
  s=ec(t,'0x95d89b41')
  try: b=bytes.fromhex(s[2:]); oc['sym'][t]=b[64:64+int(b[32:64].hex(),16)].decode() if len(b)>=96 else b.rstrip(b'\0').decode()
  except Exception: oc['sym'][t]=None
json.dump(oc,open('onchain_meta.json','w'))
print(len(oc['pairs']),sum(1 for v in oc['pairs'].values() if not v[0]),len(oc['dec']))
