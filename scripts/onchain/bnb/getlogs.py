import json,sys,time
from rpc import call,EPS,MAX_ADDRS,MAX_STEP
from concurrent.futures import ThreadPoolExecutor
def logs(flt,a,b,step=20000):
  """adaptive getLogs over [a,b]; returns list. Address lists are split to the endpoint's per-query cap."""
  ad=flt.get('address')
  if isinstance(ad,list) and len(ad)>MAX_ADDRS:
    res=[]
    with ThreadPoolExecutor(4) as gx:
      for r in gx.map(lambda g: logs(dict(flt,address=ad[g:g+MAX_ADDRS]),a,b,step), range(0,len(ad),MAX_ADDRS)): res+=r
    return res
  step=min(step,MAX_STEP)
  out=[];todo=[(x,min(b,x+step-1)) for x in range(a,b+1,step)]
  def one(r):
    x,y=r
    try: return call('eth_getLogs',[{**flt,'fromBlock':hex(x),'toBlock':hex(y)}],tries=3),None
    except Exception as e:
      if y==x: raise
      m=(x+y)//2; return None,[(x,m),(m+1,y)]
  with ThreadPoolExecutor(6) as ex:
    while todo:
      res=list(ex.map(one,todo)); todo=[]
      for r,split in res:
        if split: todo+=split
        else: out+=r
  return out
def slim(l): return {'a':l['address'].lower(),'t':l['topics'],'d':l['data'],'b':int(l['blockNumber'],16),'tx':l['transactionHash'],'i':int(l['logIndex'],16)}
