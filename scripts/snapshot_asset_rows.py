"""Per-asset rows for a nightly DexScreener desk snapshot.

Same `assets[]` shape Base writes in scripts/snapshot-base-volume.py:
address, symbol, issuer, instrumentKind (pre-IPO is "private"),
volume24hUsd, displayedLiquidityUsd, and pools. Each pool is
pairAddress, dexId, volume24hUsd, liquidityUsd.

Callers pass volumes they already read from DexScreener. This module
does not fetch and does not invent a number for a missing h24.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

INSTRUMENT_KIND = {"equity": "equity", "etf": "etf", "preipo": "private"}


def round_usd(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2)


def reported_usd(raw: Any) -> float | None:
    """Non-negative finite USD. Missing and negative stay null, not $0."""
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value != value or value < 0:  # NaN
        return None
    return value


def pool_row(pair_address: str, dex_id: str, volume: float | None, liquidity: float | None) -> dict:
    dex = dex_id.strip() if isinstance(dex_id, str) and dex_id.strip() else "unknown"
    return {
        "pairAddress": pair_address,
        "dexId": dex,
        "volume24hUsd": round_usd(reported_usd(volume)),
        "liquidityUsd": round_usd(reported_usd(liquidity)),
    }


def sum_nullable(values: list[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return round(sum(present), 2)


def assets_for(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_details: dict[str, list[dict]],
) -> list[dict]:
    """Mints with a pool, a reported h24, or reported liquidity. Others are omitted.

    instrumentKind matches Base and the Solana snapshot: pre-IPO is "private".
    displayedLiquidityUsd is the sum of pool liquidity.usd. All-missing stays null.
    A reported 0 is kept. Null h24 is not stored as $0.
    """
    found: list[dict] = []
    for row in rows:
        addr = str(row.get("address") or "").lower()
        if not addr:
            continue
        pools = list(pool_details.get(addr) or [])
        raw_vol = vols.get(addr)
        vol = reported_usd(raw_vol)
        displayed = sum_nullable([pool.get("liquidityUsd") for pool in pools])
        if not pools and vol is None and displayed is None:
            continue
        item: dict[str, Any] = {
            "address": row["address"],
            "symbol": row.get("symbol") or "",
            "instrumentKind": INSTRUMENT_KIND.get(row.get("kind") or "", "equity"),
            "volume24hUsd": round_usd(vol),
            "displayedLiquidityUsd": displayed,
            "pools": pools,
        }
        issuer = row.get("issuer")
        if isinstance(issuer, str) and issuer.strip():
            item["issuer"] = issuer.strip()
        found.append(item)
    found.sort(key=lambda item: (str(item["symbol"]).upper(), str(item["address"]).lower()))
    return found


def upsert_day_record(path: Path, record: dict) -> None:
    """Replace one Eastern date. Other days and file-level keys stay."""
    payload: dict[str, Any] = {"version": 1, "records": []}
    if path.exists():
        try:
            loaded = json.loads(path.read_text())
        except json.JSONDecodeError:
            loaded = None
        if isinstance(loaded, dict) and isinstance(loaded.get("records"), list):
            payload = loaded
    date = record.get("date")
    records = []
    for row in payload.get("records") or []:
        if isinstance(row, dict) and row.get("date") == date:
            continue
        records.append(row)
    records.append(record)
    records.sort(key=lambda row: row.get("date") or "" if isinstance(row, dict) else "")
    payload["version"] = 1
    payload["records"] = records
    path.write_text(json.dumps(payload, indent=2) + "\n")
