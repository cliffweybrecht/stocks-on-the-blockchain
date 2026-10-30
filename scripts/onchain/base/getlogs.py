import json,sys,time
from rpc import call,EPS
from concurrent.futures import ThreadPoolExecutor
def logs(flt,a,b,step=10000):
  """adaptive getLogs over [a,b]; returns list"""
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
