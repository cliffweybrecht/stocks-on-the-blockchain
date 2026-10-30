from rpc import call
from functools import lru_cache
@lru_cache(None)
def ts(n): return int(call('eth_getBlockByNumber',[hex(n),False])['timestamp'],16)
def first_at_or_after(t):
  hi=int(call('eth_blockNumber',[]),16); lo=hi-3000000
  while lo<hi:
    m=(lo+hi)//2
    if ts(m)>=t: hi=m
    else: lo=m+1
  return lo
def day_range(day):
  from datetime import datetime,timedelta
  from zoneinfo import ZoneInfo
  d=datetime.fromisoformat(day).replace(tzinfo=ZoneInfo('America/New_York'))
  s=int(d.timestamp()); e=int((d+timedelta(days=1)).timestamp())
  return s,e,first_at_or_after(s),first_at_or_after(e)-1
