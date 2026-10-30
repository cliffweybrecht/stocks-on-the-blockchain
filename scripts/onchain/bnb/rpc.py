import json,os,urllib.request,time,itertools
# BSC_RPC_URL secret (archive-grade, many addresses per getLogs) if set; else public publicnode
# (10 addresses and 50k blocks per eth_getLogs; getlogs.py splits to fit).
_SECRET=os.environ.get('BSC_RPC_URL') or ''
EPS=[_SECRET or 'https://bsc.publicnode.com']
PUBLIC=not _SECRET
MAX_ADDRS=int(os.environ.get('BSC_LOGS_MAX_ADDRS') or (10 if PUBLIC else 1000))
MAX_STEP=int(os.environ.get('BSC_LOGS_MAX_STEP') or (50000 if PUBLIC else 10**9))
_i=itertools.count()
def call(m,p,tries=6,ep=None):
  err=None
  for k in range(tries):
    u=ep or EPS[next(_i)%len(EPS)]
    try:
      r=urllib.request.Request(u,json.dumps({'jsonrpc':'2.0','id':1,'method':m,'params':p}).encode(),{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'})
      j=json.loads(urllib.request.urlopen(r,timeout=90).read())
      if 'error' in j: raise Exception(str(j['error'])[:200])
      return j['result']
    except Exception as e:
      err=e; time.sleep((4+k*4) if '429' in str(e) else min(8,1+k*1.5))
  raise err
def batch(reqs,tries=10):
  body=[{'jsonrpc':'2.0','id':i,'method':m,'params':p} for i,(m,p) in enumerate(reqs)]
  err=None
  for k in range(tries):
    try:
      r=urllib.request.Request(EPS[0],json.dumps(body).encode(),{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'})
      j=json.loads(urllib.request.urlopen(r,timeout=120).read())
      if isinstance(j,dict): raise Exception(str(j)[:200])
      out=[None]*len(reqs)
      for x in j: out[x['id']]=x.get('result')
      return out
    except Exception as e: err=e; time.sleep((5+k*5) if '429' in str(e) else 1+k*2)
  raise err
