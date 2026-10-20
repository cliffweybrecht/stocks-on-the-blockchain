"""Per-asset rows for a nightly DexScreener desk snapshot.

Same `assets[]` shape Base writes in scripts/snapshot-base-volume.py:
address, symbol, issuer, instrumentKind (pre-IPO is "private"),
volume24hUsd, displayedLiquidityUsd, and pools. Each pool is
pairAddress, dexId, volume24hUsd, liquidityUsd.

Callers pass volumes they already read from DexScreener. This module
does not fetch and does not invent a number for a missing h24.

`apply_liquidity_sanity` is the shared guard. Robinhood and BNB call it
through `assets_for`. Base can call it from `scripts/snapshot-base-volume.py`
instead of summing `liquidity.usd` directly. The TypeScript twin is
`src/lib/market/liquidity-sanity.ts`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

INSTRUMENT_KIND = {"equity": "equity", "etf": "etf", "preipo": "private"}

# Pool liquidity above this, with almost no trading, is not displayed.
LIQUIDITY_SANITY_MIN_USD = 50_000_000
# 24h volume below this fraction of liquidity is dead depth. 0.01%.
LIQUIDITY_SANITY_MIN_VOLUME_RATIO = 0.0001
LIQUIDITY_SANITY_DOMINANCE_MULTIPLE = 20
LIQUIDITY_SANITY_MARKET_MULTIPLE = 10
# GeckoTerminal reserve replaces the reported figure when it is under this fraction.
LIQUIDITY_SANITY_GECKO_MAX_RATIO = 0.1

LIQUIDITY_SANITY_REASON_DEAD_DEPTH = "liquidity-above-50m-with-volume-below-0.01pct"
LIQUIDITY_SANITY_REASON_DOMINANCE = "liquidity-above-20x-next-pool-and-10x-market-value"
LIQUIDITY_SANITY_REASON_GECKO = "gecko-reserve-far-lower"


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


def _non_negative(raw: Any) -> float | None:
    value = reported_usd(raw)
    return value


def apply_liquidity_sanity(
    pools: list[dict],
    market_value_usd: float | None = None,
) -> dict:
    """Displayed liquidity after the sanity guard, plus excluded pools.

    Each pool is poolId, liquidityUsd, volume24hUsd, and optional
    geckoReserveUsd. Volume is not part of the returned sum. A missing
    volume counts as no trading. When every reported reserve is excluded,
    displayedLiquidityUsd is 0, not null.
    """
    market = _non_negative(market_value_usd)
    normalized: list[dict] = []
    for pool in pools:
        gecko = pool.get("geckoReserveUsd")
        normalized.append(
            {
                "poolId": str(pool.get("poolId") or "").strip(),
                "liquidityUsd": _non_negative(pool.get("liquidityUsd")),
                "volume24hUsd": _non_negative(pool.get("volume24hUsd")),
                "geckoReserveUsd": _non_negative(gecko),
            }
        )

    excluded: list[dict] = []
    counted: list[float] = []
    saw_liquidity = False
    for index, pool in enumerate(normalized):
        liquidity = pool["liquidityUsd"]
        if not pool["poolId"] or liquidity is None:
            continue
        saw_liquidity = True
        volume = 0.0 if pool["volume24hUsd"] is None else pool["volume24hUsd"]
        gecko = pool["geckoReserveUsd"]
        gecko_replaces = gecko is not None and liquidity > 0 and gecko < liquidity * LIQUIDITY_SANITY_GECKO_MAX_RATIO
        figure = gecko if gecko_replaces else liquidity
        if figure > LIQUIDITY_SANITY_MIN_USD and volume < figure * LIQUIDITY_SANITY_MIN_VOLUME_RATIO:
            excluded.append(
                {
                    "poolId": pool["poolId"],
                    "liquidityUsd": round_usd(liquidity),
                    "reason": LIQUIDITY_SANITY_REASON_DEAD_DEPTH,
                }
            )
            continue
        next_largest = 0.0
        for other_index, other in enumerate(normalized):
            if other_index == index:
                continue
            other_liq = other["liquidityUsd"]
            if other_liq is not None and other_liq > next_largest:
                next_largest = other_liq
        if (
            market is not None
            and market > 0
            and next_largest > 0
            and figure > LIQUIDITY_SANITY_DOMINANCE_MULTIPLE * next_largest
            and figure > LIQUIDITY_SANITY_MARKET_MULTIPLE * market
        ):
            excluded.append(
                {
                    "poolId": pool["poolId"],
                    "liquidityUsd": round_usd(liquidity),
                    "reason": LIQUIDITY_SANITY_REASON_DOMINANCE,
                }
            )
            continue
        if gecko_replaces:
            excluded.append(
                {
                    "poolId": pool["poolId"],
                    "liquidityUsd": round_usd(liquidity),
                    "reason": LIQUIDITY_SANITY_REASON_GECKO,
                    "replacementLiquidityUsd": round_usd(gecko),
                }
            )
        counted.append(figure)

    if not saw_liquidity:
        return {"displayedLiquidityUsd": None, "excludedLiquidityPools": []}
    if not counted:
        return {"displayedLiquidityUsd": 0, "excludedLiquidityPools": excluded}
    return {
        "displayedLiquidityUsd": round(sum(counted), 2),
        "excludedLiquidityPools": excluded,
    }


def _exclusion_reason(excluded: list[dict]) -> str:
    parts = []
    for row in excluded:
        if "replacementLiquidityUsd" in row:
            parts.append(
                "replaced pool {poolId} raw liquidity {liquidityUsd} with {replacementLiquidityUsd}: {reason}".format(
                    **row
                )
            )
        else:
            parts.append(
                "excluded pool {poolId} raw liquidity {liquidityUsd}: {reason}".format(**row)
            )
    return "; ".join(parts)


def _sanity_pools(pools: list[dict]) -> list[dict]:
    found = []
    for pool in pools:
        if not isinstance(pool, dict):
            continue
        pool_id = pool.get("pairAddress") or pool.get("poolId") or ""
        gecko = pool.get("geckoReserveUsd")
        if gecko is None:
            gecko = pool.get("reserveUsd")
        found.append(
            {
                "poolId": pool_id,
                "liquidityUsd": pool.get("liquidityUsd"),
                "volume24hUsd": pool.get("volume24hUsd"),
                "geckoReserveUsd": gecko,
            }
        )
    return found


def assets_for(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_details: dict[str, list[dict]],
) -> list[dict]:
    """Mints with a pool, a reported h24, or reported liquidity. Others are omitted.

    instrumentKind matches Base and the Solana snapshot: pre-IPO is "private".
    displayedLiquidityUsd is the guarded sum of pool liquidity.usd. All-missing
    stays null. A reported 0 is kept. Null h24 is not stored as $0. A pool the
    guard drops stays on `pools` and is listed on `excludedLiquidityPools`.
    """
    found: list[dict] = []
    for row in rows:
        addr = str(row.get("address") or "").lower()
        if not addr:
            continue
        pools = list(pool_details.get(addr) or [])
        raw_vol = vols.get(addr)
        vol = reported_usd(raw_vol)
        sanity = apply_liquidity_sanity(_sanity_pools(pools), row.get("marketValueUsd"))
        displayed = sanity["displayedLiquidityUsd"]
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
        if sanity["excludedLiquidityPools"]:
            item["excludedLiquidityPools"] = sanity["excludedLiquidityPools"]
        issuer = row.get("issuer")
        if isinstance(issuer, str) and issuer.strip():
            item["issuer"] = issuer.strip()
        found.append(item)
    found.sort(key=lambda item: (str(item["symbol"]).upper(), str(item["address"]).lower()))
    return found


def _same_usd(left: Any, right: Any) -> bool:
    if left is None or right is None:
        return left is right
    try:
        return abs(float(left) - float(right)) < 0.005
    except (TypeError, ValueError):
        return False


def correct_stored_snapshot(payload: dict) -> list[dict]:
    """Rewrite stored asset liquidity that fails the guard. Volume stays.

    The previous displayedLiquidityUsd is kept on `correction`. Pool
    `liquidityUsd` is left as captured and copied onto `excludedLiquidityPools`.
    """
    changes: list[dict] = []
    for rec in payload.get("records") or []:
        if not isinstance(rec, dict) or not isinstance(rec.get("assets"), list):
            continue
        for asset in rec["assets"]:
            if not isinstance(asset, dict) or not isinstance(asset.get("pools"), list):
                continue
            sanity = apply_liquidity_sanity(_sanity_pools(asset["pools"]), asset.get("marketValueUsd"))
            if not sanity["excludedLiquidityPools"]:
                continue
            before = asset.get("displayedLiquidityUsd")
            after = sanity["displayedLiquidityUsd"]
            if _same_usd(before, after):
                continue
            asset["correction"] = {
                "reason": _exclusion_reason(sanity["excludedLiquidityPools"]),
                "displayedLiquidityUsd": before,
            }
            asset["displayedLiquidityUsd"] = after
            asset["excludedLiquidityPools"] = sanity["excludedLiquidityPools"]
            changes.append(
                {
                    "date": rec.get("date"),
                    "symbol": asset.get("symbol"),
                    "address": asset.get("address"),
                    "displayedLiquidityUsdBefore": before,
                    "displayedLiquidityUsdAfter": after,
                    "excludedLiquidityPools": sanity["excludedLiquidityPools"],
                }
            )
    return changes


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
