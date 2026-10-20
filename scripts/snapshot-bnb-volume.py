#!/usr/bin/env python3
"""Daily BNB Chain tokenized-stock volume snapshot (DexScreener truth).

Writes data/volume-snapshots/bnb.json.
- Universe: union of the bStocks seed (including BNCB and every bStocks
  mint stored in bnb.json assets[] on 2026-10-08 through 2026-10-10), every
  mint ever stored in bnb.json assets[] (issuer and lane kept), and live
  discovery. Stocksonchain alone only indexes Ondo and xStocks, so discovery
  also reads the Ondo GM API (bsc-56), the xStocks public asset list and
  CowSwap token list, the Jumper bStocks catalog, Colb Finance's BNB pre-IPO
  contracts, Paimon pre-IPO SPV tokens, and the Four.meme 4Stock seed.
  A 403 on one source does not blank the day. A mint with more than $100k
  of prior-day volume that live sources miss is warned and kept.
- Lanes are public equity, ETF/index, and private (pre-IPO). ETF/index is
  classified before private. Private is fail-closed: Colb/Paimon wrappers, or
  registry kind preipo|private plus a private-company name/symbol. Crypto,
  commodities, generic baskets, copycats, leveraged/inverse products, perps,
  synthetics, fan tokens (ALPINE), tokenized treasuries (BUIDL/VBILL), and
  Paimon Prime stay out. Other chains stay out.
- 24h volume: DexScreener token-pairs/v1/bsc for every mint. tokens/v1/bsc
  returns one pair and is not the snapshot. Only pools quoted in cash or
  wrapped native (BNB_QUOTE_ASSETS) count. Meme pairs stay out. pPOLY pools
  quoted in United Stables (U), and the known wash addresses, stay out.
  A pool whose
  base and quote are both tracked stocks counts once, on the base token.
  Known pools missing from the 30-pair page are refetched via
  /latest/dex/pairs/bsc. New pools, including Uniswap v4, come from
  GeckoTerminal token pools when liquidity is at least about $1,000.
  A v4 pool DexScreener does not list takes its h24 from Gecko. Each pool
  records source dexscreener or geckoterminal.
- null != 0. Missing or invalid h24 is omitted; a reported 0 stays 0.
  A mint or lane with no reported volume stays null (sumNullable).
  A token down more than 90% while its main pool still has volume is warned
  and kept. Liquidity under the floor is left out; missing liquidity is not
  treated as zero and does not blank a pool that DexScreener did report.
- issuersByLane partitions that same sum by issuer inside each lane
  (equity, etf, private). Each issuer keeps usd, mint count, and pool count.
  An issuer with mints but no reported h24 stays in the map with usd null.
  Missing liquidity does not blank the day.
- Market value is on-chain totalSupply / 10^decimals times a USD price, for
  every mint, not only mints with volume. Price is DexScreener priceUsd on
  the highest-liquidity cash-quote pool that passes the liquidity guard
  (USDT, USDC, WBNB, BNB, BUSD, FDUSD, USD1), else a GeckoTerminal token
  price, else null. Lane totals are publicEquityMarketValueUsd,
  etfIndexMarketValueUsd, privateMarketValueUsd, and combinedMarketValueUsd.
  Null is not zero. A price far from that pool's 24h history, or a
  single-token value above $10B, is null and warned. Past rows are not
  rewritten.
- One America/New_York calendar day per record (12:00:00 AM–11:59:59 PM Eastern).
  The day key is that Eastern date, not UTC. `t` is unix seconds for Eastern
  midnight. The closed-day number is the GeckoTerminal hourly candle sum over
  that window. DexScreener volume.h24 is the fallback and is tagged.
  BNB_SNAPSHOT_DATE or SNAPSHOT_DATE (YYYY-MM-DD) forces the key only; it does
  not invent volume. There is no switch that skips the candle overlay.
  pPOLY pools are wash and stay out of the lanes; their dollars are stored on
  excludedVolumeUsd and original* .
- Each night also writes `assets[]` (Base schema) from that same sample:
  address, symbol, issuer, instrumentKind, volume24hUsd,
  displayedLiquidityUsd, pools, and poolCount. Lane totals and issuersByLane stay.

Run:
  python3 scripts/snapshot-bnb-volume.py
  BNB_VOLUME_SNAPSHOT_DIR=/path/to/data/volume-snapshots python3 scripts/snapshot-bnb-volume.py
"""
from __future__ import annotations

import json
import math
import os
import sys

from snapshot_holders_hook import run_holder_snapshot
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from bnb_market_value import (  # noqa: E402
    MARKET_VALUE_SOURCE,
    bsc_rpc_urls,
    collect_market_values,
)
from bnb_volume_universe import (  # noqa: E402
    CHAIN_ID,
    CHAIN_SLUG,
    DESK_KINDS,
    count_issuers,
    issuer_slug,
    load_universe,
)
from et_closed_day import overlay_gecko_day, volume_pool_excluded  # noqa: E402
from snapshot_asset_rows import INSTRUMENT_KIND, assets_for, pool_row, upsert_day_record  # noqa: E402
from volume_snapshot_day import snapshot_date_override, snapshot_day_key  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (compatible; BnbVolumeSnapshot/1.0)"}
# Diagnostic only. tokens/v1/bsc returns one pair per token and is not the snapshot.
DEX_BATCH = "https://api.dexscreener.com/tokens/v1/bsc/{addrs}"
DEX_TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/bsc/{addr}"
DEX_PAIRS = "https://api.dexscreener.com/latest/dex/pairs/bsc/{addrs}"
GECKO_TOKEN_POOLS = "https://api.geckoterminal.com/api/v2/networks/bsc/tokens/{addr}/pools?page={page}"
POOLS_FILE_NAME = "bnb-pools.json"
# DexScreener documents 300 requests/minute. Gecko's public window is tighter.
DEX_MIN_INTERVAL_S = 0.25
GECKO_MIN_INTERVAL_S = 3.2
PAIR_BATCH = 30
# Wash prints (pPOLY v4 at ~$5 liquidity) stay out. Missing liquidity is not thin.
MIN_POOL_LIQUIDITY_USD = 1000.0
# Gecko pool discovery for names that can hide a v4 pool. The xStock long tail
# is not fetched unless it already has a known pool or real DexScreener volume.
GECKO_VOLUME_HINT_USD = 10_000.0
TOKEN_PAIRS_CAP = 30

# Cash and wrapped-native quotes on BNB Chain. A Stock Meme or another
# tokenized stock (BNCB, NVDAB) is not a quote for a 4Stock mint.
BNB_QUOTE_ASSETS = frozenset(
    {
        "0x55d398326f99059ff775485246999027b3197955",  # USDT
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",  # USDC
        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",  # WBNB
        "0xe9e7cea3dedca5984780bafc599bd69add087d56",  # BUSD
        "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",  # FDUSD
        "0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3",  # DAI
        "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",  # USD1
        "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",  # BTCB
        "0x2170ed0880ac9a755fd29b2688956bd959f933f8",  # ETH
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",  # native BNB placeholder
        "0x0000000000000000000000000000000000000000",
    }
)


def fetch_json(url: str, retries: int = 6) -> Any:
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:  # noqa: BLE001
            last = e
            msg = str(e)
            # DexScreener rate limits large universes; back off harder on 429
            if "429" in msg:
                time.sleep(2.5 * (i + 1))
            else:
                time.sleep(0.6 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def chunks(items: list[str], n: int):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def sum_nullable(values: list[float | None]) -> float | None:
    """sumNullable: omit missing volumes. A reported 0 stays 0. All-null is null."""
    total = 0.0
    any_vol = False
    for value in values:
        if value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if isinstance(value, bool) or not math.isfinite(number):
            continue
        any_vol = True
        total += number
    return total if any_vol else None


# Existing tests and callers use this name. It is sumNullable.
sum_reported = sum_nullable


def reported_h24(raw: Any) -> float | None:
    """DexScreener pair.volume.h24. Missing, non-numeric, and non-finite values are omitted.

    A reported 0 stays 0. Negatives are not a volume and are omitted.
    """
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            value = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(value) or value < 0:
        return None
    return value


def pair_on_bnb(chain_id: Any) -> bool:
    """Pairs from tokens/v1/bsc. Explicit chain 56 / bsc stays; other chains drop."""
    if chain_id is None:
        return True
    if isinstance(chain_id, str) and not chain_id.strip():
        return True
    if isinstance(chain_id, bool):
        return False
    if isinstance(chain_id, int):
        return chain_id == CHAIN_ID
    return str(chain_id).strip().lower() in {CHAIN_SLUG, "bsc", "56", "bnb", "bnb-chain", "binancesmartchain"}


def _quote_restricted_pool(mint: str, base: str, quote: str, quote_assets: set[str]) -> bool:
    """True when this mint is the traded token against a real quote.

    Stock Meme pools put the 4Stock on the quote side. Those stay out, as do
    pools quoted in another stock or a meme.
    """
    return mint == base and quote in quote_assets


def sum_unique_pool_volumes(
    pairs: list[Any],
    addresses: set[str],
    pool_details: dict[str, list[dict]] | None = None,
    seen: dict[str, set[str]] | None = None,
    *,
    base_against_quotes: set[str] | None = None,
    quote_assets: set[str] | None = None,
) -> tuple[dict[str, float | None], dict[str, int]]:
    """Sum each mint's non-null volume.h24 across unique BNB pools.

    Duplicate pair addresses count once. Pools with no reported h24 still count
    as pools but do not invent $0. An unindexed mint stays null.

    Addresses in base_against_quotes count only as the base token against
    quote_assets. Every other mint still counts on either side of the pool.
    Pass seen to keep that dedup across calls.
    """
    wanted = {addr.lower() for addr in addresses}
    restricted = {addr.lower() for addr in (base_against_quotes or ())}
    quotes = {addr.lower() for addr in (quote_assets or ())}
    totals: dict[str, float | None] = {addr: None for addr in wanted}
    counts: dict[str, int] = {addr: 0 for addr in wanted}
    if seen is None:
        seen = {addr: set() for addr in wanted}
    else:
        for addr in wanted:
            seen.setdefault(addr, set())
    for pair in pairs:
        if not isinstance(pair, dict) or not pair_on_bnb(pair.get("chainId")):
            continue
        raw_pair = str(pair.get("pairAddress") or "").strip()
        pair_address = raw_pair.lower()
        dex_raw = pair.get("dexId")
        dex_id = dex_raw.strip() if isinstance(dex_raw, str) and dex_raw.strip() else "unknown"
        liquidity_raw = pair.get("liquidity")
        liquidity = reported_h24(liquidity_raw.get("usd") if isinstance(liquidity_raw, dict) else None)
        base = str(((pair.get("baseToken") or {}).get("address") or "")).lower()
        quote = str(((pair.get("quoteToken") or {}).get("address") or "")).lower()
        if volume_pool_excluded(pair_address, base, quote):
            continue
        volume = reported_h24((pair.get("volume") or {}).get("h24"))
        for addr in {base, quote}:
            if addr not in wanted:
                continue
            if addr in restricted and not _quote_restricted_pool(addr, base, quote, quotes):
                continue
            if pair_address:
                if pair_address in seen[addr]:
                    continue
                seen[addr].add(pair_address)
            counts[addr] += 1
            if pool_details is not None:
                pool_details.setdefault(addr, []).append(pool_row(raw_pair, dex_id, volume, liquidity))
            if volume is None:
                continue
            totals[addr] = volume if totals[addr] is None else totals[addr] + volume
    return totals, counts


def _apply_pool_sum(
    vols: dict[str, float | None],
    pool_counts: dict[str, int],
    mint_sum: dict[str, float | None],
    mint_pools: dict[str, int],
    *,
    add: bool,
) -> None:
    for addr, total in mint_sum.items():
        if total is None:
            continue
        if add and vols[addr] is not None:
            vols[addr] = vols[addr] + total
        else:
            vols[addr] = total
    for addr, n in mint_pools.items():
        if not n:
            continue
        pool_counts[addr] = pool_counts.get(addr, 0) + n if add else n


class _Pace:
    def __init__(self, interval: float) -> None:
        self.interval = interval
        self.last = 0.0

    def wait(self) -> None:
        now = time.monotonic()
        delay = self.last + self.interval - now
        if delay > 0:
            time.sleep(delay)
        self.last = time.monotonic()


def pairs_from_payload(data: Any) -> list[dict]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        pairs = data.get("pairs")
        if isinstance(pairs, list):
            return [row for row in pairs if isinstance(row, dict)]
        one = data.get("pair")
        if isinstance(one, dict):
            return [one]
    return []


def load_known_pools(path: Path) -> dict[str, dict]:
    """Known pools keyed by lowercase token address. pools is keyed by pair address."""
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError:
        return {}
    tokens = data.get("tokens") if isinstance(data, dict) else None
    if not isinstance(tokens, dict):
        return {}
    out: dict[str, dict] = {}
    for key, row in tokens.items():
        if not isinstance(row, dict):
            continue
        address = str(row.get("address") or key or "")
        if not address.startswith("0x"):
            continue
        pools: dict[str, dict] = {}
        for pool in row.get("pools") or []:
            if not isinstance(pool, dict):
                continue
            pair = str(pool.get("pairAddress") or "")
            if not pair.startswith("0x"):
                continue
            pools[pair.lower()] = {
                "pairAddress": pair,
                "dexId": str(pool.get("dexId") or "").strip() or "unknown",
                "uniswapV4": bool(pool.get("uniswapV4")),
            }
        main = row.get("mainPool")
        out[address.lower()] = {
            "address": address,
            "symbol": str(row.get("symbol") or ""),
            "issuer": str(row.get("issuer") or ""),
            "kind": str(row.get("kind") or ""),
            "mainPool": main if isinstance(main, str) and main.startswith("0x") else None,
            "pools": pools,
        }
    return out


def save_known_pools(path: Path, known: dict[str, dict]) -> None:
    tokens: dict[str, dict] = {}
    for key in sorted(known):
        row = known[key]
        pools = [row["pools"][pk] for pk in sorted(row["pools"])]
        item: dict[str, Any] = {
            "address": row["address"],
            "symbol": row.get("symbol") or "",
            "issuer": row.get("issuer") or "",
            "kind": row.get("kind") or "",
            "pools": pools,
        }
        if row.get("mainPool"):
            item["mainPool"] = row["mainPool"]
        tokens[key] = item
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "liquidityFloorUsd": MIN_POOL_LIQUIDITY_USD, "tokens": tokens}, indent=2) + "\n")


def remember_attributed_pair(known: dict[str, dict], pair: dict, by_addr: dict[str, dict]) -> None:
    """Remember a pool only on the mint that will be charged for its volume."""
    base = str(((pair.get("baseToken") or {}).get("address") or "")).lower()
    quote = str(((pair.get("quoteToken") or {}).get("address") or "")).lower()
    dex_id = str(pair.get("dexId") or "").strip() or "unknown"
    pair_address = str(pair.get("pairAddress") or "")
    for addr, _role in attribute_pool(base, quote, set(by_addr), {item.lower() for item in BNB_QUOTE_ASSETS}):
        token = by_addr[addr]
        remember_pool(
            known,
            token["address"],
            pair_address,
            dex_id,
            symbol=str(token.get("symbol") or ""),
            issuer=str(token.get("issuer") or ""),
            kind=str(token.get("kind") or ""),
            uniswap_v4=_is_v4_dex(dex_id),
        )


def remember_pool(
    known: dict[str, dict],
    token_address: str,
    pair_address: str,
    dex_id: str,
    *,
    symbol: str = "",
    issuer: str = "",
    kind: str = "",
    uniswap_v4: bool = False,
) -> None:
    if not str(token_address).startswith("0x") or not str(pair_address).startswith("0x"):
        return
    key = token_address.lower()
    row = known.get(key)
    if row is None:
        row = {
            "address": token_address,
            "symbol": symbol,
            "issuer": issuer,
            "kind": kind,
            "mainPool": None,
            "pools": {},
        }
        known[key] = row
    if symbol and not row.get("symbol"):
        row["symbol"] = symbol
    if issuer and not row.get("issuer"):
        row["issuer"] = issuer
    if kind and not row.get("kind"):
        row["kind"] = kind
    pk = pair_address.lower()
    current = row["pools"].get(pk)
    dex = dex_id or "unknown"
    if current is None:
        row["pools"][pk] = {"pairAddress": pair_address, "dexId": dex, "uniswapV4": uniswap_v4}
    else:
        if dex != "unknown" and current.get("dexId") in {None, "", "unknown"}:
            current["dexId"] = dex
        if uniswap_v4:
            current["uniswapV4"] = True


def _is_v4_dex(dex_id: str) -> bool:
    return "v4" in (dex_id or "").lower()


def _gt_address(raw_id: str) -> str:
    text = raw_id or ""
    if "_" in text:
        text = text.split("_", 1)[1]
    return text


def pool_is_thin(liquidity: float | None) -> bool:
    """True only when liquidity is reported and under the floor. Missing stays thick enough to count."""
    return liquidity is not None and liquidity < MIN_POOL_LIQUIDITY_USD


def attribute_pool(base: str, quote: str, tracked: set[str], quotes: set[str]) -> list[tuple[str, str]]:
    """Cash-quote pools count on the stock side. A stock-vs-stock pool counts once, on the base.

    Meme pairs (one tracked stock, the other neither cash nor tracked) are excluded.
    """
    if base in tracked and quote in quotes:
        return [(base, "cash")]
    if quote in tracked and base in quotes:
        return [(quote, "cash")]
    if base in tracked and quote in tracked:
        return [(base, "stock")]
    return []


def fold_desk_pools(
    pairs: list[Any],
    tracked: dict[str, dict],
    *,
    quote_assets: set[str] | None = None,
    source: str = "dexscreener",
    seen_pairs: dict[str, set[str]] | None = None,
) -> tuple[dict[str, float | None], dict[str, int], dict[str, list[dict]], dict[str, float | None]]:
    """Sum h24 for the desk. Duplicate pair addresses count once per mint.

    pair_h24 is every BNB pair we saw, including ones the cash rule dropped,
    so a volume-drop check can still read the main pool.
    """
    wanted = set(tracked)
    quotes = {addr.lower() for addr in (quote_assets if quote_assets is not None else BNB_QUOTE_ASSETS)}
    vols: dict[str, float | None] = {addr: None for addr in wanted}
    counts: dict[str, int] = {addr: 0 for addr in wanted}
    details: dict[str, list[dict]] = {addr: [] for addr in wanted}
    if seen_pairs is None:
        seen_pairs = {addr: set() for addr in wanted}
    pair_h24: dict[str, float | None] = {}
    for pair in pairs:
        if not isinstance(pair, dict) or not pair_on_bnb(pair.get("chainId")):
            continue
        raw_pair = str(pair.get("pairAddress") or "").strip()
        pair_key = raw_pair.lower()
        if not pair_key:
            continue
        base = str(((pair.get("baseToken") or {}).get("address") or "")).lower()
        quote = str(((pair.get("quoteToken") or {}).get("address") or "")).lower()
        if volume_pool_excluded(pair_key, base, quote):
            continue
        volume = reported_h24((pair.get("volume") or {}).get("h24"))
        if pair_key not in pair_h24 or (pair_h24[pair_key] is None and volume is not None):
            pair_h24[pair_key] = volume
        liquidity_raw = pair.get("liquidity")
        liquidity = reported_h24(liquidity_raw.get("usd") if isinstance(liquidity_raw, dict) else None)
        if pool_is_thin(liquidity):
            continue
        dex_raw = pair.get("dexId")
        dex_id = dex_raw.strip() if isinstance(dex_raw, str) and dex_raw.strip() else "unknown"
        owners = attribute_pool(base, quote, wanted, quotes)
        for addr, _role in owners:
            if pair_key in seen_pairs.setdefault(addr, set()):
                continue
            seen_pairs[addr].add(pair_key)
            counts[addr] += 1
            row = pool_row(raw_pair, dex_id, volume, liquidity)
            row["source"] = source
            details[addr].append(row)
            if volume is None:
                continue
            vols[addr] = volume if vols[addr] is None else vols[addr] + volume
    return vols, counts, details, pair_h24


def _merge_fold(
    vols: dict[str, float | None],
    counts: dict[str, int],
    details: dict[str, list[dict]],
    pair_h24: dict[str, float | None],
    folded: tuple[dict[str, float | None], dict[str, int], dict[str, list[dict]], dict[str, float | None]],
) -> None:
    more_vols, more_counts, more_details, more_h24 = folded
    for addr, total in more_vols.items():
        if total is None:
            continue
        vols[addr] = total if vols.get(addr) is None else vols[addr] + total
    for addr, n in more_counts.items():
        if n:
            counts[addr] = counts.get(addr, 0) + n
    for addr, pools in more_details.items():
        if pools:
            details.setdefault(addr, []).extend(pools)
    for key, vol in more_h24.items():
        if key not in pair_h24 or (pair_h24[key] is None and vol is not None):
            pair_h24[key] = vol


def previous_token_volumes(records: list[dict], date: str) -> dict[str, float]:
    earlier = [
        row
        for row in records
        if isinstance(row, dict) and isinstance(row.get("date"), str) and row["date"] < date
    ]
    if not earlier:
        return {}
    prev = max(earlier, key=lambda row: str(row.get("date")))
    found: dict[str, float] = {}
    for asset in prev.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        addr = str(asset.get("address") or "").lower()
        vol = asset.get("volume24hUsd")
        if addr.startswith("0x") and isinstance(vol, (int, float)) and not isinstance(vol, bool):
            found[addr] = float(vol)
    return found


def volume_drop_warnings(
    rows: list[dict],
    vols: dict[str, float | None],
    known: dict[str, dict],
    pair_h24: dict[str, float | None],
    previous: dict[str, float],
) -> list[dict]:
    """More than a 90% drop while the main pool still has volume. Does not blank the token."""
    found: list[dict] = []
    for row in rows:
        addr = row["address"].lower()
        prev = previous.get(addr)
        if prev is None or prev <= 0:
            continue
        new = vols.get(addr)
        new_cmp = 0.0 if new is None else float(new)
        if new_cmp * 10 >= prev:
            continue
        known_row = known.get(addr) or {}
        main = known_row.get("mainPool")
        if not isinstance(main, str) or not main.startswith("0x"):
            best_key = ""
            best_vol = -1.0
            for key in known_row.get("pools") or {}:
                vol = pair_h24.get(key)
                if vol is None or vol <= best_vol:
                    continue
                best_vol = vol
                best_key = key
            if not best_key:
                continue
            pool = (known_row.get("pools") or {}).get(best_key) or {}
            main = str(pool.get("pairAddress") or best_key)
        main_vol = pair_h24.get(main.lower())
        if main_vol is None or main_vol <= 0:
            continue
        found.append(
            {
                "symbol": row.get("symbol") or "",
                "address": row["address"],
                "previous24hUsd": round(prev, 2),
                "volume24hUsd": None if new is None else round(float(new), 2),
                "mainPool": main,
                "mainPool24hUsd": round(float(main_vol), 2),
            }
        )
    found.sort(key=lambda item: str(item["symbol"]).upper())
    return found


def _gecko_targets(
    rows: list[dict],
    known: dict[str, dict],
    returned_counts: dict[str, int],
    cash_volume: dict[str, float | None],
) -> list[str]:
    """Tokens whose Gecko pool list can hide a Uniswap v4 pool DexScreener missed."""
    wanted: list[str] = []
    active_issuers = {"bstocks", "fourmeme", "paimon", "colb"}
    for row in rows:
        addr = row["address"].lower()
        issuer = issuer_slug(str(row.get("issuer") or ""))
        vol = cash_volume.get(addr)
        if (
            addr in known
            or issuer in active_issuers
            or returned_counts.get(addr, 0) >= TOKEN_PAIRS_CAP
            or (vol is not None and vol >= GECKO_VOLUME_HINT_USD)
        ):
            wanted.append(addr)
    return sorted(set(wanted))


def gecko_pools_to_pairs(payload: Any, token: str) -> list[dict]:
    """Gecko token-pool page as DexScreener-shaped pairs. Thin pools are omitted."""
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    found: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        attrs = row.get("attributes") if isinstance(row.get("attributes"), dict) else {}
        rel = row.get("relationships") if isinstance(row.get("relationships"), dict) else {}
        address = str(attrs.get("address") or "")
        if not address.startswith("0x"):
            continue
        try:
            reserve = float(attrs.get("reserve_in_usd"))
        except (TypeError, ValueError):
            reserve = None
        if reserve is None or reserve < MIN_POOL_LIQUIDITY_USD:
            continue
        volume_usd = attrs.get("volume_usd") if isinstance(attrs.get("volume_usd"), dict) else {}
        volume = reported_h24(volume_usd.get("h24"))
        dex_rel = rel.get("dex") if isinstance(rel.get("dex"), dict) else {}
        dex_data = dex_rel.get("data") if isinstance(dex_rel.get("data"), dict) else {}
        dex_id = str(dex_data.get("id") or "unknown")
        base_rel = rel.get("base_token") if isinstance(rel.get("base_token"), dict) else {}
        quote_rel = rel.get("quote_token") if isinstance(rel.get("quote_token"), dict) else {}
        base_id = str((base_rel.get("data") or {}).get("id") or "") if isinstance(base_rel.get("data"), dict) else ""
        quote_id = str((quote_rel.get("data") or {}).get("id") or "") if isinstance(quote_rel.get("data"), dict) else ""
        base = _gt_address(base_id).lower()
        quote = _gt_address(quote_id).lower()
        if token not in {base, quote}:
            # The endpoint is for this token. If the id parse failed, treat it as base.
            if not base:
                base = token
        found.append(
            {
                "chainId": "bsc",
                "pairAddress": address,
                "dexId": dex_id,
                "baseToken": {"address": base or token},
                "quoteToken": {"address": quote},
                "volume": {"h24": volume},
                "liquidity": {"usd": reserve},
            }
        )
    return found


def hydrate_volumes(
    rows: list[dict],
    known: dict[str, dict] | None = None,
    *,
    fetch: Any = None,
    discover_gecko: bool = True,
    price_pairs: list[dict] | None = None,
) -> tuple[
    dict[str, float | None],
    dict[str, int],
    dict[str, list[dict]],
    list[str],
    dict[str, float | None],
    dict[str, dict],
]:
    """token-pairs for every mint, known-pool refetch, then Gecko for v4 gaps.

    Cash quotes only. A stock-vs-stock pool counts once on the base token.
    """
    getter = fetch or fetch_json
    if known is None:
        known = {}
    by_addr = {r["address"].lower(): r for r in rows}
    warnings: list[str] = []
    failed = 0
    dex_pace = _Pace(DEX_MIN_INTERVAL_S)
    collected: dict[str, dict] = {}
    returned_counts: dict[str, int] = {}
    returned_by_token: dict[str, set[str]] = {}

    def ingest(pairs: list[dict], token_key: str | None = None) -> set[str]:
        seen: set[str] = set()
        for pair in pairs:
            if not pair_on_bnb(pair.get("chainId")):
                continue
            pair_address = str(pair.get("pairAddress") or "")
            pair_key = pair_address.lower()
            if not pair_key:
                continue
            collected[pair_key] = pair
            seen.add(pair_key)
            if price_pairs is not None:
                price_pairs.append(pair)
            remember_attributed_pair(known, pair, by_addr)
        if token_key is not None:
            returned_by_token[token_key] = seen
            returned_counts[token_key] = len(seen)
        return seen

    for addr in sorted(by_addr):
        dex_pace.wait()
        url = DEX_TOKEN_PAIRS.format(addr=urllib.parse.quote(by_addr[addr]["address"]))
        try:
            data = getter(url)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"warn token-pairs failed {by_addr[addr].get('symbol')}: {e}", file=sys.stderr)
            continue
        ingest(pairs_from_payload(data), addr)

    missing: list[str] = []
    seen_missing: set[str] = set()
    for addr in by_addr:
        returned = returned_by_token.get(addr, set())
        for key, pool in (known.get(addr) or {}).get("pools", {}).items():
            if key in returned or key in collected or key in seen_missing:
                continue
            pair = str(pool.get("pairAddress") or "")
            if pair.startswith("0x"):
                seen_missing.add(key)
                missing.append(pair)
    for batch in chunks(missing, PAIR_BATCH):
        dex_pace.wait()
        url = DEX_PAIRS.format(addrs=",".join(urllib.parse.quote(pair) for pair in batch))
        try:
            data = getter(url)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"warn pairs refetch failed: {e}", file=sys.stderr)
            continue
        ingest(pairs_from_payload(data))

    vols, counts, details, pair_h24 = fold_desk_pools(list(collected.values()), by_addr)
    folded_pairs = {
        str(pool.get("pairAddress") or "").lower()
        for pools in details.values()
        for pool in pools
    }

    if discover_gecko:
        gecko_pace = _Pace(GECKO_MIN_INTERVAL_S)
        targets = _gecko_targets(rows, known, returned_counts, vols)
        gecko_pairs: list[dict] = []
        for addr in targets:
            for page in (1, 2):
                gecko_pace.wait()
                url = GECKO_TOKEN_POOLS.format(addr=by_addr[addr]["address"], page=page)
                try:
                    payload = getter(url)
                except Exception as e:  # noqa: BLE001
                    failed += 1
                    print(f"warn gecko pools failed {by_addr[addr].get('symbol')}: {e}", file=sys.stderr)
                    break
                raw_rows = payload.get("data") if isinstance(payload, dict) else None
                page_pairs = gecko_pools_to_pairs(payload, addr)
                if not isinstance(raw_rows, list) or not raw_rows:
                    break
                for pair in page_pairs:
                    pair_key = str(pair.get("pairAddress") or "").lower()
                    if not pair_key or pair_key in folded_pairs:
                        if pair_key:
                            remember_attributed_pair(known, pair, by_addr)
                        continue
                    # DexScreener already returned this pair but the cash rule or the
                    # thin-liquidity floor dropped it. Do not put it back from Gecko.
                    if pair_key in collected:
                        continue
                    gecko_pairs.append(pair)
                    folded_pairs.add(pair_key)
                if len(raw_rows) < 20:
                    break
        if gecko_pairs:
            _merge_fold(
                vols,
                counts,
                details,
                pair_h24,
                fold_desk_pools(gecko_pairs, by_addr, source="geckoterminal"),
            )
            for pair in gecko_pairs:
                remember_attributed_pair(known, pair, by_addr)

    for addr, total in list(vols.items()):
        if total is not None:
            vols[addr] = round(total, 2)
    if failed:
        warnings.append(f"failed volume requests: {failed}")
    return vols, counts, details, warnings, pair_h24, known


def lane_volume(rows: list[dict], vols: dict[str, float | None], kind: str) -> float | None:
    """Lane total via sumNullable. An all-null lane (including private) stays null."""
    return sum_nullable(
        [vols.get(row["address"].lower()) for row in rows if row["kind"] == kind]
    )


# Writer kinds stay equity/etf/preipo. The day record names the private lane `private`.
LANE_FIELDS = (
    ("equity", "equity"),
    ("etf", "etf"),
    ("preipo", "private"),
)


def issuers_by_lane(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_counts: dict[str, int],
    market_values: dict[str, float | None] | None = None,
) -> dict[str, dict[str, dict[str, Any]]]:
    """Partition each lane by issuer. usd uses the same sumNullable as the lane total.

    An issuer with no mints in a lane is omitted. An issuer with mints but no
    reported h24 stays, with usd null (null is not zero). Pool count is the
    sum of unique BNB pools already counted for those mints. Issuer keys are
    sorted so the file is stable across nights.

    When market_values is passed, each issuer also keeps marketValueUsd (the
    same nullable sum) and marketValueMints (how many of its mints had a
    value). Omitted when the caller did not compute market value.
    """
    kind_to_field = {kind: field for kind, field in LANE_FIELDS}
    grouped: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        field = kind_to_field.get(row.get("kind"))
        if field is None:
            continue
        issuer = issuer_slug(str(row.get("issuer") or ""))
        grouped.setdefault((field, issuer), []).append(row)

    lanes: dict[str, dict[str, dict[str, Any]]] = {field: {} for _, field in LANE_FIELDS}
    for (field, issuer), group in grouped.items():
        addresses = [str(row["address"]).lower() for row in group]
        usd = sum_nullable([vols.get(addr) for addr in addresses])
        cell: dict[str, Any] = {
            "usd": None if usd is None else round(usd, 2),
            "mints": len(group),
            "pools": sum(pool_counts.get(addr, 0) for addr in addresses),
        }
        if market_values is not None:
            values = [market_values.get(addr) for addr in addresses]
            market = sum_nullable(values)
            cell["marketValueUsd"] = None if market is None else round(market, 2)
            cell["marketValueMints"] = sum(1 for value in values if value is not None)
        lanes[field][issuer] = cell
    return {field: dict(sorted(lanes[field].items())) for _, field in LANE_FIELDS}


def attach_market_values(assets: list[dict], rows: list[dict], readings: dict[str, dict]) -> list[dict]:
    """Write supply, price, and market value onto this night's asset rows.

    A mint with a market value and no volume row is added so the figure is
    stored. A mint with no volume and no market value stays out. Fields on a
    row that is already there are null when that input was missing. Past rows
    are not touched.
    """
    by_addr = {str(asset.get("address") or "").lower(): asset for asset in assets}
    for row in rows:
        address = str(row.get("address") or "")
        key = address.lower()
        if not key.startswith("0x"):
            continue
        reading = readings.get(key) or {}
        supply = reading.get("supply")
        price = reading.get("priceUsd")
        source = reading.get("priceSource")
        market = reading.get("marketValueUsd")
        item = by_addr.get(key)
        if item is None:
            # A quiet mint is stored only when it has a market value to record.
            if market is None:
                continue
            item = {
                "address": address,
                "symbol": row.get("symbol") or "",
                "instrumentKind": INSTRUMENT_KIND.get(row.get("kind") or "", "equity"),
                "volume24hUsd": None,
                "displayedLiquidityUsd": None,
                "pools": [],
            }
            issuer = row.get("issuer")
            if isinstance(issuer, str) and issuer.strip():
                item["issuer"] = issuer.strip()
            assets.append(item)
            by_addr[key] = item
        item["supply"] = supply
        item["priceUsd"] = price
        item["priceSource"] = source
        item["marketValueUsd"] = market
    assets.sort(key=lambda item: (str(item.get("symbol") or "").upper(), str(item.get("address") or "").lower()))
    return assets


def main() -> int:
    now = datetime.now(timezone.utc)
    override = snapshot_date_override(specific_key="BNB_SNAPSHOT_DATE")
    try:
        date, t = snapshot_day_key(now, override)
    except ValueError as exc:
        print(f"snapshot:bnb failed: {exc}", file=sys.stderr)
        return 1

    out_dir = Path(os.environ.get("BNB_VOLUME_SNAPSHOT_DIR") or "").expanduser()
    if not out_dir.parts:
        out_dir = Path(__file__).resolve().parents[1] / "data" / "volume-snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "bnb.json"

    source = "override" if override else "America/New_York"
    print(f"snapshot:bnb starting date={date} ({source})", flush=True)

    rows, uni_warns, meta = load_universe()
    for warning in uni_warns:
        print(f"warn {warning}", file=sys.stderr)
    if not rows:
        print("snapshot:bnb failed: empty universe", file=sys.stderr)
        return 1

    raw_pools = (os.environ.get("BNB_POOLS_FILE") or "").strip()
    pools_file = Path(raw_pools).expanduser() if raw_pools else out_dir / POOLS_FILE_NAME
    known = load_known_pools(pools_file)
    for row in rows:
        key = row["address"].lower()
        if key not in known:
            continue
        known[key]["address"] = row["address"]
        known[key]["symbol"] = row.get("symbol") or known[key].get("symbol") or ""
        known[key]["issuer"] = row.get("issuer") or known[key].get("issuer") or ""
        known[key]["kind"] = row.get("kind") or known[key].get("kind") or ""

    prior_records: list[dict] = []
    if out_file.exists():
        try:
            existing_prior = json.loads(out_file.read_text())
            if isinstance(existing_prior, dict) and isinstance(existing_prior.get("records"), list):
                prior_records = [row for row in existing_prior["records"] if isinstance(row, dict)]
        except json.JSONDecodeError:
            prior_records = []
    previous = previous_token_volumes(prior_records, date)

    dry_run = "--dry-run" in sys.argv
    price_pairs: list[dict] = []
    vols, pool_counts, pool_details, vol_warns, pair_h24, known = hydrate_volumes(rows, known, price_pairs=price_pairs)
    closed = None
    dex_pools = []
    for addr, pools in pool_details.items():
        for pool in pools:
            dex_pools.append(
                {
                    "pair": pool.get("pairAddress"),
                    "base": addr,
                    "quote": "",
                    "dex_volume": pool.get("volume24hUsd"),
                    "liquidity": pool.get("liquidityUsd"),
                    "dex": pool.get("dexId"),
                }
            )
    try:
        closed = overlay_gecko_day("bnb", date, rows, dex_pools)
    except Exception as exc:  # noqa: BLE001
        print(f"warn gecko eastern day failed, keeping DexScreener h24: {exc}", file=sys.stderr)
        closed = None
    if closed and closed.get("combined") is not None:
        vols = closed["vols"]
        pool_details = closed["details"]
        pool_counts = {addr: len(pools) for addr, pools in pool_details.items()}
    for warning in vol_warns:
        print(f"warn {warning}", file=sys.stderr)
    drops = volume_drop_warnings(rows, vols, known, pair_h24, previous)
    for warning in drops:
        print(
            "warn volume drop {symbol} {previous24hUsd} -> {volume24hUsd} "
            "main pool {mainPool} h24 {mainPool24hUsd}".format(**warning),
            file=sys.stderr,
        )

    def lane(kind: str) -> tuple[float | None, int, int]:
        mints = 0
        pools = 0
        for row in rows:
            if row["kind"] != kind:
                continue
            mints += 1
            pools += pool_counts.get(row["address"].lower(), 0)
        total = lane_volume(rows, vols, kind)
        return (None if total is None else round(total, 2)), mints, pools

    # private24hUsd is the fail-closed pre-IPO lane. Combined sums only non-null lanes.
    eq_vol, eq_mints, eq_pools = lane("equity")
    etf_vol, etf_mints, etf_pools = lane("etf")
    pre_vol, pre_mints, pre_pools = lane("preipo")
    combined = sum_nullable([eq_vol, etf_vol, pre_vol])

    kind_counts = {kind: sum(1 for row in rows if row["kind"] == kind) for kind in DESK_KINDS}
    issuers = count_issuers(rows)
    try:
        market_budget = float(os.environ.get("BNB_MARKET_VALUE_BUDGET_S") or "360")
    except ValueError:
        market_budget = 360.0
    if market_budget < 0:
        market_budget = 0.0
    readings, market_warnings, market_nulls, market_notes = collect_market_values(
        rows,
        price_pairs,
        pool_details,
        budget_s=market_budget,
        rpcs=bsc_rpc_urls(os.environ.get("BSC_RPC_URL")),
    )
    for note in market_notes:
        print(f"warn {note}", file=sys.stderr)
    for warning in market_warnings:
        print(
            "warn market value {symbol} {address} {reason} price={priceUsd} supply={supply} "
            "rejected={marketValueUsd} pool={pairAddress}".format(**warning),
            file=sys.stderr,
        )
    market_values = {addr: reading.get("marketValueUsd") for addr, reading in readings.items()}
    market_read_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def lane_market(kind: str) -> float | None:
        total = sum_nullable(
            [market_values.get(row["address"].lower()) for row in rows if row["kind"] == kind]
        )
        return None if total is None else round(total, 2)

    eq_mv = lane_market("equity")
    etf_mv = lane_market("etf")
    pre_mv = lane_market("preipo")
    combined_mv = sum_nullable([eq_mv, etf_mv, pre_mv])
    if combined_mv is not None:
        combined_mv = round(combined_mv, 2)
    by_lane = issuers_by_lane(rows, vols, pool_counts, market_values)
    assets = assets_for(rows, vols, pool_details)
    assets = attach_market_values(assets, rows, readings)
    for asset in assets:
        asset["poolCount"] = len(asset.get("pools") or [])

    record = {
        "date": date,
        "t": t,
        "publicEquity24hUsd": eq_vol,
        "private24hUsd": pre_vol,
        "etfIndex24hUsd": etf_vol,
        "combined24hUsd": combined,
        "publicEquityMarketValueUsd": eq_mv,
        "privateMarketValueUsd": pre_mv,
        "etfIndexMarketValueUsd": etf_mv,
        "combinedMarketValueUsd": combined_mv,
        "marketValueSource": MARKET_VALUE_SOURCE,
        "marketValueReadAt": market_read_at,
        "issuersByLane": by_lane,
        "assets": assets,
        "publicMintCount": eq_mints,
        "publicPoolCount": eq_pools,
        "etfMintCount": etf_mints,
        "etfPoolCount": etf_pools,
        "preipoMintCount": pre_mints,
        "preipoPoolCount": pre_pools,
        "withVolumeEquityCount": sum(
            1 for row in rows if row["kind"] == "equity" and vols.get(row["address"].lower()) is not None
        ),
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "volumeSource": (closed or {}).get("volumeSource") or "dexscreener-h24-fallback",
        "dexCombined24hUsd": None if closed is None else closed.get("dexCombined"),
        "geckoCombined24hUsd": None if closed is None else closed.get("geckoCombined"),
        "sources": {
            "universe": "BNB chainId 56 equity/pre-IPO/ETF union by contract address",
            "volume": (
                "GeckoTerminal hourly USD candles over the America/New_York midnight-to-midnight "
                "window when that pool's series covers the day; DexScreener token-pairs plus known "
                "pools volume.h24 is the fallback. PancakeSwap Infinity and Uniswap v4 pools that "
                "DexScreener does not list come from GeckoTerminal token pools and are persisted. "
                "Each pool is counted once. Perps are excluded."
            ),
            "chainId": CHAIN_ID,
            "chainSlug": CHAIN_SLUG,
            "marketValue": (
                "ERC-20 totalSupply/10^decimals from a public BSC RPC, times DexScreener priceUsd "
                "on the highest-liquidity USDT/USDC/WBNB/BNB/BUSD/FDUSD/USD1 pool that passes the "
                "liquidity guard, else GeckoTerminal token price. Null when either input is missing. "
                "A price far from that pool's 24h history, or a value above $10B, is null."
            ),
            "issuers": issuers,
            "kindCounts": kind_counts,
            "registries": meta.get("registries") or {},
            "addedBySource": meta.get("addedBySource") or {},
            "skipped": meta.get("skipped") or {},
        },
        "method": (
            "BNB chainId 56 only; classify ETF/index before private; "
            "private admits Colb, Paimon, or registry kind preipo|private with a private-company signal; "
            "crypto, commodities, generic baskets, copycats, leveraged/inverse, perps, fan tokens, "
            "treasuries, and Paimon Prime stay out; public equity, pre-IPO, and ETF for every issuer; "
            "SpaceX (SPCX) is public equity since the 2026-06-12 Nasdaq listing; "
            "Colb and Paimon wrappers stay private; "
            "closed day prefers GeckoTerminal hourly candles and falls back to DexScreener all-pools h24; "
            "each pool is counted once on the base desk token; "
            "known pools missing from token-pairs are refetched; "
            "GeckoTerminal token pools add PancakeSwap Infinity and Uniswap v4 addresses DexScreener lacks; "
            "a token down more than 90% while its main pool still has volume is warned and kept; "
            "issuersByLane is that sum partitioned by issuer inside equity, etf, and private; "
            "assets[] includes poolCount; "
            "null means no reported volume (not zero); "
            "market value is on-chain supply times a cash-pool DexScreener price or a GeckoTerminal "
            "token price, summed with the same nullable rule; past rows are left unchanged"
        ),
    }
    if market_warnings:
        record["marketValueWarnings"] = market_warnings
    if market_nulls:
        record["marketValueNulls"] = dict(sorted(market_nulls.items()))
    if closed and closed.get("crossCheck"):
        record["crossCheck"] = closed["crossCheck"]
        record["gapPct"] = closed.get("gapPct")
    if closed and closed.get("fallbacks"):
        record["dexscreenerH24Fallbacks"] = closed["fallbacks"]
    excluded = None if closed is None else closed.get("excludedVolumeUsd")
    if excluded:
        by_kind = closed.get("excludedByKind") or {}

        def plus(value: float | None, extra: float | None) -> float | None:
            if not extra:
                return value
            if value is None:
                return extra
            return round(value + extra, 2)

        record["excludedVolumeUsd"] = excluded
        record["excludedPools"] = closed.get("excludedPools") or []
        record["originalPublicEquity24hUsd"] = plus(eq_vol, by_kind.get("equity"))
        record["originalPrivate24hUsd"] = plus(pre_vol, by_kind.get("preipo"))
        record["originalEtfIndex24hUsd"] = plus(etf_vol, by_kind.get("etf"))
        record["originalCombined24hUsd"] = plus(combined, excluded)
    if drops:
        record["volumeDropWarnings"] = drops

    if dry_run:
        print(f"snapshot:bnb dry-run did not write {out_file}", flush=True)
    else:
        save_known_pools(pools_file, known)
        upsert_day_record(out_file, record)

    def fmt(value: float | None) -> str:
        return "null" if value is None else f"{value:.2f}"

    def lane_issuers(field: str) -> str:
        parts = []
        for slug, stats in by_lane[field].items():
            parts.append(f"{slug}:{fmt(stats['usd'])}/{stats['mints']}m/{stats['pools']}p")
        return ",".join(parts) if parts else "none"

    def lane_market_issuers(field: str) -> str:
        parts = []
        for slug, stats in by_lane[field].items():
            parts.append(f"{slug}:{fmt(stats.get('marketValueUsd'))}/{stats.get('marketValueMints')}v")
        return ",".join(parts) if parts else "none"

    print(
        f"snapshot:bnb {'dry-run' if dry_run else 'wrote'} {date} combined={fmt(combined)} "
        f"equity={fmt(eq_vol)} etf={fmt(etf_vol)} preipo={fmt(pre_vol)} "
        f"equityMints={eq_mints} etfMints={etf_mints} preipoMints={pre_mints} "
        f"withVol={record['withVolumeEquityCount']} assets={len(record['assets'])} "
        f"issuers={issuers} "
        f"equityByIssuer={lane_issuers('equity')} "
        f"etfByIssuer={lane_issuers('etf')} "
        f"privateByIssuer={lane_issuers('private')} "
        f"marketCombined={fmt(combined_mv)} marketEquity={fmt(eq_mv)} marketEtf={fmt(etf_mv)} "
        f"marketPrivate={fmt(pre_mv)} "
        f"marketEquityByIssuer={lane_market_issuers('equity')} "
        f"marketEtfByIssuer={lane_market_issuers('etf')} "
        f"marketPrivateByIssuer={lane_market_issuers('private')} "
        f"marketNulls={market_nulls} -> {out_file}",
        flush=True,
    )
    print(
        "snapshot:bnb market-value "
        + json.dumps(
            {
                "date": date,
                "readAt": market_read_at,
                "source": MARKET_VALUE_SOURCE,
                "publicEquityMarketValueUsd": eq_mv,
                "etfIndexMarketValueUsd": etf_mv,
                "privateMarketValueUsd": pre_mv,
                "combinedMarketValueUsd": combined_mv,
                "issuersByLane": {
                    field: {
                        slug: {
                            "marketValueUsd": stats.get("marketValueUsd"),
                            "marketValueMints": stats.get("marketValueMints"),
                            "mints": stats.get("mints"),
                        }
                        for slug, stats in by_lane[field].items()
                    }
                    for field in ("equity", "etf", "private")
                },
                "nulls": market_nulls,
                "warnings": market_warnings,
            },
            separators=(",", ":"),
        ),
        flush=True,
    )
    if dry_run:
        return 0
    holder_code = run_holder_snapshot("bnb", date)
    return holder_code if holder_code != 0 else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"snapshot:bnb failed: {e}", file=sys.stderr)
        raise SystemExit(1)
