#!/bin/bash
# Robinhood Chain exact onchain recount of every pool the Gecko step did not candle. Usage: run.sh DAY WORKDIR SNAPSHOT_JSON
set -euo pipefail
DAY=$1; W=$2; SNAP=$(readlink -f "$3"); HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$W"; cp -n "$HERE"/state/*.json "$W"/ 2>/dev/null || true; cp "$HERE"/*.py "$HERE/../rpcretry.py" "$HERE/../../gecko_http.py" "$W"/; cd "$W"
st(){ s=$(date +%s); echo "::group::$*"; "$@"; echo "::endgroup::"; echo "$2 $(( $(date +%s)-s ))s" | tee -a "time-$DAY.log"; }
python3 - "$DAY" "$SNAP" <<'P'
import json,sys,os
day,snap=sys.argv[1:]; r=[x for x in json.load(open(snap))['records'] if x['date']==day][0]
p=json.load(open('allpools2.json')) if os.path.exists('allpools2.json') else {}
for a in r['assets']:
  for q in a['pools']: p.setdefault(q['pairAddress'].lower(),[[q['dexId'],q['source']]])
for k in ('excludedPools','noClosedDayData'):
  for q in r.get(k) or []: p.setdefault(q['pairAddress'].lower(),[[q['dexId'],q['source']]])
json.dump(p,open('allpools2.json','w')); json.dump(p,open('allpools.json','w')); print('pools',len(p))
P
st python3 -u meta.py
st python3 -u tokens.py
st python3 -u fetchlogs.py "$DAY" allpools2.json
st python3 -u ethprice.py "$DAY"
st python3 -u fetchxfer.py "$DAY"
st python3 -u fetchekubo.py "$DAY"
st python3 -u recount.py "$DAY" "$SNAP"
st python3 -u finalize.py "$DAY"
