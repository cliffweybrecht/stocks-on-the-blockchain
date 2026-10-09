#!/usr/bin/env python3
"""Closed America/New_York day volume from every pool.

DexScreener token-pairs plus the known-pools list are the fast sample.
GeckoTerminal token pools add pools DexScreener does not list (PancakeSwap
Infinity, Uniswap v4, and the Solana pools past the token-pairs cap). New
addresses are written back to the known-pools file.

The closed day sums GeckoTerminal hourly USD candles whose open falls in
[midnight, next midnight) America/New_York. Each pool counts once, on the
base desk token when both sides are tracked. A failed candle read keeps that
pool's DexScreener h24 and tags the row. A day is not blanked when either
source reported a number.

When the DexScreener and Gecko totals both exist and differ by more than 5%,
both are stored and the row is tagged.
"""

from __future__ import annotations

import json
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
CACHE = Path("/tmp/volume-audit/cache")
MIN_POOL_H24 = 100.0
GAP_FRACTION = 0.05
GECKO_GAP_S = 3.2
UA = {"accept": "application/json", "user-agent": "stocks-on-the-blockchain-closed-day/1.0"}

CHAIN_NETWORK = {
    "robinhood": "robinhood",
    "bnb": "bsc",
    "solana": "solana",
}

_next_gecko = 0.0


def eastern_midnight(day: str) -> int:
    year, month, day_n = (int(part) for part in day.split("-"))
    return int(datetime(year, month, day_n, tzinfo=EASTERN).timestamp())


def next_day(day: str) -> str:
    year, month, day_n = (int(part) for part in day.split("-"))
    return (datetime(year, month, day_n) + timedelta(days=1)).date().isoformat()


def canon(addr: str) -> str:
    text = (addr or "").strip()
    if text.startswith("0x") or text.startswith("0X"):
        return text.lower()
    return text


def is_perp(symbol: str, name: str = "") -> bool:
    """Spot lanes exclude perps. Perplexity is a company name, not a perp."""
    blob = f"{symbol} {name}"
    if symbol.upper().endswith("PERP"):
        return True
    if "perplexity" in blob.lower():
        return False
    import re

    return re.search(r"\b(?:perp|perps|perpetual)\b", blob, re.IGNORECASE) is not None


def sum_candles_for_day(candles: list[list[float]] | list[tuple[int, float]], day: str) -> tuple[float | None, bool]:
    """Return (volume, covered).

    None means the candle read failed or the series does not reach the day.
    Zero is a covered day with no trades.
    """
    by_open: dict[int, float] = {}
    for row in candles:
        try:
            opened = int(row[0])
            vol = float(row[1])
        except (TypeError, ValueError, IndexError):
            continue
        if opened > 0 and vol >= 0:
            by_open[opened] = vol
    if not by_open:
        return None, False
    start = eastern_midnight(day)
    end = eastern_midnight(next_day(day))
    oldest = min(by_open)
    newest = max(by_open)
    truncated = len(by_open) >= 990 and oldest > start
    if newest < start or oldest >= end or truncated:
        return None, False
    total = 0.0
    for opened, vol in by_open.items():
        if start <= opened < end:
            total += vol
    return round(total + 1e-9, 2), True


def gap_fraction(dex: float | None, gecko: float | None) -> float | None:
    if dex is None or gecko is None:
        return None
    base = max(abs(dex), abs(gecko), 1.0)
    return abs(dex - gecko) / base


def cross_check_tag(dex: float | None, gecko: float | None) -> str | None:
    gap = gap_fraction(dex, gecko)
    if gap is None or gap <= GAP_FRACTION:
        return None
    return "dex-gecko-gap"


def recipient(base: str, quote: str, universe: set[str]) -> str | None:
    """Count the pool once. Both desk tokens: the base token only."""
    base_key = canon(base)
    quote_key = canon(quote)
    if base_key in universe:
        return base_key
    if quote_key in universe:
        return quote_key
    return None


def choose_pool_volume(gecko_volume: float | None, gecko_ok: bool, dex_volume: float | None) -> tuple[float | None, str]:
    if gecko_ok and gecko_volume is not None:
        return gecko_volume, "geckoterminal-hourly-et"
    if dex_volume is not None:
        return dex_volume, "dexscreener-h24-fallback"
    return None, "uncovered"


def build_closed_totals(
    rows: list[dict],
    pools: list[dict],
) -> dict[str, Any]:
    """Sum unique pools into lanes.

    Each pool dict has pair, base, quote, dex_volume, gecko_volume, gecko_ok.
    """
    universe = {canon(str(row.get("address") or "")): row for row in rows if row.get("address")}
    universe_keys = set(universe)
    vols: dict[str, float | None] = {key: None for key in universe_keys}
    details: dict[str, list[dict]] = {key: [] for key in universe_keys}
    seen: set[str] = set()
    dex_parts: list[float] = []
    gecko_parts: list[float] = []
    sources: set[str] = set()
    uncovered = 0
    for pool in pools:
        pair = canon(str(pool.get("pair") or ""))
        if not pair or pair in seen:
            continue
        owner = recipient(str(pool.get("base") or ""), str(pool.get("quote") or ""), universe_keys)
        if owner is None:
            continue
        seen.add(pair)
        dex_volume = _num(pool.get("dex_volume"))
        gecko_volume, gecko_ok = pool.get("gecko_volume"), bool(pool.get("gecko_ok"))
        chosen, source = choose_pool_volume(
            gecko_volume if isinstance(gecko_volume, (int, float)) else None,
            gecko_ok,
            dex_volume,
        )
        # Gecko-only pools (Infinity, v4, past the token-pairs cap) are not a DexScreener total.
        if dex_volume is not None and not pool.get("from_gecko"):
            dex_parts.append(dex_volume)
        if gecko_ok and isinstance(gecko_volume, (int, float)):
            gecko_parts.append(float(gecko_volume))
        if chosen is None:
            uncovered += 1
            continue
        if source == "dexscreener-h24-fallback" and pool.get("from_gecko"):
            source = "geckoterminal-h24-fallback"
        sources.add(source)
        prev = vols.get(owner)
        vols[owner] = chosen if prev is None else prev + chosen
        details[owner].append(
            {
                "pairAddress": str(pool.get("pair") or pair),
                "dexId": str(pool.get("dex") or "unknown"),
                "volume24hUsd": round(chosen, 2),
                "liquidityUsd": _num(pool.get("liquidity")),
                "source": source,
            }
        )
    lanes = {"equity": None, "etf": None, "preipo": None}
    for row in rows:
        key = canon(str(row.get("address") or ""))
        kind = str(row.get("kind") or "")
        if kind not in lanes or key not in vols:
            continue
        vol = vols.get(key)
        if vol is None:
            continue
        lanes[kind] = vol if lanes[kind] is None else lanes[kind] + vol
    for key, vol in list(vols.items()):
        if vol is not None:
            vols[key] = round(vol, 2)
    for kind, vol in list(lanes.items()):
        if vol is not None:
            lanes[kind] = round(vol, 2)
    combined_parts = [lanes["equity"], lanes["preipo"], lanes["etf"]]
    combined = None
    if any(part is not None for part in combined_parts):
        combined = round(sum(part or 0.0 for part in combined_parts), 2)
    dex_combined = round(sum(dex_parts), 2) if dex_parts else None
    gecko_combined = round(sum(gecko_parts), 2) if gecko_parts else None
    source_order = (
        "geckoterminal-hourly-et",
        "geckoterminal-h24-fallback",
        "dexscreener-h24-fallback",
    )
    volume_source = "+".join(source for source in source_order if source in sources) or "uncovered"
    return {
        "vols": vols,
        "details": details,
        "lanes": lanes,
        "combined": combined,
        "dexCombined": dex_combined,
        "geckoCombined": gecko_combined,
        "volumeSource": volume_source,
        "crossCheck": cross_check_tag(dex_combined, gecko_combined),
        "gapPct": None if gap_fraction(dex_combined, gecko_combined) is None else round(gap_fraction(dex_combined, gecko_combined) * 100, 2),
        "uncoveredPools": uncovered,
    }


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0 or number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _cache_read(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def _cache_write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload))
    tmp.replace(path)


def _get_json(url: str, *, gecko: bool = False) -> Any:
    global _next_gecko
    for attempt in range(4):
        if gecko:
            wait = _next_gecko - time.time()
            if wait > 0:
                time.sleep(wait)
            _next_gecko = time.time() + GECKO_GAP_S
        req = urllib.request.Request(url, headers=UA)
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.loads(resp.read().decode())
        except Exception as exc:
            message = str(exc)
            if gecko and "429" in message and attempt < 3:
                time.sleep(15 * (attempt + 1))
                continue
            return None
    return None


def gecko_ohlcv_cached(chain: str, pool: str) -> list[list[float]]:
    network = CHAIN_NETWORK[chain]
    path = CACHE / "ohlcv" / network / f"{pool.replace('/', '_')}.json"
    cached = _cache_read(path)
    if isinstance(cached, dict) and cached.get("candles"):
        return cached["candles"]
    url = (
        f"https://api.geckoterminal.com/api/v2/networks/{network}/pools/"
        f"{pool}/ohlcv/hour?aggregate=1&limit=1000&currency=usd"
    )
    data = _get_json(url, gecko=True)
    candles: list[list[float]] = []
    if isinstance(data, dict):
        rows = ((data.get("data") or {}).get("attributes") or {}).get("ohlcv_list") or []
        for row in rows:
            if isinstance(row, list) and len(row) >= 6:
                try:
                    candles.append([int(row[0]), float(row[5])])
                except (TypeError, ValueError):
                    continue
    if data is not None:
        _cache_write(path, {"ok": bool(candles), "candles": candles})
    return candles


def known_pools_path(chain: str) -> Path:
    return ROOT / "data" / "volume-known-pools" / f"{chain}.json"


def load_pool_sides(chain: str) -> dict[str, dict[str, str]]:
    """pair key -> {pair, base, quote}. Empty when the file has no sides yet."""
    path = known_pools_path(chain)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    raw = payload.get("poolSides") if isinstance(payload, dict) else None
    if not isinstance(raw, dict):
        return {}
    sides: dict[str, dict[str, str]] = {}
    for key, row in raw.items():
        if not isinstance(row, dict):
            continue
        pair = str(row.get("pair") or key)
        sides[canon(pair)] = {
            "pair": pair,
            "base": str(row.get("base") or ""),
            "quote": str(row.get("quote") or ""),
        }
    return sides


def remember_known_pairs(chain: str, pairs: list[str], sides: dict[str, dict[str, str]] | None = None) -> None:
    """Append pool addresses the nightly writer should refetch."""
    path = known_pools_path(chain)
    payload: dict[str, Any] = {"chain": chain, "pairs": []}
    if path.exists():
        try:
            loaded = json.loads(path.read_text())
            if isinstance(loaded, dict):
                payload = loaded
        except json.JSONDecodeError:
            pass
    found = [item for item in payload.get("pairs") or [] if isinstance(item, str)]
    seen = {canon(item) for item in found}
    for pair in pairs:
        key = canon(pair)
        if key and key not in seen:
            seen.add(key)
            found.append(pair)
    payload["chain"] = chain
    payload["pairs"] = found
    if sides:
        stored = payload.get("poolSides") if isinstance(payload.get("poolSides"), dict) else {}
        for pair, row in sides.items():
            stored[canon(pair)] = {
                "pair": row.get("pair") or pair,
                "base": row.get("base") or "",
                "quote": row.get("quote") or "",
            }
        payload["poolSides"] = stored
    payload["note"] = (
        "Pools from DexScreener token-pairs and GeckoTerminal token pools, "
        "including PancakeSwap Infinity, Uniswap v4, and Solana pools past the "
        "token-pairs cap. poolSides records base and quote so a pool DexScreener "
        "does not list is still counted once. The nightly writer refetches these."
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def gecko_pool_identity(row: dict) -> tuple[str, str, str, float, float | None, str]:
    attrs = row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
    address = str(attrs.get("address") or "").strip()
    if not address:
        ident = str(row.get("id") or "")
        address = ident.split("_", 1)[1] if "_" in ident else ""
    rel = row.get("relationships") if isinstance(row.get("relationships"), dict) else {}

    def side(name: str) -> str:
        block = rel.get(name) if isinstance(rel.get(name), dict) else {}
        data = block.get("data") if isinstance(block.get("data"), dict) else {}
        ident = str(data.get("id") or "")
        return ident.split("_", 1)[1] if "_" in ident else ""

    try:
        h24 = float(((attrs.get("volume_usd") or {}).get("h24") or 0))
    except (TypeError, ValueError):
        h24 = 0.0
    try:
        reserve = float(attrs.get("reserve_in_usd"))
    except (TypeError, ValueError):
        reserve = None
    dex_rel = rel.get("dex") if isinstance(rel.get("dex"), dict) else {}
    dex_data = dex_rel.get("data") if isinstance(dex_rel.get("data"), dict) else {}
    return address, side("base_token"), side("quote_token"), h24, reserve, str(dex_data.get("id") or "geckoterminal")


def discover_gecko_pools(chain: str, rows: list[dict], already: set[str]) -> list[dict]:
    """Pools on GeckoTerminal that DexScreener did not return. Cached when present."""
    network = CHAIN_NETWORK[chain]
    found: list[dict] = []
    seen = {canon(item) for item in already}
    for row in rows:
        address = str(row.get("address") or "")
        key = canon(address)
        if not key:
            continue
        path = CACHE / "gecko-pools" / network / f"{key}.json"
        cached = _cache_read(path)
        pools = cached.get("pools") if isinstance(cached, dict) else None
        if not isinstance(pools, list):
            pools = []
            failed = False
            for page in range(1, 4):
                url = (
                    f"https://api.geckoterminal.com/api/v2/networks/{network}/tokens/"
                    f"{address}/pools?page={page}"
                )
                payload = _get_json(url, gecko=True)
                if not isinstance(payload, dict):
                    failed = True
                    break
                page_rows = payload.get("data") or []
                if not page_rows:
                    break
                pools.extend(page_rows)
                if len(page_rows) < 20:
                    break
            if pools and not failed:
                _cache_write(path, {"pools": pools})
        for raw in pools:
            if not isinstance(raw, dict):
                continue
            pair, base, quote, h24, reserve, dex = gecko_pool_identity(raw)
            pair_key = canon(pair)
            if not pair_key or pair_key in seen:
                continue
            if h24 < MIN_POOL_H24 and (reserve or 0) < MIN_POOL_H24:
                continue
            seen.add(pair_key)
            found.append(
                {
                    "pair": pair,
                    "base": base or address,
                    "quote": quote,
                    "dex_volume": h24,
                    "liquidity": reserve,
                    "dex": dex,
                    "from_gecko": True,
                }
            )
    return found


def export_discovered_pools(chain: str) -> int:
    """Persist Gecko pools at or above the $100 floor, with base and quote.

    The audit cache is the source. Pools DexScreener does not list stay in the
    known-pools file so the next nightly run still has them.
    """
    network = CHAIN_NETWORK[chain]
    directory = CACHE / "gecko-pools" / network
    if not directory.is_dir():
        return 0
    pairs: list[str] = []
    sides: dict[str, dict[str, str]] = {}
    for path in sorted(directory.glob("*.json")):
        cached = _cache_read(path)
        pools = cached.get("pools") if isinstance(cached, dict) else None
        if not isinstance(pools, list):
            continue
        for raw in pools:
            if not isinstance(raw, dict):
                continue
            pair, base, quote, h24, reserve, _dex = gecko_pool_identity(raw)
            if not pair:
                continue
            if h24 < MIN_POOL_H24 and (reserve or 0) < MIN_POOL_H24:
                continue
            if not base and not quote:
                continue
            pairs.append(pair)
            sides[pair] = {"pair": pair, "base": base, "quote": quote}
    if pairs:
        remember_known_pairs(chain, pairs, sides)
    return len(sides)


def overlay_gecko_day(
    chain: str,
    day: str,
    rows: list[dict],
    dex_pools: list[dict],
    *,
    discover: bool = True,
) -> dict[str, Any]:
    """Replace rolling h24 with the Eastern candle sum when Gecko covers the pool.

    dex_pools items: pair, base, quote, dex_volume, liquidity, dex.
    Network failures keep the DexScreener number.
    """
    combined_pools = list(dex_pools)
    if discover:
        already = {canon(str(pool.get("pair") or "")) for pool in dex_pools}
        combined_pools.extend(discover_gecko_pools(chain, rows, already))
    seen_pairs = {canon(str(pool.get("pair") or "")) for pool in combined_pools}
    remembered_sides: dict[str, dict[str, str]] = {}
    for key, side in load_pool_sides(chain).items():
        if not key or key in seen_pairs:
            continue
        if not side.get("base") and not side.get("quote"):
            continue
        seen_pairs.add(key)
        combined_pools.append(
            {
                "pair": side["pair"],
                "base": side["base"],
                "quote": side["quote"],
                "dex_volume": None,
                "liquidity": None,
                "dex": "geckoterminal",
                "from_gecko": True,
            }
        )
    enriched: list[dict] = []
    remembered: list[str] = []
    for pool in combined_pools:
        pair = str(pool.get("pair") or "")
        signal = max(_num(pool.get("dex_volume")) or 0.0, _num(pool.get("liquidity")) or 0.0)
        item = dict(pool)
        # Dust under $100 stays on the Dex sample. Known Gecko-only pools still get candles.
        fetch_candles = bool(pair) and (signal >= MIN_POOL_H24 or bool(pool.get("from_gecko")))
        if fetch_candles:
            candles = gecko_ohlcv_cached(chain, pair)
            volume, ok = sum_candles_for_day(candles, day) if candles else (None, False)
            item["gecko_volume"] = volume
            item["gecko_ok"] = ok
        else:
            item["gecko_volume"] = None
            item["gecko_ok"] = False
        enriched.append(item)
        if pair:
            remembered.append(pair)
            if pool.get("base") or pool.get("quote"):
                remembered_sides[pair] = {
                    "pair": pair,
                    "base": str(pool.get("base") or ""),
                    "quote": str(pool.get("quote") or ""),
                }
    if remembered:
        remember_known_pairs(chain, remembered, remembered_sides)
    totals = build_closed_totals(rows, enriched)
    if totals["combined"] is None:
        # Never blank a day the Dex sample already measured.
        fallback = []
        for pool in combined_pools:
            item = dict(pool)
            item["gecko_ok"] = False
            item["gecko_volume"] = None
            fallback.append(item)
        totals = build_closed_totals(rows, fallback)
        totals["volumeSource"] = "dexscreener-h24-fallback"
    return totals
