#!/usr/bin/env python3
"""One-time BNB backfill for Eastern days 2026-09-23 through 2026-10-08.

Cliff approved this override of the nightly DexScreener h24 sample.
Each known pool's GeckoTerminal hourly volume is summed over the
America/New_York calendar day (midnight through the next midnight).
Eastern midnight is a whole UTC hour. Pools whose saved liquidity is
under $1,000 are left out (wash). A pool with no hourly coverage keeps
the original per-pool figure when that day stored one, and is named on
backfillGaps.

Does not write other chains and does not change BNB rows outside the range.
pPOLY/United Stables wash pools are never counted, same as the nightly writer.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from et_closed_day import volume_pool_excluded  # noqa: E402

EASTERN = ZoneInfo("America/New_York")
FROM_DAY = "2026-09-23"
THROUGH_DAY = "2026-10-08"
BACKFILL_SOURCE = "geckoterminal-hourly"
MIN_LIQUIDITY_USD = 1000.0
ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = Path(os.environ.get("BNB_BACKFILL_SNAPSHOT") or (ROOT / "data" / "volume-snapshots" / "bnb.json"))
POOLS = Path(os.environ.get("BNB_POOLS_FILE") or (ROOT / "data" / "volume-snapshots" / "bnb-pools.json"))
CACHE = Path(os.environ.get("BNB_OHLCV_CACHE") or "/tmp/bnb-audit/cache/ohlcv")
GECKO_OHLCV = "https://api.geckoterminal.com/api/v2/networks/bsc/pools/{pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd"
# Same cash / wrapped-native set the writer uses. A pool quoted in another stock
# counts only when both mints are in the catalog, and then only once.
CASH_QUOTES = {
    "0x55d398326f99059ff775485246999027b3197955",  # USDT
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",  # USDC
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",  # WBNB
    "0xe9e7cea3dedca5984780bafc599bd69add087d56",  # BUSD
    "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",  # FDUSD
    "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",  # DAI
    "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",  # USD1
    "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",  # BTCB
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8",  # ETH
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "0x0000000000000000000000000000000000000000",
}

KIND_TO_INSTRUMENT = {"equity": "equity", "etf": "etf", "preipo": "private", "private": "private"}
INSTRUMENT_TO_KIND = {"equity": "equity", "etf": "etf", "private": "preipo"}
LANE_FIELD = {"equity": "equity", "etf": "etf", "preipo": "private"}


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


def sum_nullable(values: list[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return round_usd(sum(present))


def normalize_kind(raw: str) -> str:
    text = (raw or "").lower()
    if text.startswith("equity"):
        return "equity"
    if text == "etf":
        return "etf"
    if text in {"private", "preipo"}:
        return "preipo"
    return "equity"


def load_catalog() -> dict[str, dict]:
    payload = json.loads(POOLS.read_text())
    tokens = payload.get("tokens") or {}
    catalog: dict[str, dict] = {}
    for key, row in tokens.items():
        if not isinstance(row, dict):
            continue
        address = str(row.get("address") or key)
        kind = normalize_kind(str(row.get("kind") or "equity"))
        pools = []
        for pool in row.get("pools") or []:
            if not isinstance(pool, dict):
                continue
            pair = str(pool.get("pairAddress") or "")
            if not pair.startswith("0x"):
                continue
            reserve = pool.get("reserveUsd")
            try:
                reserve_n = float(reserve) if reserve is not None else None
            except (TypeError, ValueError):
                reserve_n = None
            if reserve_n is not None and reserve_n < MIN_LIQUIDITY_USD:
                continue
            pools.append(
                {
                    "pairAddress": pair,
                    "dexId": str(pool.get("dexId") or "unknown") or "unknown",
                    "uniswapV4": bool(pool.get("uniswapV4")),
                }
            )
        if not pools:
            continue
        catalog[address.lower()] = {
            "address": address,
            "symbol": str(row.get("symbol") or ""),
            "issuer": str(row.get("issuer") or ""),
            "kind": kind,
            "pools": pools,
        }
    return catalog


def pool_meta(pool: str) -> tuple[str, str]:
    path = CACHE / f"{pool.lower()}.json"
    if not path.exists():
        return "", ""
    try:
        meta = json.loads(path.read_text()).get("meta") or {}
    except (OSError, json.JSONDecodeError):
        return "", ""
    base = str((meta.get("base") or {}).get("address") or "").lower()
    quote = str((meta.get("quote") or {}).get("address") or "").lower()
    return base, quote


def load_candles(pool: str, cache: dict[str, list[tuple[int, float]] | None]) -> list[tuple[int, float]] | None:
    """Hourly (timestamp, usd) bars. None means the pool has no coverage. [] means an empty series."""
    key = pool.lower()
    if key in cache:
        return cache[key]
    path = CACHE / f"{key}.json"
    if not path.exists():
        path = CACHE / f"{pool}.json"
    rows = None
    if path.exists():
        try:
            payload = json.loads(path.read_text())
            rows = payload["data"]["attributes"]["ohlcv_list"]
        except (OSError, json.JSONDecodeError, KeyError, TypeError):
            rows = None
    if isinstance(rows, list):
        candles: list[tuple[int, float]] = []
        for row in rows:
            if not isinstance(row, list) or len(row) < 6:
                continue
            try:
                ts = int(row[0])
                vol = float(row[5])
            except (TypeError, ValueError):
                continue
            if ts > 0 and vol >= 0 and vol == vol:
                candles.append((ts, vol))
        cache[key] = candles
        return candles
    fetched = fetch_ohlcv(pool)
    cache[key] = fetched
    return fetched


def fetch_ohlcv(pool: str) -> list[tuple[int, float]] | None:
    url = GECKO_OHLCV.format(pool=pool)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; BnbVolumeBackfill/1.0)"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode())
        rows = payload["data"]["attributes"]["ohlcv_list"]
    except Exception as exc:  # noqa: BLE001
        print(f"warn ohlcv {pool}: {exc}", file=sys.stderr)
        return None
    candles = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, list) or len(row) < 6:
            continue
        try:
            candles.append((int(row[0]), float(row[5])))
        except (TypeError, ValueError):
            continue
    time.sleep(2.1)
    return candles


def volume_on_day(candles: list[tuple[int, float]] | None, day: str) -> float | None:
    """USD in [midnight, next midnight). None when the pool was not listed that day or has no series."""
    if not candles:
        return None
    start = eastern_midnight(day)
    end = eastern_midnight(next_day(day))
    times = [ts for ts, _vol in candles]
    if not times or min(times) >= end or max(times) < start:
        return None
    by_open: dict[int, float] = {}
    for ts, vol in candles:
        if start <= ts < end:
            by_open[ts] = vol
    return round_usd(sum(by_open.values()))


def original_pool_volume(record: dict, token: str, pool: str) -> float | None:
    for asset in record.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        if str(asset.get("address") or "").lower() != token:
            continue
        for row in asset.get("pools") or []:
            if not isinstance(row, dict):
                continue
            if str(row.get("pairAddress") or "").lower() != pool.lower():
                continue
            vol = row.get("volume24hUsd")
            if isinstance(vol, (int, float)) and not isinstance(vol, bool) and vol >= 0:
                return float(vol)
    return None


def original_assets_outside(record: dict, covered: set[str]) -> list[dict]:
    """Long-tail mints this day stored that the known-pool recompute does not cover."""
    found = []
    for asset in record.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        addr = str(asset.get("address") or "").lower()
        if not addr.startswith("0x") or addr in covered:
            continue
        vol = asset.get("volume24hUsd")
        if not isinstance(vol, (int, float)) or isinstance(vol, bool):
            continue
        clone = json.loads(json.dumps(asset))
        clone["poolCount"] = len(clone.get("pools") or [])
        for pool in clone.get("pools") or []:
            if isinstance(pool, dict) and "source" not in pool:
                pool["source"] = "original"
        found.append(clone)
    return found


def issuers_by_lane(assets: list[dict], original: dict | None) -> dict[str, dict]:
    lanes: dict[str, dict[str, dict]] = {"equity": {}, "etf": {}, "private": {}}
    grouped: dict[tuple[str, str], list[dict]] = {}
    for asset in assets:
        kind = INSTRUMENT_TO_KIND.get(str(asset.get("instrumentKind") or "equity"), "equity")
        field = LANE_FIELD[kind]
        issuer = str(asset.get("issuer") or "unknown")
        grouped.setdefault((field, issuer), []).append(asset)
    original_lanes = original if isinstance(original, dict) else {}
    for (field, issuer), group in grouped.items():
        prior = {}
        if isinstance(original_lanes.get(field), dict):
            prior = original_lanes[field].get(issuer) or {}
        prior_mints = prior.get("mints") if isinstance(prior, dict) else None
        mints = len(group)
        if isinstance(prior_mints, int) and prior_mints > mints:
            mints = prior_mints
        lanes[field][issuer] = {
            "usd": sum_nullable([asset.get("volume24hUsd") for asset in group]),
            "mints": mints,
            "pools": sum(int(asset.get("poolCount") or 0) for asset in group),
        }
    # Quiet issuers the original night listed, with no covered pools this recompute.
    for field, bucket in original_lanes.items():
        if field not in lanes or not isinstance(bucket, dict):
            continue
        for issuer, stats in bucket.items():
            if issuer in lanes[field] or not isinstance(stats, dict):
                continue
            lanes[field][issuer] = {
                "usd": None,
                "mints": stats.get("mints") if isinstance(stats.get("mints"), int) else 0,
                "pools": 0,
            }
    return {field: dict(sorted(lanes[field].items())) for field in ("equity", "etf", "private")}


def rebuild(record: dict, catalog: dict[str, dict], cache: dict[str, list[tuple[int, float]] | None]) -> dict:
    day = str(record.get("date"))
    gaps: list[dict] = []
    assets: list[dict] = []
    excluded_notes: list[str] = []
    for token, meta in catalog.items():
        pool_rows = []
        volumes: list[float | None] = []
        liquidities: list[float | None] = []
        for pool in meta["pools"]:
            pair = pool["pairAddress"]
            base, quote = pool_meta(pair)
            if volume_pool_excluded(pair, base, quote):
                excluded_notes.append(
                    f"excluded-pool:{meta['symbol']}:{pair.lower()}:united-stables-wash"
                )
                continue
            cash = (not base and not quote) or base in CASH_QUOTES or quote in CASH_QUOTES
            crossed = base in catalog and quote in catalog
            if base and quote and not cash and not crossed:
                continue
            if crossed and not cash and base != token:
                # Count a stock-vs-stock pool once, on the base mint.
                continue
            candles = load_candles(pair, cache)
            if candles is None:
                kept = original_pool_volume(record, token, pair)
                gaps.append({"date": day, "pool": pair, "symbol": meta["symbol"], "note": "kept original pool slice" if kept is not None else "no gecko coverage and no original pool slice"})
                if kept is None:
                    continue
                volumes.append(kept)
                pool_rows.append(
                    {
                        "pairAddress": pair,
                        "dexId": pool["dexId"],
                        "volume24hUsd": round_usd(kept),
                        "liquidityUsd": None,
                        "source": "original",
                    }
                )
                continue
            vol = volume_on_day(candles, day)
            if vol is None:
                continue
            volumes.append(vol)
            pool_rows.append(
                {
                    "pairAddress": pair,
                    "dexId": pool["dexId"],
                    "volume24hUsd": vol,
                    "liquidityUsd": None,
                    "source": BACKFILL_SOURCE,
                }
            )
        if not pool_rows:
            continue
        asset = {
            "address": meta["address"],
            "symbol": meta["symbol"],
            "issuer": meta["issuer"],
            "instrumentKind": KIND_TO_INSTRUMENT[meta["kind"]],
            "volume24hUsd": sum_nullable(volumes),
            "displayedLiquidityUsd": sum_nullable(liquidities),
            "poolCount": len(pool_rows),
            "pools": pool_rows,
        }
        assets.append(asset)
    covered = {token for token in catalog}
    assets.extend(original_assets_outside(record, covered))
    assets.sort(key=lambda item: (str(item.get("symbol") or "").upper(), str(item.get("address") or "").lower()))

    def lane_total(kind: str) -> float | None:
        instrument = KIND_TO_INSTRUMENT[kind]
        return sum_nullable(
            [asset.get("volume24hUsd") for asset in assets if asset.get("instrumentKind") == instrument]
        )

    def lane_pools(kind: str) -> int:
        instrument = KIND_TO_INSTRUMENT[kind]
        return sum(int(asset.get("poolCount") or 0) for asset in assets if asset.get("instrumentKind") == instrument)

    equity = lane_total("equity")
    etf = lane_total("etf")
    private = lane_total("preipo")
    rebuilt = dict(record)
    rebuilt["publicEquity24hUsd"] = equity
    rebuilt["etfIndex24hUsd"] = etf
    rebuilt["private24hUsd"] = private
    rebuilt["combined24hUsd"] = sum_nullable([equity, etf, private])

    def kept_original(original_key: str, live_key: str):
        # A second pass must not replace the pre-backfill lane with the first correction.
        if original_key in record:
            return record.get(original_key)
        return record.get(live_key)

    rebuilt["originalPublicEquity24hUsd"] = kept_original("originalPublicEquity24hUsd", "publicEquity24hUsd")
    rebuilt["originalEtfIndex24hUsd"] = kept_original("originalEtfIndex24hUsd", "etfIndex24hUsd")
    rebuilt["originalPrivate24hUsd"] = kept_original("originalPrivate24hUsd", "private24hUsd")
    rebuilt["originalCombined24hUsd"] = kept_original("originalCombined24hUsd", "combined24hUsd")
    rebuilt["issuersByLane"] = issuers_by_lane(assets, record.get("issuersByLane") if isinstance(record.get("issuersByLane"), dict) else None)
    rebuilt["assets"] = assets
    rebuilt["publicPoolCount"] = lane_pools("equity")
    rebuilt["etfPoolCount"] = lane_pools("etf")
    rebuilt["preipoPoolCount"] = lane_pools("preipo")
    rebuilt["withVolumeEquityCount"] = sum(
        1 for asset in assets if asset.get("instrumentKind") == "equity" and asset.get("volume24hUsd") is not None
    )
    rebuilt["backfillSource"] = BACKFILL_SOURCE
    rebuilt["backfilledAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    note = (
        "GeckoTerminal hourly volume summed midnight-to-midnight America/New_York. "
        "Pools with reported liquidity under $1000 are excluded. "
        "A pool with no hourly coverage keeps its original slice when this day stored one."
    )
    if excluded_notes:
        note = note + " " + "; ".join(excluded_notes)
    rebuilt["backfillNote"] = note
    if gaps:
        # load_candles appends a generic gap and the caller appends a dated one. Keep the dated rows.
        rebuilt["backfillGaps"] = [gap for gap in gaps if gap.get("date") == day]
    return rebuilt


def main() -> int:
    for day in day_keys():
        midnight = eastern_midnight(day)
        if midnight % 3600 != 0:
            print(f"backfill:bnb failed: {day} midnight is not a whole UTC hour ({midnight})", file=sys.stderr)
            return 1
    payload = json.loads(SNAPSHOT.read_text())
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list):
        print("backfill:bnb failed: snapshot has no records", file=sys.stderr)
        return 1
    catalog = load_catalog()
    cache: dict[str, list[tuple[int, float]] | None] = {}
    wanted = set(day_keys())
    rebuilt_rows = []
    for record in records:
        if not isinstance(record, dict) or record.get("date") not in wanted:
            rebuilt_rows.append(record)
            continue
        rebuilt_rows.append(rebuild(record, catalog, cache))
    rebuilt_rows.sort(key=lambda row: str(row.get("date") or "") if isinstance(row, dict) else "")
    payload["records"] = rebuilt_rows
    SNAPSHOT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"backfill:bnb wrote {FROM_DAY}..{THROUGH_DAY} tokens={len(catalog)} -> {SNAPSHOT}", flush=True)
    for record in rebuilt_rows:
        if not isinstance(record, dict) or record.get("date") not in wanted:
            continue
        print(
            f"{record['date']} combined={record.get('combined24hUsd')} "
            f"was={record.get('originalCombined24hUsd')} "
            f"equity={record.get('publicEquity24hUsd')} etf={record.get('etfIndex24hUsd')} "
            f"private={record.get('private24hUsd')} assets={len(record.get('assets') or [])} "
            f"gaps={len(record.get('backfillGaps') or [])}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
