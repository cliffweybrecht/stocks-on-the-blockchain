#!/usr/bin/env python3
"""GeckoTerminal pool discovery and exact America/New_York day volume for Base.

The nightly Base row for day D is the sum, over every known pool, of
GeckoTerminal hourly USD candles whose open falls in
[00:00:00, next 00:00:00) America/New_York on D. That window is 24 hourly
candles, 23 on a spring-forward day, and 25 on a fall-back day.

Pool lists come from DexScreener token-pairs plus
GET /networks/base/tokens/{token}/pools. Pages are walked until a page is
short or its rolling h24 is all zero (Gecko sorts by activity; later pages
are dust). PR #412 has no Uniswap v4 PoolManager helper, so v4 and
PancakeSwap Infinity pools are whatever that token-pool list returns.
A pool is counted once, on the base token when both sides are tracked.
Meme and spam quotes are kept. Callers report that volume separately.

A pool whose OHLCV response is empty keeps that pool's DexScreener h24
and is recorded on the row. GeckoTerminal stays under 30 requests/minute.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from gecko_http import GeckoHttpClient

EASTERN = ZoneInfo("America/New_York")
WINDOW_SOURCE = "geckoterminal-hourly-et-day"
BACKFILL_SOURCE = "geckoterminal-hourly-et-day-2026-10-09"
GECKO_BASE = "https://api.geckoterminal.com/api/v2"
GECKO_POOLS = (
    GECKO_BASE
    + "/networks/base/tokens/{addr}/pools?page={page}&include=base_token,quote_token,dex"
)
GECKO_OHLCV = (
    GECKO_BASE
    + "/networks/base/pools/{pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd"
)
# 2.1s is about 28 requests/minute, under the published 30/minute cap.
GECKO_MIN_INTERVAL_S = 2.1
GECKO_MAX_PAGES = 10
POOL_CACHE_TTL_S = 7 * 24 * 3600
OHLCV_CACHE_TTL_S = 6 * 3600
UA = {"User-Agent": "Mozilla/5.0 (compatible; BaseVolumeSnapshot/1.0)", "Accept": "application/json"}

# Quote classification is for the report only. These pools are still summed.
CASH_QUOTES = {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",  # USDC
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",  # USDbC
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",  # DAI
    "0x4200000000000000000000000000000000000006",  # WETH
    "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",  # cbBTC
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",  # USDT
    "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",  # EURC
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "0x0000000000000000000000000000000000000000",
}
CASH_SYMBOLS = {
    "USDC",
    "USDT",
    "DAI",
    "USDBC",
    "WETH",
    "ETH",
    "CBBTC",
    "EURC",
    "USDS",
    "GHO",
    "CRVUSD",
    "USD+",
}

KIND_TO_INSTRUMENT = {"equity": "equity", "etf": "etf", "preipo": "private", "private": "private"}
INSTRUMENT_TO_KIND = {"equity": "equity", "etf": "etf", "private": "preipo"}
LANE_FIELD = {"equity": "publicEquity24hUsd", "etf": "etfIndex24hUsd", "preipo": "private24hUsd"}
POOL_KEEP_FIELDS = (
    "baseToken",
    "quoteToken",
    "baseSymbol",
    "quoteSymbol",
    "listedOnDex",
    "source",
)


def round_usd(value: float) -> float:
    return round(value + 1e-9, 2)


def next_day(day: str) -> str:
    return (date.fromisoformat(day) + timedelta(days=1)).isoformat()


def eastern_midnight(day: str) -> int:
    year, month, day_n = (int(part) for part in day.split("-"))
    return int(datetime(year, month, day_n, tzinfo=EASTERN).timestamp())


def expected_window_hours(day: str) -> int:
    """Hourly candles in [midnight, next midnight). 23 or 25 on a DST change."""
    return (eastern_midnight(next_day(day)) - eastern_midnight(day)) // 3600


def _candle_open_volume(row: Any) -> tuple[int, float] | None:
    if isinstance(row, (list, tuple)):
        if len(row) >= 6:
            opened, volume = row[0], row[5]
        elif len(row) >= 2:
            opened, volume = row[0], row[1]
        else:
            return None
    elif isinstance(row, dict):
        opened = row.get("t")
        volume = row.get("volumeUsd")
        if volume is None:
            volume = row.get("volume")
    else:
        return None
    try:
        t = int(opened)
        vol = float(volume)
    except (TypeError, ValueError):
        return None
    if t <= 0 or vol < 0 or vol != vol:
        return None
    return t, vol


def candle_map(candles: list[Any] | None) -> dict[int, float]:
    """Duplicate opens keep the last volume, matching the TypeScript summer."""
    found: dict[int, float] = {}
    for row in candles or []:
        parsed = _candle_open_volume(row)
        if parsed is None:
            continue
        found[parsed[0]] = parsed[1]
    return found


def series_covers_day(candles: list[Any] | None, day: str) -> bool:
    by_open = candle_map(candles)
    if not by_open:
        return False
    start = eastern_midnight(day)
    end = eastern_midnight(next_day(day))
    if any(start <= t < end for t in by_open):
        return True
    return min(by_open) <= start <= max(by_open)


def volume_on_day(candles: list[Any] | None, day: str) -> tuple[float, int]:
    start = eastern_midnight(day)
    end = eastern_midnight(next_day(day))
    chosen = {t: vol for t, vol in candle_map(candles).items() if start <= t < end}
    return round_usd(sum(chosen.values())), len(chosen)


def oldest_candle(candles_by_pool: dict[str, list]) -> int | None:
    oldest: int | None = None
    for candles in candles_by_pool.values():
        opens = candle_map(candles)
        if not opens:
            continue
        first = min(opens)
        oldest = first if oldest is None else min(oldest, first)
    return oldest


def day_in_coverage(day: str, oldest: int | None) -> bool:
    """True when some pool's hourly history reaches this Eastern day."""
    if oldest is None:
        return False
    return oldest < eastern_midnight(next_day(day))


def _non_negative(raw: Any) -> float | None:
    if raw is None or isinstance(raw, bool):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0 or value != value:
        return None
    return value


def _side(rel: dict, included: dict[str, dict], name: str) -> tuple[str, str]:
    data = ((rel.get(name) or {}).get("data") or {})
    if not isinstance(data, dict):
        return "", ""
    item = included.get(str(data.get("id") or "")) or {}
    attrs = item.get("attributes") if isinstance(item.get("attributes"), dict) else {}
    address = str(attrs.get("address") or "")
    if not address.startswith("0x"):
        ident = str(data.get("id") or "")
        if "_" in ident:
            address = ident.split("_", 1)[1]
    symbol = str(attrs.get("symbol") or "")
    return address.lower(), symbol


def parse_gecko_pools(payload: Any) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    included: dict[str, dict] = {}
    for item in payload.get("included") or []:
        if isinstance(item, dict) and item.get("id"):
            included[str(item["id"])] = item
    found: list[dict] = []
    for row in payload.get("data") or []:
        if not isinstance(row, dict):
            continue
        attrs = row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
        address = str(attrs.get("address") or "")
        if not address.startswith("0x"):
            ident = str(row.get("id") or "")
            if "_" in ident:
                address = ident.split("_", 1)[1]
        if not address.startswith("0x"):
            continue
        rel = row.get("relationships") if isinstance(row.get("relationships"), dict) else {}
        base, base_symbol = _side(rel, included, "base_token")
        quote, quote_symbol = _side(rel, included, "quote_token")
        dex = str(((rel.get("dex") or {}).get("data") or {}).get("id") or "") if isinstance(rel.get("dex"), dict) else ""
        volume = attrs.get("volume_usd") if isinstance(attrs.get("volume_usd"), dict) else {}
        found.append(
            {
                "pairAddress": address,
                "dexId": dex or "unknown",
                "baseToken": base,
                "quoteToken": quote,
                "baseSymbol": base_symbol,
                "quoteSymbol": quote_symbol,
                "h24": _non_negative(volume.get("h24")),
                "reserveUsd": _non_negative(attrs.get("reserve_in_usd")),
                "name": str(attrs.get("name") or ""),
            }
        )
    return found


def page_max_h24(pools: list[dict]) -> float:
    present = [pool["h24"] for pool in pools if pool.get("h24") is not None]
    if not present:
        return 0.0
    return max(present)


class GeckoClient:
    """One shared pace for every GeckoTerminal call. 429, 5xx, and timeouts retry."""

    def __init__(self, interval: float = GECKO_MIN_INTERVAL_S) -> None:
        self.interval = interval
        self.http = GeckoHttpClient(interval=interval, timeout=90)
        self.requests = 0
        self.retries = 0

    def wait(self) -> None:
        self.http._pace()

    def get_json(self, url: str, retries: int = 6) -> Any:
        self.http.max_attempts = max(1, retries)
        result = self.http.get_json(url)
        self.requests = self.http.requests
        self.retries = self.http.retries
        if result.ok:
            return result.body
        if result.reason == "not-found":
            return None
        raise RuntimeError(
            f"gecko fetch failed {url}: {result.reason} status={result.status} attempts={result.attempts}"
        )


def cache_path(root: Path, kind: str, key: str) -> Path:
    safe = key.lower().replace("/", "_")
    return root / kind / f"{safe}.json"


def load_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def discover_token_pools(client: GeckoClient, address: str, cache_root: Path, *, refresh: bool) -> list[dict]:
    path = cache_path(cache_root, "pools", address.lower())
    cached = load_json(path)
    if (
        not refresh
        and isinstance(cached, dict)
        and isinstance(cached.get("pools"), list)
        and time.time() - float(cached.get("fetchedAt") or 0) < POOL_CACHE_TTL_S
    ):
        return [pool for pool in cached["pools"] if isinstance(pool, dict)]
    pools: list[dict] = []
    for page in range(1, GECKO_MAX_PAGES + 1):
        url = GECKO_POOLS.format(addr=urllib.parse.quote(address), page=page)
        try:
            payload = client.get_json(url)
        except Exception as exc:  # noqa: BLE001
            print(f"warn gecko pools failed {address} page {page}: {exc}", flush=True)
            break
        if not isinstance(payload, dict):
            break
        raw = payload.get("data") if isinstance(payload.get("data"), list) else []
        parsed = parse_gecko_pools(payload)
        if not parsed:
            break
        # The list is sorted by activity. A page with no rolling h24 is dust.
        if page_max_h24(parsed) <= 0:
            break
        pools.extend(parsed)
        if len(raw) < 20:
            break
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"fetchedAt": time.time(), "pools": pools}) + "\n")
    return pools


def fetch_ohlcv(client: GeckoClient, pool: str, cache_root: Path, *, refresh: bool) -> list[list]:
    path = cache_path(cache_root, "ohlcv", pool.lower())
    cached = load_json(path)
    if (
        not refresh
        and isinstance(cached, dict)
        and cached.get("ok") is True
        and isinstance(cached.get("candles"), list)
        and time.time() - float(cached.get("fetchedAt") or 0) < OHLCV_CACHE_TTL_S
    ):
        return cached["candles"]
    url = GECKO_OHLCV.format(pool=urllib.parse.quote(pool, safe=""))
    candles: list[list] = []
    ok = False
    try:
        payload = client.get_json(url)
    except Exception as exc:  # noqa: BLE001
        print(f"warn gecko ohlcv failed {pool}: {exc}", flush=True)
        payload = False
    # None is a 404: the pool has no GeckoTerminal candles. Cache that so the
    # next run falls back to DexScreener without spending another request.
    if payload is None or isinstance(payload, dict):
        ok = True
        raw = []
        if isinstance(payload, dict):
            raw = ((payload.get("data") or {}).get("attributes") or {}).get("ohlcv_list") or []
        if isinstance(raw, list):
            for row in raw:
                parsed = _candle_open_volume(row)
                if parsed is not None:
                    candles.append([parsed[0], parsed[1]])
    if ok:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"fetchedAt": time.time(), "ok": True, "pool": pool, "candles": candles}) + "\n")
    return candles


def is_cash(address: str, symbol: str) -> bool:
    if address.lower() in CASH_QUOTES:
        return True
    return symbol.upper() in CASH_SYMBOLS


def pair_bucket(pool: dict, tracked: set[str]) -> str:
    """cash, stock (both sides tracked), other (kept meme/spam/unknown token), or unknown."""
    labels: list[str] = []
    for addr_key, sym_key in (("baseToken", "baseSymbol"), ("quoteToken", "quoteSymbol")):
        addr = str(pool.get(addr_key) or "").lower()
        symbol = str(pool.get(sym_key) or "")
        if addr in tracked:
            labels.append("tracked")
        elif addr and is_cash(addr, symbol):
            labels.append("cash")
        elif symbol and is_cash("", symbol):
            labels.append("cash")
        elif not addr and not symbol:
            labels.append("unknown")
        else:
            labels.append("other")
    if "other" in labels:
        return "other"
    if labels.count("tracked") >= 2:
        return "stock"
    if "cash" in labels and "tracked" in labels:
        return "cash"
    if "unknown" in labels:
        return "unknown"
    return "other"


def pool_owner(pool: dict, tokens: dict[str, dict]) -> str:
    """Count a pool once. The tracked base token owns it; otherwise the tracked quote."""
    tracked = set(tokens)
    base = str(pool.get("baseToken") or "").lower()
    quote = str(pool.get("quoteToken") or "").lower()
    if base in tracked:
        return base
    if quote in tracked:
        return quote
    holders = [addr for addr in pool.get("holders") or [] if addr in tracked]

    def rank(addr: str) -> tuple:
        token = tokens[addr]
        symbol = str(token.get("symbol") or "")
        wrapped = 1 if symbol.lower().startswith("wt") else 0
        coinbase = 0 if token.get("issuer") == "coinbase" else 1
        return (wrapped, coinbase, addr)

    if not holders:
        return ""
    return min(holders, key=rank)


def normalize_kind(raw: str) -> str:
    text = (raw or "").lower()
    if text in {"etf", "etfindex"}:
        return "etf"
    if text in {"preipo", "private"}:
        return "preipo"
    return "equity"


def token_row(address: str, symbol: str, issuer: str, kind: str) -> dict:
    return {
        "address": address,
        "symbol": symbol,
        "issuer": issuer or "unknown",
        "kind": normalize_kind(kind),
    }


def index_tokens(rows: list[dict], known: dict[str, dict], records: list[dict]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for row in rows:
        addr = str(row.get("address") or "")
        if addr.startswith("0x"):
            found[addr.lower()] = token_row(addr, str(row.get("symbol") or ""), str(row.get("issuer") or ""), str(row.get("kind") or ""))
    for key, row in known.items():
        if key in found or not str(row.get("address") or key).startswith("0x"):
            continue
        address = str(row.get("address") or key)
        found[address.lower()] = token_row(address, str(row.get("symbol") or ""), str(row.get("issuer") or ""), str(row.get("kind") or ""))
    for record in records:
        if not isinstance(record, dict):
            continue
        for asset in record.get("assets") or []:
            if not isinstance(asset, dict):
                continue
            addr = str(asset.get("address") or "")
            if not addr.startswith("0x") or addr.lower() in found:
                continue
            kind = INSTRUMENT_TO_KIND.get(str(asset.get("instrumentKind") or ""), "equity")
            found[addr.lower()] = token_row(addr, str(asset.get("symbol") or ""), str(asset.get("issuer") or ""), kind)
    return found


def merge_pool_meta(pools: dict[str, dict], pool: dict, holder: str, *, listed_on_dex: bool) -> None:
    key = str(pool.get("pairAddress") or "").lower()
    if not key.startswith("0x"):
        return
    current = pools.get(key)
    if current is None:
        current = {
            "pairAddress": pool.get("pairAddress"),
            "dexId": str(pool.get("dexId") or "unknown") or "unknown",
            "baseToken": str(pool.get("baseToken") or "").lower(),
            "quoteToken": str(pool.get("quoteToken") or "").lower(),
            "baseSymbol": str(pool.get("baseSymbol") or ""),
            "quoteSymbol": str(pool.get("quoteSymbol") or ""),
            "holders": [],
            "listedOnDex": listed_on_dex,
            "h24": pool.get("h24") if pool.get("h24") is not None else pool.get("volume24hUsd"),
            "reserveUsd": pool.get("reserveUsd") if pool.get("reserveUsd") is not None else pool.get("liquidityUsd"),
            "name": str(pool.get("name") or ""),
        }
        pools[key] = current
    else:
        dex = str(pool.get("dexId") or "")
        if dex and (current.get("dexId") in {None, "", "unknown", "uniswap"} or "v4" in dex or "infinity" in dex):
            if dex not in {"", "unknown"}:
                current["dexId"] = dex
        for field, source in (
            ("baseToken", "baseToken"),
            ("quoteToken", "quoteToken"),
            ("baseSymbol", "baseSymbol"),
            ("quoteSymbol", "quoteSymbol"),
            ("name", "name"),
        ):
            value = pool.get(source)
            if value and not current.get(field):
                current[field] = value.lower() if field.endswith("Token") else value
        if pool.get("h24") is not None and current.get("h24") is None:
            current["h24"] = pool["h24"]
        if pool.get("reserveUsd") is not None and current.get("reserveUsd") is None:
            current["reserveUsd"] = pool["reserveUsd"]
        if listed_on_dex:
            current["listedOnDex"] = True
    if holder and holder not in current["holders"]:
        current["holders"].append(holder)


def catalog_from_known(known: dict[str, dict], dex_listed: set[str]) -> dict[str, dict]:
    pools: dict[str, dict] = {}
    for holder, row in known.items():
        for key, pool in (row.get("pools") or {}).items():
            if not isinstance(pool, dict):
                continue
            merge_pool_meta(pools, pool, holder, listed_on_dex=key in dex_listed or bool(pool.get("listedOnDex")))
    return pools


def remember_discovered(known: dict[str, dict], tokens: dict[str, dict], pool: dict, *, listed_on_dex: bool) -> None:
    """Attach a pool to every tracked side. The file is the nightly pool-list cache."""
    pair = str(pool.get("pairAddress") or "")
    if not pair.startswith("0x"):
        return
    base = str(pool.get("baseToken") or "").lower()
    quote = str(pool.get("quoteToken") or "").lower()
    sides = [side for side in (base, quote) if side in tokens]
    if not sides:
        # Gecko named this token but the side id failed to parse. Keep it on the token we asked about.
        asked = str(pool.get("_token") or "").lower()
        if asked in tokens:
            sides = [asked]
    dex = str(pool.get("dexId") or "unknown") or "unknown"
    for side in sides:
        token = tokens[side]
        key = side
        row = known.get(key)
        if row is None:
            row = {
                "address": token["address"],
                "symbol": token["symbol"],
                "issuer": token["issuer"],
                "kind": token["kind"],
                "mainPool": None,
                "pools": {},
            }
            known[key] = row
        current = row["pools"].get(pair.lower())
        extra = {
            "pairAddress": pair,
            "dexId": dex,
            "baseToken": base,
            "quoteToken": quote,
            "baseSymbol": pool.get("baseSymbol") or "",
            "quoteSymbol": pool.get("quoteSymbol") or "",
            "listedOnDex": listed_on_dex,
            "source": "dexscreener" if listed_on_dex else "geckoterminal",
        }
        if current is None:
            row["pools"][pair.lower()] = extra
        else:
            if extra["dexId"] not in {"", "unknown"} and (
                current.get("dexId") in {None, "", "unknown", "uniswap"} or "v4" in extra["dexId"] or "infinity" in extra["dexId"]
            ):
                current["dexId"] = extra["dexId"]
            for field in ("baseToken", "quoteToken", "baseSymbol", "quoteSymbol"):
                if extra.get(field) and not current.get(field):
                    current[field] = extra[field]
            current["listedOnDex"] = bool(current.get("listedOnDex") or listed_on_dex)
            if not listed_on_dex and current.get("source") not in {"dexscreener"}:
                current["source"] = "geckoterminal"
            elif listed_on_dex:
                current["source"] = "dexscreener"


def discover_pools(
    tokens: dict[str, dict],
    known: dict[str, dict],
    dex_listed: set[str],
    client: GeckoClient,
    cache_root: Path,
    *,
    refresh: bool,
) -> dict[str, dict]:
    """Paginate GeckoTerminal for every tracked token and merge pools DexScreener missed."""
    before = {key for row in known.values() for key in (row.get("pools") or {})}
    ordered = sorted(tokens)
    for index, addr in enumerate(ordered, start=1):
        if index == 1 or index % 25 == 0:
            print(f"gecko pools {index}/{len(ordered)} {tokens[addr].get('symbol')}", flush=True)
        try:
            found = discover_token_pools(client, tokens[addr]["address"], cache_root, refresh=refresh)
        except Exception as exc:  # noqa: BLE001
            print(f"warn gecko pools skipped {tokens[addr].get('symbol')}: {exc}", flush=True)
            continue
        for pool in found:
            pool["_token"] = addr
            listed = str(pool.get("pairAddress") or "").lower() in dex_listed
            remember_discovered(known, tokens, pool, listed_on_dex=listed)
    after = {key for row in known.values() for key in (row.get("pools") or {})}
    print(
        f"gecko pools done tokens={len(ordered)} pools={len(after)} new_keys={len(after - before)} "
        f"requests={client.requests} retries={client.retries}",
        flush=True,
    )
    return catalog_from_known(known, dex_listed)


def fetch_candles(
    pools: dict[str, dict],
    client: GeckoClient,
    cache_root: Path,
    *,
    refresh: bool,
) -> dict[str, list]:
    candles: dict[str, list] = {}
    keys = sorted(pools)
    started = time.monotonic()
    for index, key in enumerate(keys, start=1):
        pool = pools[key]
        address = str(pool.get("pairAddress") or key)
        if index == 1 or index % 25 == 0 or index == len(keys):
            print(f"gecko ohlcv {index}/{len(keys)} elapsed={time.monotonic() - started:.0f}s", flush=True)
        candles[key] = fetch_ohlcv(client, address, cache_root, refresh=refresh)
    print(
        f"gecko ohlcv done pools={len(keys)} with_candles={sum(1 for rows in candles.values() if rows)} "
        f"elapsed={time.monotonic() - started:.0f}s requests={client.requests}",
        flush=True,
    )
    return candles


def stored_pool_volumes(record: dict) -> dict[str, float]:
    found: dict[str, float] = {}
    for asset in record.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        for pool in asset.get("pools") or []:
            if not isinstance(pool, dict):
                continue
            key = str(pool.get("pairAddress") or "").lower()
            vol = _non_negative(pool.get("volume24hUsd"))
            if key.startswith("0x") and vol is not None and key not in found:
                found[key] = vol
    return found


def stored_pool_liquidity(record: dict) -> dict[str, float]:
    found: dict[str, float] = {}
    for asset in record.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        for pool in asset.get("pools") or []:
            if not isinstance(pool, dict):
                continue
            key = str(pool.get("pairAddress") or "").lower()
            liq = _non_negative(pool.get("liquidityUsd"))
            if key.startswith("0x") and liq is not None and key not in found:
                found[key] = liq
    return found


def pool_window(
    pool_key: str,
    candles_by_pool: dict[str, list],
    day: str,
    dex_h24: float | None,
) -> tuple[float | None, str]:
    """Return (volume, source). source is gecko, dex-fallback, uncovered, or gap.

    Empty OHLCV falls back to DexScreener h24. Candles that do not reach this
    day contribute nothing: the pool was not trading in the window.
    """
    candles = candles_by_pool.get(pool_key) or []
    if candle_map(candles):
        if not series_covers_day(candles, day):
            return None, "uncovered"
        volume, _hours = volume_on_day(candles, day)
        return volume, "gecko"
    if dex_h24 is not None:
        return dex_h24, "dex-fallback"
    return None, "gap"


def fold_day(
    tokens: dict[str, dict],
    pools: dict[str, dict],
    candles_by_pool: dict[str, list],
    day: str,
    dex_h24: dict[str, float | None],
    liquidity: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Per-token sums plus lane totals. A two-sided pool counts once, on the base."""
    liquidity = liquidity or {}
    details: dict[str, list[dict]] = {addr: [] for addr in tokens}
    token_volume: dict[str, float] = {}
    token_any: dict[str, bool] = {addr: False for addr in tokens}
    lane_usd = {"equity": 0.0, "etf": 0.0, "preipo": 0.0}
    lane_any = {"equity": False, "etf": False, "preipo": False}
    lane_pools = {"equity": 0, "etf": 0, "preipo": 0}
    issuer_usd = {}
    issuer_any = {}
    issuer_with: dict[str, dict[str, int]] = {}
    fallbacks: list[dict] = []
    counted: set[str] = set()
    pool_rows: list[dict] = []

    for key in sorted(pools):
        pool = pools[key]
        owner = pool_owner(pool, tokens)
        if not owner:
            continue
        volume, source = pool_window(key, candles_by_pool, day, dex_h24.get(key))
        if source == "uncovered" or (source == "gap" and volume is None):
            continue
        holders = [addr for addr in pool.get("holders") or [] if addr in tokens]
        if owner not in holders:
            holders.append(owner)
        liq = liquidity.get(key)
        row = {
            "pairAddress": pool.get("pairAddress") or key,
            "dexId": pool.get("dexId") or "unknown",
            "volume24hUsd": None if volume is None else round_usd(float(volume)),
            "liquidityUsd": None if liq is None else round_usd(liq),
        }
        for addr in holders:
            details[addr].append(dict(row))
            if volume is None:
                continue
            token_any[addr] = True
            token_volume[addr] = token_volume.get(addr, 0.0) + float(volume)
        if source == "dex-fallback" and volume is not None:
            token = tokens[owner]
            fallbacks.append(
                {
                    "pairAddress": row["pairAddress"],
                    "dexId": row["dexId"],
                    "volume24hUsd": row["volume24hUsd"],
                    "symbol": token.get("symbol") or "",
                    "reason": "no-geckoterminal-candles",
                }
            )
        if key in counted or volume is None:
            continue
        counted.add(key)
        kind = tokens[owner]["kind"]
        lane_usd[kind] += float(volume)
        lane_any[kind] = True
        lane_pools[kind] += 1
        issuer = tokens[owner]["issuer"] or "unknown"
        bucket = issuer_usd.setdefault(issuer, {"equity": 0.0, "etf": 0.0, "preipo": 0.0})
        flags = issuer_any.setdefault(issuer, {"equity": False, "etf": False, "preipo": False})
        bucket[kind] += float(volume)
        flags[kind] = True
        pool_rows.append(
            {
                "key": key,
                "volume": float(volume),
                "source": source,
                "bucket": pair_bucket(pool, set(tokens)),
                "listedOnDex": bool(pool.get("listedOnDex")),
                "owner": owner,
                "dexId": pool.get("dexId") or "unknown",
                "baseSymbol": pool.get("baseSymbol") or "",
                "quoteSymbol": pool.get("quoteSymbol") or "",
                "name": pool.get("name") or "",
            }
        )

    def lane_value(kind: str) -> float | None:
        if not lane_any[kind]:
            return None
        return round_usd(lane_usd[kind])

    volumes = {addr: (round_usd(token_volume[addr]) if token_any[addr] else None) for addr in tokens}
    with_by_kind = {"equity": 0, "etf": 0, "preipo": 0}
    for addr, token in tokens.items():
        if volumes[addr] is None:
            continue
        with_by_kind[token["kind"]] += 1
        issuer_with.setdefault(token["issuer"] or "unknown", {"equity": 0, "etf": 0, "preipo": 0})
        issuer_with[token["issuer"] or "unknown"][token["kind"]] += 1
    equity = lane_value("equity")
    etf = lane_value("etf")
    private = lane_value("preipo")
    legs = [value for value in (equity, etf, private) if value is not None]
    return {
        "volumes": volumes,
        "details": details,
        "equity": equity,
        "etf": etf,
        "private": private,
        "combined": round_usd(sum(legs)) if legs else None,
        "lanePools": lane_pools,
        "withByKind": with_by_kind,
        "issuerUsd": issuer_usd,
        "issuerAny": issuer_any,
        "issuerWith": issuer_with,
        "fallbacks": fallbacks,
        "poolRows": pool_rows,
        "windowHours": expected_window_hours(day),
    }


def _asset_rows(tokens: dict[str, dict], folded: dict[str, Any], liquidity_display: dict[str, float | None]) -> list[dict]:
    assets = []
    for addr, token in tokens.items():
        pools = list(folded["details"].get(addr) or [])
        volume = folded["volumes"].get(addr)
        if volume is None and not pools:
            continue
        displayed_values = [pool.get("liquidityUsd") for pool in pools if pool.get("liquidityUsd") is not None]
        displayed = round_usd(sum(displayed_values)) if displayed_values else liquidity_display.get(addr)
        assets.append(
            {
                "address": token["address"],
                "symbol": token["symbol"],
                "issuer": token["issuer"],
                "instrumentKind": KIND_TO_INSTRUMENT.get(token["kind"], "equity"),
                "volume24hUsd": volume,
                "displayedLiquidityUsd": displayed,
                "pools": pools,
            }
        )
    assets.sort(key=lambda item: (str(item["symbol"]).upper(), str(item["address"]).lower()))
    return assets


def _hits(tokens: dict[str, dict], folded: dict[str, Any]) -> list[dict]:
    hits = []
    for addr, token in tokens.items():
        volume = folded["volumes"].get(addr)
        if volume is None:
            continue
        hits.append(
            {
                "symbol": token["symbol"],
                "issuer": token["issuer"],
                "kind": token["kind"],
                "address": token["address"],
                "volume24hUsd": volume,
            }
        )
    hits.sort(key=lambda item: (-item["volume24hUsd"], item["issuer"], str(item["symbol"]).upper()))
    return hits


NOTE = (
    "Eastern-day volume is the sum of GeckoTerminal hourly USD candles from "
    "00:00:00 through 23:59:59 America/New_York. A pool with no GeckoTerminal "
    "candles keeps that pool's DexScreener h24 and is listed on dexscreenerH24Fallbacks. "
    "A pool on two tracked tokens counts once. Pools DexScreener does not list are included."
)


def apply_folded_record(record: dict, tokens: dict[str, dict], folded: dict[str, Any], *, backfill: bool) -> None:
    previous = record.get("combined24hUsd")
    if "originalCombined24hUsd" in record and record.get("originalCombined24hUsd") is not None:
        original = record.get("originalCombined24hUsd")
    else:
        original = previous
    record["publicEquity24hUsd"] = folded["equity"]
    record["etfIndex24hUsd"] = folded["etf"]
    record["private24hUsd"] = folded["private"]
    record["combined24hUsd"] = folded["combined"]
    record["publicPoolCount"] = folded["lanePools"]["equity"]
    record["etfPoolCount"] = folded["lanePools"]["etf"]
    record["preipoPoolCount"] = folded["lanePools"]["preipo"]
    record["withVolumeEquityCount"] = folded["withByKind"]["equity"]
    record["windowSource"] = WINDOW_SOURCE
    record["windowHours"] = folded["windowHours"]
    record["dexscreenerH24Fallbacks"] = folded["fallbacks"]
    issuers = []
    seen = set()
    for issuer_row in record.get("issuers") or []:
        if not isinstance(issuer_row, dict):
            continue
        issuer = str(issuer_row.get("issuer") or "")
        seen.add(issuer)
        usd = folded["issuerUsd"].get(issuer, {})
        flags = folded["issuerAny"].get(issuer, {})
        withs = folded["issuerWith"].get(issuer, {})
        issuer_row["publicEquity24hUsd"] = round_usd(usd["equity"]) if flags.get("equity") else None
        issuer_row["etfIndex24hUsd"] = round_usd(usd["etf"]) if flags.get("etf") else None
        issuer_row["private24hUsd"] = round_usd(usd["preipo"]) if flags.get("preipo") else None
        issuer_row["withVolumeEquityCount"] = withs.get("equity", 0)
        issuer_row["withVolumeCount"] = withs.get("equity", 0) + withs.get("etf", 0) + withs.get("preipo", 0)
        issuers.append(issuer_row)
    for issuer, usd in sorted(folded["issuerUsd"].items()):
        if issuer in seen:
            continue
        flags = folded["issuerAny"].get(issuer, {})
        withs = folded["issuerWith"].get(issuer, {})
        issuers.append(
            {
                "issuer": issuer,
                "publicEquity24hUsd": round_usd(usd["equity"]) if flags.get("equity") else None,
                "private24hUsd": round_usd(usd["preipo"]) if flags.get("preipo") else None,
                "etfIndex24hUsd": round_usd(usd["etf"]) if flags.get("etf") else None,
                "publicMintCount": 0,
                "preipoMintCount": 0,
                "etfMintCount": 0,
                "withVolumeEquityCount": withs.get("equity", 0),
                "withVolumeCount": withs.get("equity", 0) + withs.get("etf", 0) + withs.get("preipo", 0),
            }
        )
    record["issuers"] = issuers
    old_display: dict[str, float | None] = {}
    for asset in record.get("assets") or []:
        if isinstance(asset, dict):
            addr = str(asset.get("address") or "").lower()
            shown = asset.get("displayedLiquidityUsd")
            if addr and isinstance(shown, (int, float)) and not isinstance(shown, bool):
                old_display[addr] = float(shown)
    record["assets"] = _asset_rows(tokens, folded, old_display)
    record["symbolsWithVolume"] = _hits(tokens, folded)
    notes = [note for note in (record.get("notes") or []) if isinstance(note, str)]
    if NOTE not in notes:
        notes.append(NOTE)
    record["notes"] = notes
    record["originalCombined24hUsd"] = original
    if backfill:
        record["backfillSource"] = BACKFILL_SOURCE
    sources = record.get("sources") if isinstance(record.get("sources"), dict) else {}
    sources["volume"] = (
        "GeckoTerminal hourly USD candles summed from 00:00:00 through 23:59:59 America/New_York "
        "across every known Base pool; pools DexScreener omits are discovered from "
        "networks/base/tokens/{token}/pools; a pool with no candles falls back to DexScreener h24 "
        "for that pool; a pool with two tracked tokens counts once, on the base token"
    )
    record["sources"] = sources
    record.pop("volumeDropWarnings", None)


def recheck_records(
    records: list[dict],
    tokens: dict[str, dict],
    pools: dict[str, dict],
    candles_by_pool: dict[str, list],
) -> list[dict]:
    """Replace every covered Base row in place. Returns the before/after table."""
    oldest = oldest_candle(candles_by_pool)
    table = []
    for record in records:
        if not isinstance(record, dict):
            continue
        day = record.get("date")
        if not isinstance(day, str) or not day_in_coverage(day, oldest):
            continue
        before = record.get("combined24hUsd")
        folded = fold_day(
            tokens,
            pools,
            candles_by_pool,
            day,
            stored_pool_volumes(record),
            stored_pool_liquidity(record),
        )
        if folded["combined"] is None:
            table.append(
                {
                    "date": day,
                    "previous": before,
                    "combined": before,
                    "equity": record.get("publicEquity24hUsd"),
                    "etf": record.get("etfIndex24hUsd"),
                    "private": record.get("private24hUsd"),
                    "skipped": True,
                }
            )
            continue
        apply_folded_record(record, tokens, folded, backfill=True)
        table.append(
            {
                "date": day,
                "previous": before,
                "combined": record.get("combined24hUsd"),
                "equity": record.get("publicEquity24hUsd"),
                "etf": record.get("etfIndex24hUsd"),
                "private": record.get("private24hUsd"),
                "skipped": False,
                "fallbacks": len(folded["fallbacks"]),
                "windowHours": folded["windowHours"],
                "poolRows": folded["poolRows"],
            }
        )
    return table


def other_volume(pool_rows: list[dict]) -> dict[str, float]:
    """Volume kept from non-cash, non-stock pairs. Nothing in this bucket was excluded."""
    buckets = {"other": 0.0, "cash": 0.0, "stock": 0.0, "unknown": 0.0, "dexAbsent": 0.0, "dexAbsentOther": 0.0}
    for row in pool_rows:
        bucket = row.get("bucket") or "unknown"
        if bucket not in buckets:
            bucket = "unknown"
        buckets[bucket] += float(row.get("volume") or 0)
        if not row.get("listedOnDex"):
            buckets["dexAbsent"] += float(row.get("volume") or 0)
            if row.get("bucket") == "other":
                buckets["dexAbsentOther"] += float(row.get("volume") or 0)
    return {key: round_usd(value) for key, value in buckets.items()}


def dex_absent_pools(pools: dict[str, dict], already: set[str]) -> list[dict]:
    found = []
    for key, pool in pools.items():
        if pool.get("listedOnDex"):
            continue
        found.append(
            {
                "pairAddress": pool.get("pairAddress") or key,
                "dexId": pool.get("dexId") or "unknown",
                "baseSymbol": pool.get("baseSymbol") or "",
                "quoteSymbol": pool.get("quoteSymbol") or "",
                "name": pool.get("name") or "",
                "newToFile": key not in already,
            }
        )
    return found


def pools_file_fetched_at(path: Path) -> str | None:
    data = load_json(path)
    if isinstance(data, dict) and isinstance(data.get("geckoPoolsFetchedAt"), str):
        return data["geckoPoolsFetchedAt"]
    return None


def pool_list_is_fresh(fetched_at: str | None, *, refresh: bool) -> bool:
    if refresh or not fetched_at:
        return False
    try:
        stamp = datetime.fromisoformat(fetched_at.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return False
    return time.time() - stamp < POOL_CACHE_TTL_S


def cache_root() -> Path:
    raw = (os.environ.get("BASE_GECKO_CACHE") or "").strip()
    return Path(raw).expanduser() if raw else Path("/tmp/gecko-base-et")


def refresh_requested() -> bool:
    return (os.environ.get("BASE_GECKO_REFRESH_POOLS") or "").strip() == "1"
