import json,os,urllib.request,time
# BASE_RPC_URL (secret or env) else the public publicnode endpoint (45k-block getLogs, 10 addresses/query).
EPS=[os.environ.get('BASE_RPC_URL') or 'https://base.publicnode.com']
def _post(body,timeout=120):
  r=urllib.request.Request(EPS[0],json.dumps(body).encode(),{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'})
  return json.loads(urllib.request.urlopen(r,timeout=timeout).read())
def call(m,p,tries=6):
  err=None
  for k in range(tries):
    try:
      j=_post({'jsonrpc':'2.0','id':1,'method':m,'params':p})
      if 'error' in j: raise Exception(str(j['error'])[:200])
      return j['result']
    except Exception as e: err=e; time.sleep(min(20,2+k*3))
  raise err
def batch(reqs,tries=8):
  body=[{'jsonrpc':'2.0','id':i,'method':m,'params':p} for i,(m,p) in enumerate(reqs)]
  err=None
  for k in range(tries):
    try:
      j=_post(body)
      if isinstance(j,dict): raise Exception(str(j)[:200])
      out=[None]*len(reqs)
      for x in j: out[x['id']]=x.get('result')
      return out
    except Exception as e: err=e; time.sleep(2+k*3)
  raise err
