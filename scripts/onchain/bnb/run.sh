#!/bin/bash
# BNB exact onchain recount of every pool the Gecko step did not candle. Usage: run.sh DAY WORKDIR SNAPSHOT_JSON
set -euo pipefail
DAY=$1; W=$2; SNAP=$(readlink -f "$3"); HERE=$(cd "$(dirname "$0")" && pwd)
export REPO_SCRIPTS=$(cd "$HERE/../.." && pwd) REPO_ROOT=$(cd "$HERE/../../.." && pwd) WORK=$W
mkdir -p "$W"; cp -n "$HERE"/state/*.json "$W"/ 2>/dev/null || true; cp "$HERE"/*.py "$HERE/../rpcretry.py" "$HERE/../../gecko_http.py" "$W"/; cd "$W"
st(){ s=$(date +%s); echo "::group::$*"; "$@"; echo "::endgroup::"; echo "$2 $(( $(date +%s)-s ))s" | tee -a "time-$DAY.log"; }
st python3 -u prep_universe.py
st python3 -u fetchtransfers.py "$DAY"
st python3 -u probe.py "$DAY"
st python3 -u candidates.py "$DAY"
st python3 -u classify.py "$DAY"
st python3 -u fetchpools.py "$DAY"
st python3 -u custom_list.py "$DAY"
if [ -z "${BSC_RPC_URL:-}" ]; then st python3 -u cflow_receipts.py "$DAY"; else st python3 -u cflow.py "$DAY"; fi
st python3 -u singscan.py "$DAY"
st python3 -u resolve_ids.py "$DAY"
st python3 -u v4receipts.py "$DAY"
st python3 -u decs.py
st python3 -u refprice.py "$DAY"
st python3 -u recount_bnb.py "$DAY" "$SNAP"
st python3 -u finalize.py "$DAY"
