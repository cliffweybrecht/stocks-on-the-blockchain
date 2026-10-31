#!/bin/bash
# Base exact onchain ET-day recount (port of the box pipeline). Usage: run.sh DAY WORKDIR
set -euo pipefail
DAY=$1; W=$2; HERE=$(cd "$(dirname "$0")" && pwd)
export REPO_SCRIPTS=$(cd "$HERE/../.." && pwd) REPO_DATA=$(cd "$HERE/../../../data" && pwd)
mkdir -p "$W"; cp -n "$HERE"/state/*.json "$W"/ 2>/dev/null || true; cp "$HERE"/*.py "$HERE/../rpcretry.py" "$HERE/../../gecko_http.py" "$W"/; cd "$W"
st(){ s=$(date +%s); echo "::group::$*"; "$@"; echo "::endgroup::"; echo "$2 $(( $(date +%s)-s ))s" | tee -a "time-$DAY.log"; }
st python3 -u prep_universe.py "$DAY"
st python3 -u tr.py "$DAY"
st python3 -u probe.py "$DAY"
st python3 -u classify.py "$DAY"
st python3 -u fetchpools.py "$DAY"
st python3 -u custom_list.py "$DAY"
st python3 -u cftx.py "$DAY"
st python3 -u cflow3.py "$DAY"
st python3 -u singscan.py "$DAY"
st python3 -u resolve_ids.py "$DAY"
st python3 -u unres.py "$DAY"
st python3 -u v4receipts.py "$DAY"
st python3 -u initfind.py "$DAY"
st python3 -u amtmatch.py "$DAY"
st python3 -u leftover.py "$DAY"
st python3 -u decs.py
st python3 -u refprice.py "$DAY"
st python3 -u recount_base.py "$DAY"
st python3 -u gres.py "$DAY"
st python3 -u build_row.py "$DAY"
