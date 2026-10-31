"""Shared RPC backoff policy for the onchain scripts (copied next to them by run.sh).

Transient = HTTP 429/5xx, timeouts, connection errors, and JSON-RPC errors that name a rate limit,
timeout, or 'header not found'. Transient errors back off exponentially with jitter and honor
Retry-After. Other errors (e.g. 'max results') get a short pause so callers can adapt (smaller range).
Retries are always bounded by the caller's `tries`; the final failure is re-raised, never guessed.
"""
import random,socket,time,urllib.error

_MARKERS=('429','too many','rate limit','ratelimit','timeout','timed out','header not found','-32005',
          'try again','temporarily','unavailable','overloaded','capacity','bad gateway','gateway')

def is_transient(e):
  if isinstance(e,urllib.error.HTTPError): return e.code==429 or e.code>=500
  if isinstance(e,(urllib.error.URLError,socket.timeout,TimeoutError,ConnectionError)): return True
  m=str(e).lower()
  return any(x in m for x in _MARKERS)

def retry_after(e):
  h=getattr(e,'headers',None)
  try: v=float(h.get('Retry-After')) if h is not None and h.get('Retry-After') else None
  except (TypeError,ValueError): return None
  return v if v is not None and v>=0 else None

def delay(k,e,base=2.0,cap=60.0):
  if is_transient(e):
    d=min(cap,base*(2**k))+random.random()*base
    ra=retry_after(e)
    if ra is not None: d=max(d,min(ra,cap))
    return d
  return min(8.0,1+k*1.5)

def backoff(k,e,tries,base=2.0,cap=60.0):
  """Sleep before attempt k+1; no sleep after the final attempt."""
  if k+1<tries: time.sleep(delay(k,e,base,cap))
