"""Run the holder/supply capture after a chain's nightly volume writer.

The volume file and the holder file stay separate. This does not call
snapshot:land and it does not push main. The Eastern day key is the one the
volume writer just used.
"""

from __future__ import annotations

import os
import subprocess
import sys


def run_holder_snapshot(chain: str, date: str) -> int:
    if os.environ.get("SKIP_HOLDER_SNAPSHOT", "").strip() in {"1", "true", "yes"}:
        print(f"snapshot:holders skipped for {chain} {date} (SKIP_HOLDER_SNAPSHOT)", flush=True)
        return 0
    env = os.environ.copy()
    env["HOLDER_SNAPSHOT_DATE"] = date
    if chain == "solana":
        env["SOLANA_MARKET_ENABLED"] = "true"
    print(f"snapshot:holders chained from {chain} volume writer date={date}", flush=True)
    completed = subprocess.run(
        ["npm", "run", "snapshot:holders", "--", "--chain", chain],
        env=env,
        check=False,
    )
    if completed.returncode == 0:
        print(
            f"Next: npm run snapshot:land -- --chain holders-{chain} --push-main",
            flush=True,
        )
    else:
        print(
            f"snapshot:holders {chain} {date} failed with exit {completed.returncode}. "
            "Volume was already written. Holder file was not landed.",
            file=sys.stderr,
            flush=True,
        )
    return int(completed.returncode)
