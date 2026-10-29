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

A candle walk may pass budget_s. Pools are fetched highest-volume first.
When the wall clock is exhausted, remaining pools keep DexScreener h24 (or
GeckoTerminal rolling h24 for pools DexScreener does not list). That mix is
tagged gecko, dex, or mixed. It is not a true closed Eastern window unless
every counted dollar came from an hourly series that covers the day.

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
# Paimon pPOLY (0x1d80…) is wash, including United Stables U (0xce24…666666)
# quotes and the newer Uniswap v4 / PancakeSwap Infinity pools. Daily volume
# runs to the tens of millions while reserve is a few dollars up to a few
# thousand. The address set is the pools that did so on 2026-09-24..2026-10-08.
# Any pool with pPOLY on either side is the same wash, so a new address does
# not need to be added to the list. U is not a BNB cash quote.
PPOLY_TOKEN = "0x1d80392d12caaaf9e333bb0bb7f021eacf297fe6"
UNITED_STABLES = "0xce24439f2d9c6a2289f741120fe202248b666666"
PPOLY_WASH_REASON = "ppoly-wash"
EXCLUDED_VOLUME_POOLS = frozenset(
    {
        "0xe2d5738b246526194b19adf0dcdf5fc511126d276798e8fe5102ed464f7720e2",
        "0x289bbda2307bc4da4501d2f0d54a76928d4e31c4e9e409e58cccbad052d309a4",
        "0xfd3dc280c0db3cf6ef39f8d6a200e77e0622b8edf70e1712fc3b5f43a0ac9d7b",
        "0x42ea83ca9e00116dfcd65e257762c66875f3da1da60f515c73b2daeb0439ddd9",
        "0x61c0c0b77683cd1cbb2393e0dcc61afb981a930a51a71ffd0ff4657344b49f46",
        "0x10df8cef0015080c25d34afbc34fb8fc09994ba271ffd28bd6e1df812940351a",
        "0x577e7e842217230f122d594ffae19ded78d74dbed41c5a9cf9c37c08fa0539fc",
        "0xc35a93ed96bc1cf1cde0844ddc9933431a445bf501ed7b152c93b180864117c4",
        "0x1f30b1ca001d41fab5d272bc908c0682de1fa487c9ce3b2d6c2ef8305f7b0214",
        "0x45a7f94e056d36b003a0fbd824150138c813125c3f61f3b9ac517c3a619537ce",
        "0x22f1883e9a32fd2e52e6e9f767274f5bf37161942bd0424a59ca170e0dd71312",
        "0xc85069d4fc5bfbb05c31390340f1cb5d93beb0e6",
        "0x92243ce11a066a7733059070b25998b7be980942f06fff1f4a37c7583bb74e87",
        "0x9490375bb6ef2d94fe6e4ec87a435aac30b9671835141a2af1baa8bde0e9fd21",
        "0xe7602f48bc250c54b147d8725fc2e3331d67c73271918f20f28a94095c6a75f4",
        "0xbf7d259d8c3a3ec22bd9133a3e24fa5b27cba8af3406be3afbe999317a6b1e93",
        "0xb87c31b749494d3247477de03570bbcb9db91cae35123f71afa959eaedffa953",
        "0xa9dddba7cab89d8dae6c3495660b31684fb77b020b88f0218a111f1318c21b4a",
        "0xeb0d803436725b28ae056346904904e510e61437b7f9d98ed4cadfacc284bd31",
        "0x82cbc1b7c077203cb1652fdf43492d0ca3815519c9d2328b256372954b7bf80d",
        "0x805a5c69dbc7b2af1a7070e7aa90aacc0531f92454be788ab6bf1c5a3ff31568",
        "0xb21a69c49b9db2be06d5afa34530205f19565e75d1db42c0533e0a20e85698b3",
    }
)
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


def volume_pool_excluded(pair: str, base: str = "", quote: str = "") -> bool:
    """True for every pPOLY pool, including v4, Infinity, and U quotes.

    Missing sides still match the address list, including a known wash pool
    whose sides were labeled as a cash quote. A new pool is excluded when
    either side is the pPOLY token, so the address list does not have to grow.
    """
    if canon(pair) in EXCLUDED_VOLUME_POOLS:
        return True
    sides = {canon(base), canon(quote)} - {""}
    return PPOLY_TOKEN in sides


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
    guard=None,
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
    gecko_candle_usd = 0.0
    fallback_usd = 0.0
    saw_gecko = False
    saw_fallback = False
    overlap_dex = 0.0
    overlap_gecko = 0.0
    overlap_n = 0
    fallbacks: list[dict] = []
    excluded_pools: list[dict] = []
    excluded_usd = 0.0
    excluded_by_kind = {"equity": 0.0, "etf": 0.0, "preipo": 0.0}
    no_closed_day: list[dict] = []
    for pool in pools:
        pair = canon(str(pool.get("pair") or ""))
        if not pair or pair in seen:
            continue
        base = str(pool.get("base") or "")
        quote = str(pool.get("quote") or "")
        if volume_pool_excluded(pair, base, quote):
            seen.add(pair)
            owner = recipient(base, quote, universe_keys)
            if owner is not None:
                dex_volume = _num(pool.get("dex_volume"))
                gecko_volume, gecko_ok = pool.get("gecko_volume"), bool(pool.get("gecko_ok"))
                chosen, source = choose_pool_volume(
                    gecko_volume if isinstance(gecko_volume, (int, float)) else None,
                    gecko_ok,
                    dex_volume,
                )
                if chosen is not None:
                    if source == "dexscreener-h24-fallback" and pool.get("from_gecko"):
                        source = "geckoterminal-h24-fallback"
                    excluded_usd += chosen
                    kind = str((universe.get(owner) or {}).get("kind") or "")
                    if kind in excluded_by_kind:
                        excluded_by_kind[kind] += chosen
                    owner_row = universe.get(owner) or {}
                    excluded_pools.append(
                        {
                            "pairAddress": str(pool.get("pair") or pair),
                            "dexId": str(pool.get("dex") or "unknown"),
                            "volume24hUsd": round(chosen, 2),
                            "liquidityUsd": _num(pool.get("liquidity")),
                            "symbol": str(owner_row.get("symbol") or ""),
                            "source": source,
                            "reason": PPOLY_WASH_REASON,
                        }
                    )
            continue
        owner = recipient(base, quote, universe_keys)
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
        if guard is not None and chosen is not None:
            src = "geckoterminal-h24-fallback" if source == "dexscreener-h24-fallback" and pool.get("from_gecko") else source
            verdict = guard(pool, chosen, src)
            if verdict is not None:
                bucket, why = verdict
                owner_row = universe.get(owner) or {}
                entry = {
                    "pairAddress": str(pool.get("pair") or pair),
                    "dexId": str(pool.get("dex") or "unknown"),
                    "symbol": str(owner_row.get("symbol") or ""),
                    "volume24hUsd": round(chosen, 2),
                    "liquidityUsd": _num(pool.get("liquidity")),
                    "source": src,
                    "reason": why,
                }
                if bucket == "excluded":
                    excluded_pools.append(entry)
                    excluded_usd += chosen
                    kind = str(owner_row.get("kind") or "")
                    if kind in excluded_by_kind:
                        excluded_by_kind[kind] += chosen
                else:
                    no_closed_day.append(entry)
                continue
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
        if source == "geckoterminal-hourly-et":
            gecko_candle_usd += chosen
            saw_gecko = True
        else:
            fallback_usd += chosen
            saw_fallback = True
        if gecko_ok and isinstance(gecko_volume, (int, float)) and dex_volume is not None and not pool.get("from_gecko"):
            overlap_dex += dex_volume
            overlap_gecko += float(gecko_volume)
            overlap_n += 1
        if source in ("dexscreener-h24-fallback", "geckoterminal-h24-fallback"):
            owner_row = universe.get(owner) or {}
            fallbacks.append(
                {
                    "pairAddress": str(pool.get("pair") or pair),
                    "dexId": str(pool.get("dex") or "unknown"),
                    "volume24hUsd": round(chosen, 2),
                    "symbol": str(owner_row.get("symbol") or ""),
                    "source": source,
                    "reason": str(pool.get("fallback_reason") or "no-geckoterminal-candles"),
                }
            )
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
    if saw_gecko and saw_fallback:
        bar_method = "mixed"
    elif saw_gecko:
        bar_method = "gecko"
    else:
        bar_method = "dex"
    chosen_total = gecko_candle_usd + fallback_usd
    gecko_coverage = round(100.0 * gecko_candle_usd / chosen_total, 2) if chosen_total > 0 else None
    overlap_gap = gap_fraction(overlap_dex, overlap_gecko) if overlap_n else None
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
        "barMethod": bar_method,
        "geckoCoveragePct": gecko_coverage,
        "overlapDexUsd": round(overlap_dex, 2) if overlap_n else None,
        "overlapGeckoUsd": round(overlap_gecko, 2) if overlap_n else None,
        "overlapGapPct": None if overlap_gap is None else round(overlap_gap * 100, 2),
        "overlapPools": overlap_n,
        "fallbacks": fallbacks,
        "excludedVolumeUsd": round(excluded_usd, 2) if excluded_pools else None,
        "excludedByKind": {kind: round(value, 2) for kind, value in excluded_by_kind.items() if value}
        if excluded_pools
        else {},
        "excludedPools": excluded_pools,
        "noClosedDayData": no_closed_day,
        "noClosedDayDataUsd": round(sum(e["volume24hUsd"] for e in no_closed_day), 2) if no_closed_day else None,
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


def ohlcv_cache_path(chain: str, pool: str) -> Path:
    network = CHAIN_NETWORK[chain]
    return CACHE / "ohlcv" / network / f"{pool.replace('/', '_')}.json"


def read_cached_ohlcv(chain: str, pool: str) -> list[list[float]] | None:
    """Cached hourly candles, including a stored empty series.

    None means there is no cache entry. An empty list is a finished read
    (GeckoTerminal has no candles) and must not be fetched again.
    """
    cached = _cache_read(ohlcv_cache_path(chain, pool))
    if isinstance(cached, dict) and isinstance(cached.get("candles"), list):
        return cached["candles"]
    return None


def gecko_ohlcv_cached(chain: str, pool: str) -> list[list[float]]:
    cached = read_cached_ohlcv(chain, pool)
    if cached is not None:
        return cached
    network = CHAIN_NETWORK[chain]
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
        _cache_write(ohlcv_cache_path(chain, pool), {"ok": bool(candles), "candles": candles})
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


def _stamp_coverage(totals: dict[str, Any], stats: dict[str, Any]) -> None:
    """Attach candle-walk coverage. A budgeted walk reports the overlap gap.

    The full DexScreener total versus a partial candle sum is mostly uncovered
    pools. gapPct then uses pools that have both an hourly series and a
    DexScreener h24. fullGapPct keeps the unadjusted comparison.
    """
    totals["candleStats"] = stats
    candidates = int(stats.get("candidates") or 0)
    covered = int(stats.get("geckoOk") or 0)
    totals["poolCoveragePct"] = round(100.0 * covered / candidates, 2) if candidates else None
    skipped = int(stats.get("budgetSkipped") or 0)
    if skipped and totals.get("overlapGapPct") is not None:
        totals["fullGapPct"] = totals.get("gapPct")
        totals["gapPct"] = totals.get("overlapGapPct")
        totals["crossCheck"] = cross_check_tag(totals.get("overlapDexUsd"), totals.get("overlapGeckoUsd"))
        totals["gapBasis"] = "overlap-pools-measured-both-ways"
    elif skipped:
        totals["gapBasis"] = "dex-total-vs-partial-gecko-candles"
    else:
        totals["gapBasis"] = "dex-total-vs-gecko-candles"


def pool_rank(pool: dict) -> tuple[float, float]:
    """Highest rolling volume first, then liquidity. Missing numbers sort last."""
    return (_num(pool.get("dex_volume")) or 0.0, _num(pool.get("liquidity")) or 0.0)


def rank_pools(pools: list[dict]) -> list[dict]:
    return sorted(pools, key=pool_rank, reverse=True)


def _token_signal(pools: list[dict]) -> dict[str, float]:
    signal: dict[str, float] = {}
    for pool in pools:
        vol = _num(pool.get("dex_volume")) or 0.0
        for side in (pool.get("base"), pool.get("quote")):
            key = canon(str(side or ""))
            if key:
                signal[key] = signal.get(key, 0.0) + vol
    return signal


def attach_gecko_candles(
    chain: str,
    day: str,
    pools: list[dict],
    *,
    budget_s: float | None = None,
    fetch_ohlcv=None,
    monotonic=None,
    read_cache=None,
) -> dict[str, Any]:
    """Fill gecko_volume / gecko_ok. Highest-volume pools consume the budget first.

    Cached series are free. A pool still waiting when the wall clock expires
    keeps its DexScreener (or Gecko rolling) h24 and is marked budget_skipped.
    """
    clock = monotonic or time.monotonic
    fetch = fetch_ohlcv or (lambda network, pool: gecko_ohlcv_cached(network, pool))
    cache_read = read_cache or (lambda network, pool: read_cached_ohlcv(network, pool))
    started = clock()
    enriched: list[dict] = []
    stats: dict[str, Any] = {
        "budgetS": budget_s,
        "candidates": 0,
        "geckoOk": 0,
        "budgetSkipped": 0,
        "cacheHits": 0,
        "networkFetches": 0,
    }
    for pool in rank_pools(pools):
        pair = str(pool.get("pair") or "")
        signal = max(_num(pool.get("dex_volume")) or 0.0, _num(pool.get("liquidity")) or 0.0)
        item = dict(pool)
        fetch_candles = bool(pair) and (signal >= MIN_POOL_H24 or bool(pool.get("from_gecko")))
        item["candle_candidate"] = fetch_candles
        if not fetch_candles:
            item["gecko_volume"] = None
            item["gecko_ok"] = False
            enriched.append(item)
            continue
        stats["candidates"] += 1
        cached = cache_read(chain, pair)
        if cached is not None:
            candles = cached
            stats["cacheHits"] += 1
        elif budget_s is not None and (clock() - started) >= budget_s:
            candles = []
            item["budget_skipped"] = True
            stats["budgetSkipped"] += 1
        else:
            candles = fetch(chain, pair) or []
            stats["networkFetches"] += 1
            if stats["networkFetches"] % 25 == 0:
                print(
                    f"gecko candles fetches={stats['networkFetches']} "
                    f"elapsed={clock() - started:.0f}s budget={budget_s}",
                    flush=True,
                )
        volume, ok = sum_candles_for_day(candles, day) if candles else (None, False)
        if ok:
            start, end = eastern_midnight(day), eastern_midnight(next_day(day))
            item["gecko_hourly"] = [float(c[1]) for c in candles if start <= int(c[0]) < end]
        item["gecko_volume"] = volume
        item["gecko_ok"] = ok
        if ok:
            stats["geckoOk"] += 1
        enriched.append(item)
    stats["elapsedS"] = round(clock() - started, 3)
    return {"pools": enriched, "stats": stats}


def discover_gecko_pools(
    chain: str,
    rows: list[dict],
    already: set[str],
    *,
    deadline: float | None = None,
    token_signal: dict[str, float] | None = None,
    monotonic=None,
) -> list[dict]:
    """Pools on GeckoTerminal that DexScreener did not return. Cached when present.

    Tokens with more DexScreener volume are read first. `deadline` is a
    time.monotonic() instant; past it, only cached token pages are used.
    """
    clock = monotonic or time.monotonic
    network = CHAIN_NETWORK[chain]
    found: list[dict] = []
    seen = {canon(item) for item in already}
    signal = token_signal or {}
    ordered = sorted(
        rows,
        key=lambda row: signal.get(canon(str(row.get("address") or "")), 0.0),
        reverse=True,
    )
    for row in ordered:
        address = str(row.get("address") or "")
        key = canon(address)
        if not key:
            continue
        path = CACHE / "gecko-pools" / network / f"{key}.json"
        cached = _cache_read(path)
        pools = cached.get("pools") if isinstance(cached, dict) else None
        if not isinstance(pools, list):
            if deadline is not None and clock() >= deadline:
                continue
            pools = []
            failed = False
            for page in range(1, 4):
                if deadline is not None and clock() >= deadline:
                    failed = True
                    break
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
    budget_s: float | None = None,
    discovery_budget_s: float | None = None,
    fetch_ohlcv=None,
    monotonic=None,
    guard=None,
) -> dict[str, Any]:
    """Replace rolling h24 with the Eastern candle sum when Gecko covers the pool.

    dex_pools items: pair, base, quote, dex_volume, liquidity, dex.
    Network failures keep the DexScreener number. `budget_s` caps the uncached
    candle walk (highest volume first). Pools left over keep h24. `budget_s`
    None walks every candidate, which is how an unbounded run used to die.
    """
    clock = monotonic or time.monotonic
    combined_pools = list(dex_pools)
    if discover:
        already = {canon(str(pool.get("pair") or "")) for pool in dex_pools}
        deadline = None if discovery_budget_s is None else clock() + discovery_budget_s
        combined_pools.extend(
            discover_gecko_pools(
                chain,
                rows,
                already,
                deadline=deadline,
                token_signal=_token_signal(dex_pools),
                monotonic=clock,
            )
        )
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
    attached = attach_gecko_candles(
        chain,
        day,
        combined_pools,
        budget_s=budget_s,
        fetch_ohlcv=fetch_ohlcv,
        monotonic=clock,
    )
    enriched = attached["pools"]
    remembered: list[str] = []
    for pool in enriched:
        pair = str(pool.get("pair") or "")
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
    totals = build_closed_totals(rows, enriched, guard)
    _stamp_coverage(totals, attached["stats"])
    if totals["combined"] is None:
        # Never blank a day the Dex sample already measured.
        fallback = []
        for pool in combined_pools:
            item = dict(pool)
            item["gecko_ok"] = False
            item["gecko_volume"] = None
            fallback.append(item)
        totals = build_closed_totals(rows, fallback, guard)
        totals["volumeSource"] = "dexscreener-h24-fallback"
        totals["barMethod"] = "dex"
        _stamp_coverage(totals, attached["stats"])
    return totals
