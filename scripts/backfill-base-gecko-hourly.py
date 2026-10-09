#!/usr/bin/env python3
"""One-time Base backfill for Eastern days 2026-09-27 through 2026-10-08.

Cliff approved this override of the nightly "no Gecko backfill" rule.
For every known pool, sum GeckoTerminal hourly volume into the
America/New_York day (00:00 through 23:59:59). A token or pool GeckoTerminal
cannot cover keeps that day's existing per-token value. A pool listed on two
tracked tokens counts once, on the non-wrapper side.

Does not write other chains and does not change Base rows outside the range.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
FROM_DAY = "2026-09-27"
THROUGH_DAY = "2026-10-08"
BACKFILL_SOURCE = "geckoterminal-hourly-2026-10-08"
ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = Path(os.environ.get("BASE_BACKFILL_SNAPSHOT") or (ROOT / "data" / "volume-snapshots" / "base.json"))
POOLS = ROOT / "data" / "volume-snapshots" / "base-pools.json"
CACHE = Path("/tmp/gecko-base-ohlcv")
UPLOAD_GT = Path("/home/ubuntu/.cursor/projects/workspace/uploads/gt_rows_cdd1.json")

KIND_TO_LANE = {"equity": "publicEquity24hUsd", "etf": "etfIndex24hUsd", "preipo": "private24hUsd"}
KIND_TO_INSTRUMENT = {"equity": "equity", "etf": "etf", "preipo": "private"}
LANE_POOL_FIELD = {
    "equity": "publicPoolCount",
    "etf": "etfPoolCount",
    "preipo": "preipoPoolCount",
}


def day_keys() -> list[str]:
    start = date.fromisoformat(FROM_DAY)
    end = date.fromisoformat(THROUGH_DAY)
    keys = []
    cursor = start
    while cursor <= end:
        keys.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return keys


def next_day(day: str) -> str:
    return (date.fromisoformat(day) + timedelta(days=1)).isoformat()


def eastern_midnight(day: str) -> int:
    year, month, day_n = (int(part) for part in day.split("-"))
    return int(datetime(year, month, day_n, tzinfo=EASTERN).timestamp())


def round_usd(value: float) -> float:
    return round(value + 1e-9, 2)


def covers_day(candles: list[list], day: str) -> bool:
    if not candles:
        return False
    start = eastern_midnight(day)
    end = eastern_midnight(next_day(day))
    times = [int(row[0]) for row in candles if row and row[0]]
    if not times:
        return False
    if any(start <= t < end for t in times):
        return True
    return min(times) <= start <= max(times)


def volume_on_day(candles: list[list], day: str) -> float:
    start = eastern_midnight(day)
    end = eastern_midnight(next_day(day))
    by_open: dict[int, float] = {}
    for row in candles:
        if not row or len(row) < 2:
            continue
        t = int(row[0])
        vol = float(row[1])
        if t <= 0 or vol < 0 or vol != vol:
            continue
        if start <= t < end:
            by_open[t] = vol
    return round_usd(sum(by_open.values()))


def load_caches() -> dict[str, dict]:
    caches: dict[str, dict] = {}
    if CACHE.exists():
        for path in CACHE.glob("*.json"):
            try:
                data = json.loads(path.read_text())
            except json.JSONDecodeError:
                continue
            pool = str(data.get("pool") or path.stem)
            caches[pool.lower()] = data
    if UPLOAD_GT.exists():
        uploaded = json.loads(UPLOAD_GT.read_text())
        for key, rows in uploaded.items():
            _symbol, pool = key.split("|", 1)
            current = caches.get(pool.lower())
            if current and current.get("ok") and current.get("candles"):
                continue
            caches[pool.lower()] = {
                "ok": True,
                "pool": pool,
                "candles": [[int(row[0]), float(row[5])] for row in rows if isinstance(row, list) and len(row) >= 6],
                "source": "upload",
            }
    return caches


def load_catalog() -> dict[str, dict]:
    payload = json.loads(POOLS.read_text())
    tokens = payload.get("tokens") or {}
    catalog: dict[str, dict] = {}
    for key, row in tokens.items():
        if not isinstance(row, dict):
            continue
        address = str(row.get("address") or key)
        pools = []
        for pool in row.get("pools") or []:
            if isinstance(pool, dict) and str(pool.get("pairAddress") or "").startswith("0x"):
                pools.append(
                    {
                        "pairAddress": pool["pairAddress"],
                        "dexId": str(pool.get("dexId") or "unknown") or "unknown",
                    }
                )
        catalog[address.lower()] = {
            "address": address,
            "symbol": str(row.get("symbol") or ""),
            "issuer": str(row.get("issuer") or ""),
            "kind": str(row.get("kind") or "equity"),
            "mainPool": row.get("mainPool") if isinstance(row.get("mainPool"), str) else None,
            "pools": pools,
        }
    return catalog


def owner_address(pool_key: str, holders: list[dict]) -> str:
    """Count a two-sided pool once. Prefer the non-wrapper, then Coinbase."""

    def rank(token: dict) -> tuple:
        symbol = token.get("symbol") or ""
        wrapped = 1 if symbol.lower().startswith("wt") else 0
        coinbase = 0 if token.get("issuer") == "coinbase" else 1
        return (wrapped, coinbase, token["address"].lower())

    if not holders:
        return ""
    return min(holders, key=rank)["address"].lower()


def existing_assets(record: dict) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for asset in record.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        addr = str(asset.get("address") or "").lower()
        if addr.startswith("0x"):
            found[addr] = asset
    for hit in record.get("symbolsWithVolume") or []:
        if not isinstance(hit, dict):
            continue
        addr = str(hit.get("address") or "").lower()
        if not addr.startswith("0x") or addr in found:
            continue
        vol = hit.get("volume24hUsd")
        if not isinstance(vol, (int, float)) or isinstance(vol, bool):
            continue
        kind = str(hit.get("kind") or "equity")
        found[addr] = {
            "address": hit.get("address"),
            "symbol": hit.get("symbol"),
            "issuer": hit.get("issuer"),
            "instrumentKind": KIND_TO_INSTRUMENT.get(kind, "equity"),
            "volume24hUsd": vol,
            "displayedLiquidityUsd": None,
            "pools": [],
        }
    return found


def gecko_for_token(token: dict, day: str, caches: dict[str, dict]) -> tuple[float | None, list[dict], list[str]]:
    """Return (volume, covered pool rows, uncovered pool addresses).

    None volume means keep the existing per-token value: no pool was covered,
    or the known main pool was not covered.
    """
    covered: list[dict] = []
    uncovered: list[str] = []
    for pool in token["pools"]:
        pair = pool["pairAddress"]
        cached = caches.get(pair.lower())
        candles = cached.get("candles") if isinstance(cached, dict) and cached.get("ok") else None
        if not candles or not covers_day(candles, day):
            uncovered.append(pair)
            continue
        covered.append(
            {
                "pairAddress": pair,
                "dexId": pool.get("dexId") or "unknown",
                "volume24hUsd": volume_on_day(candles, day),
                "liquidityUsd": None,
            }
        )
    if not covered:
        return None, [], uncovered
    main = token.get("mainPool")
    if isinstance(main, str) and main.lower() in {pair.lower() for pair in uncovered}:
        return None, [], uncovered
    total = round_usd(sum(pool["volume24hUsd"] or 0 for pool in covered))
    return total, covered, uncovered


def merge_liquidity(old_pools: list[dict], new_pools: list[dict]) -> float | None:
    old_liq = {}
    for pool in old_pools or []:
        if not isinstance(pool, dict):
            continue
        pair = str(pool.get("pairAddress") or "").lower()
        liq = pool.get("liquidityUsd")
        if pair and isinstance(liq, (int, float)) and not isinstance(liq, bool):
            old_liq[pair] = float(liq)
    present = []
    for pool in new_pools:
        liq = old_liq.get(pool["pairAddress"].lower())
        pool["liquidityUsd"] = None if liq is None else round_usd(liq)
        if pool["liquidityUsd"] is not None:
            present.append(pool["liquidityUsd"])
    if not present:
        return None
    return round_usd(sum(present))


def instrument_kind(token: dict, asset: dict | None) -> str:
    if asset and asset.get("instrumentKind") in {"equity", "etf", "private"}:
        return asset["instrumentKind"]
    return KIND_TO_INSTRUMENT.get(token.get("kind") or "", "equity")


def writer_kind(instrument: str) -> str:
    return {"equity": "equity", "etf": "etf", "private": "preipo"}.get(instrument, "equity")


def backfill_record(record: dict, catalog: dict[str, dict], caches: dict[str, dict]) -> dict:
    day = record["date"]
    # A second run must keep the DexScreener total captured the first time.
    if record.get("backfillSource") == BACKFILL_SOURCE and "originalCombined24hUsd" in record:
        original = record.get("originalCombined24hUsd")
    else:
        original = record.get("combined24hUsd")
    assets = existing_assets(record)
    # token -> contribution
    rows: dict[str, dict] = {}
    gaps: list[str] = []

    addresses = set(assets) | set(catalog)
    for addr in addresses:
        token = catalog.get(addr)
        asset = assets.get(addr)
        if token is None and asset is None:
            continue
        if token is None:
            vol = asset.get("volume24hUsd") if asset else None
            if not isinstance(vol, (int, float)) or isinstance(vol, bool):
                continue
            rows[addr] = {
                "address": asset.get("address") or addr,
                "symbol": asset.get("symbol") or "",
                "issuer": asset.get("issuer") or "",
                "instrument": asset.get("instrumentKind") or "equity",
                "volume": float(vol),
                "source": "existing",
                "pools": list(asset.get("pools") or []),
                "displayed": asset.get("displayedLiquidityUsd"),
                "asset": asset,
            }
            continue
        gecko_vol, covered, uncovered = gecko_for_token(token, day, caches)
        if uncovered and gecko_vol is None and (asset and asset.get("volume24hUsd") is not None or token.get("mainPool")):
            if token.get("mainPool") and token["mainPool"].lower() in {p.lower() for p in uncovered}:
                gaps.append(f"{day} {token['symbol']} main {token['mainPool']}")
        if gecko_vol is None:
            if asset is None:
                continue
            vol = asset.get("volume24hUsd")
            if not isinstance(vol, (int, float)) or isinstance(vol, bool):
                # Pools but no number, and gecko could not replace it.
                rows[addr] = {
                    "address": asset.get("address") or token["address"],
                    "symbol": asset.get("symbol") or token["symbol"],
                    "issuer": asset.get("issuer") or token["issuer"],
                    "instrument": instrument_kind(token, asset),
                    "volume": None,
                    "source": "existing",
                    "pools": list(asset.get("pools") or []),
                    "displayed": asset.get("displayedLiquidityUsd"),
                    "asset": asset,
                }
                continue
            rows[addr] = {
                "address": asset.get("address") or token["address"],
                "symbol": asset.get("symbol") or token["symbol"],
                "issuer": asset.get("issuer") or token["issuer"],
                "instrument": instrument_kind(token, asset),
                "volume": float(vol),
                "source": "existing",
                "pools": list(asset.get("pools") or []),
                "displayed": asset.get("displayedLiquidityUsd"),
                "asset": asset,
            }
            continue
        old_pools = list((asset or {}).get("pools") or [])
        displayed = merge_liquidity(old_pools, covered)
        rows[addr] = {
            "address": (asset or {}).get("address") or token["address"],
            "symbol": token["symbol"] or (asset or {}).get("symbol") or "",
            "issuer": token["issuer"] or (asset or {}).get("issuer") or "",
            "instrument": instrument_kind(token, asset),
            "volume": gecko_vol,
            "source": "gecko",
            "pools": covered,
            "displayed": displayed,
            "asset": asset,
        }

    # Pools included in a gecko sum, and which tokens hold them.
    holders: dict[str, list[dict]] = {}
    for row in rows.values():
        if row["source"] != "gecko":
            continue
        for pool in row["pools"]:
            holders.setdefault(str(pool["pairAddress"]).lower(), []).append(row)
    owners = {pool: owner_address(pool, group) for pool, group in holders.items()}

    lane_usd = {"equity": 0.0, "etf": 0.0, "preipo": 0.0}
    lane_any = {"equity": False, "etf": False, "preipo": False}
    lane_pools = {"equity": 0, "etf": 0, "preipo": 0}
    issuer_usd = {}
    issuer_any = {}
    issuer_with = {}

    def note_issuer(row: dict, kind: str, amount: float | None, counted_pool: bool) -> None:
        issuer = row["issuer"] or "unknown"
        bucket = issuer_usd.setdefault(issuer, {"equity": 0.0, "etf": 0.0, "preipo": 0.0})
        flags = issuer_any.setdefault(issuer, {"equity": False, "etf": False, "preipo": False})
        if amount is None:
            return
        bucket[kind] += amount
        flags[kind] = True

    counted: set[str] = set()
    with_by_kind = {"equity": 0, "etf": 0, "preipo": 0}
    ordered = sorted(rows.values(), key=lambda row: (0 if row["source"] != "gecko" else 1, row["address"].lower()))
    for row in ordered:
        kind = writer_kind(row["instrument"])
        if row["volume"] is not None:
            with_by_kind[kind] += 1
            issuer_with.setdefault(row["issuer"] or "unknown", {"equity": 0, "etf": 0, "preipo": 0})
            issuer_with[row["issuer"] or "unknown"][kind] += 1
        if row["source"] != "gecko":
            if row["volume"] is None:
                continue
            # The other side already measured this pool from hourly candles.
            pool_keys = [
                str(pool.get("pairAddress") or "").lower()
                for pool in row["pools"]
                if isinstance(pool, dict) and pool.get("pairAddress")
            ]
            if pool_keys and all(key in owners for key in pool_keys):
                continue
            lane_usd[kind] += float(row["volume"])
            lane_any[kind] = True
            lane_pools[kind] += len(row["pools"])
            for key in pool_keys:
                counted.add(key)
            note_issuer(row, kind, float(row["volume"]), True)
            continue
        added = 0.0
        added_any = False
        pools_n = 0
        for pool in row["pools"]:
            key = str(pool["pairAddress"]).lower()
            if key in counted:
                continue
            if owners.get(key, row["address"].lower()) != row["address"].lower():
                continue
            counted.add(key)
            pools_n += 1
            vol = pool.get("volume24hUsd")
            if vol is None:
                continue
            added += float(vol)
            added_any = True
        if added_any:
            lane_usd[kind] += added
            lane_any[kind] = True
            note_issuer(row, kind, added, True)
        lane_pools[kind] += pools_n

    def lane_value(kind: str) -> float | None:
        if not lane_any[kind]:
            return None
        return round_usd(lane_usd[kind])

    equity = lane_value("equity")
    etf = lane_value("etf")
    private = lane_value("preipo")
    legs = [value for value in (equity, etf, private) if value is not None]
    record["publicEquity24hUsd"] = equity
    record["etfIndex24hUsd"] = etf
    record["private24hUsd"] = private
    record["combined24hUsd"] = round_usd(sum(legs)) if legs else None
    record["publicPoolCount"] = lane_pools["equity"]
    record["etfPoolCount"] = lane_pools["etf"]
    record["preipoPoolCount"] = lane_pools["preipo"]
    record["withVolumeEquityCount"] = with_by_kind["equity"]

    issuers = []
    for issuer_row in record.get("issuers") or []:
        if not isinstance(issuer_row, dict):
            continue
        issuer = issuer_row.get("issuer")
        usd = issuer_usd.get(issuer, {})
        flags = issuer_any.get(issuer, {})
        withs = issuer_with.get(issuer, {})
        issuer_row["publicEquity24hUsd"] = round_usd(usd["equity"]) if flags.get("equity") else None
        issuer_row["etfIndex24hUsd"] = round_usd(usd["etf"]) if flags.get("etf") else None
        issuer_row["private24hUsd"] = round_usd(usd["preipo"]) if flags.get("preipo") else None
        issuer_row["withVolumeEquityCount"] = withs.get("equity", 0)
        issuer_row["withVolumeCount"] = withs.get("equity", 0) + withs.get("etf", 0) + withs.get("preipo", 0)
        issuers.append(issuer_row)
    record["issuers"] = issuers

    new_assets = []
    for row in rows.values():
        # Keep a row that has pools or a number, including a reported 0.
        if row["volume"] is None and not row["pools"]:
            continue
        new_assets.append(
            {
                "address": row["address"],
                "symbol": row["symbol"],
                "issuer": row["issuer"],
                "instrumentKind": row["instrument"],
                "volume24hUsd": None if row["volume"] is None else round_usd(float(row["volume"])),
                "displayedLiquidityUsd": row["displayed"] if isinstance(row["displayed"], (int, float)) else None,
                "pools": row["pools"],
            }
        )
    new_assets.sort(key=lambda item: (item["symbol"].upper(), str(item["address"]).lower()))
    record["assets"] = new_assets

    hits = []
    for row in rows.values():
        if row["volume"] is None:
            continue
        hits.append(
            {
                "symbol": row["symbol"],
                "issuer": row["issuer"],
                "kind": writer_kind(row["instrument"]),
                "address": row["address"],
                "volume24hUsd": round_usd(float(row["volume"])),
            }
        )
    hits.sort(key=lambda item: (-item["volume24hUsd"], item["issuer"], item["symbol"].upper()))
    record["symbolsWithVolume"] = hits

    notes = list(record.get("notes") or [])
    note = (
        "Backfilled from GeckoTerminal hourly candles summed on the America/New_York day. "
        "Tokens or pools GeckoTerminal could not cover keep that day's DexScreener value. "
        "A pool on two tracked tokens counts once."
    )
    if note not in notes:
        notes.append(note)
    record["notes"] = notes
    record["backfillSource"] = BACKFILL_SOURCE
    record["originalCombined24hUsd"] = original
    return gaps


def window(records: list[dict], start: str, end: str) -> float:
    total = 0.0
    for record in records:
        if start <= record["date"] <= end and isinstance(record.get("combined24hUsd"), (int, float)):
            total += float(record["combined24hUsd"])
    return round_usd(total)


def main() -> int:
    payload = json.loads(SNAPSHOT.read_text())
    records = payload.get("records")
    if not isinstance(records, list):
        print("backfill: base.json has no records", file=sys.stderr)
        return 1
    catalog = load_catalog()
    caches = load_caches()
    ok = sum(1 for row in caches.values() if row.get("ok"))
    missed = sum(1 for row in caches.values() if not row.get("ok"))
    print(f"backfill caches ok={ok} miss={missed} catalog={len(catalog)}", flush=True)
    days = set(day_keys())
    gaps: list[str] = []
    replaced = 0
    for record in records:
        if not isinstance(record, dict) or record.get("date") not in days:
            continue
        before = record.get("combined24hUsd")
        day_gaps = backfill_record(record, catalog, caches)
        gaps.extend(day_gaps)
        replaced += 1
        print(
            f"backfill {record['date']} {before} -> {record.get('combined24hUsd')} "
            f"equity={record.get('publicEquity24hUsd')} etf={record.get('etfIndex24hUsd')} "
            f"private={record.get('private24hUsd')}",
            flush=True,
        )
    if replaced != len(days):
        print(f"backfill: expected {len(days)} days, rewrote {replaced}", file=sys.stderr)
        return 1
    outside = [record.get("date") for record in records if isinstance(record, dict) and record.get("date") not in days]
    print(f"backfill left outside range: {outside}", flush=True)
    print(f"backfill Sep28-Oct4 {window(records, '2026-09-28', '2026-10-04')}", flush=True)
    print(f"backfill Oct1-7 {window(records, '2026-10-01', '2026-10-07')}", flush=True)
    sep30 = next(record for record in records if record.get("date") == "2026-09-30")
    print(f"backfill Sep30 {sep30.get('combined24hUsd')}", flush=True)
    # Unique gap lines, capped in the log.
    uniq = list(dict.fromkeys(gaps))
    print(f"backfill gaps {len(uniq)}", flush=True)
    for line in uniq[:40]:
        print(f"gap {line}", flush=True)
    payload["records"] = records
    SNAPSHOT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"backfill wrote {SNAPSHOT}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
