import json,urllib.request,time
from rpcretry import backoff
RPC="https://rpc.mainnet.chain.robinhood.com"
def call(m,p,rpc=None,tries=8):
  err=None
  for i in range(tries):
    try:
      r=urllib.request.urlopen(urllib.request.Request(rpc or RPC,json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),{"content-type":"application/json","user-agent":"curl/8"}),timeout=60)
      j=json.loads(r.read())
      if 'error' in j: raise Exception(j['error'])
      return j['result']
    except Exception as e:
      err=e; backoff(i,e,tries,base=1.5,cap=45.0)
  raise err

def logs(flt, a, b, step=50000):
  """adaptive eth_getLogs over [a,b] inclusive"""
  out=[]; s=a
  while s<=b:
    e=min(b,s+step-1)
    try:
      out+=call('eth_getLogs',[dict(flt,fromBlock=hex(s),toBlock=hex(e))],tries=2 if step>500 else 8)
      s=e+1; step=min(step*2,60000)
    except Exception as ex:
      if step>1:
        step=max(1,step//4); continue
      raise
  return out
