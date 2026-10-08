#!/usr/bin/env python3
"""Daily Robinhood Chain tokenized-stock volume snapshot (DexScreener truth).

Mirrors Solana desk snapshot shape in data/volume-snapshots/robinhood.json.
- Universe: official GET https://api.robinhood.com/rhj/assets (chain 4663)
- 24h volume: DexScreener tokens/v1/robinhood unique-pool sum per mint
- Lanes: ETF/index is classified before private/pre-IPO. Private admission is
  fail-closed (ticker SPCX, or an explicit PRE-IPO / private-company signal in
  the official registry name or metadata). Crypto, commodities, generic baskets,
  and copycats are never private. null != 0 (omit legs with no reported volume).
- No Gecko backfill; one America/New_York calendar day per record (upsert by date).
  The day is 12:00:00 AM–11:59:59 PM Eastern. The key and Eastern midnight `t`
  come from scripts/volume_snapshot_day.py (`snapshot_day_key`), not a parallel
  date path. DexScreener pool volume.h24 sampled at end of day is that day's
  volume. ROBINHOOD_SNAPSHOT_DATE or SNAPSHOT_DATE (YYYY-MM-DD) forces the key
  only; it does not invent volume.
- Each night also writes `assets[]` (Base schema): address, symbol, issuer,
  instrumentKind, volume24hUsd, displayedLiquidityUsd, and pools. Totals stay.

Run:
  python3 scripts/snapshot-robinhood-volume.py
  npm run snapshot:robinhood-volume

After a successful write, land snapshot-only JSON onto main:
  npm run snapshot:land -- --chain robinhood --push-main
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from snapshot_asset_rows import assets_for, pool_row, reported_usd, upsert_day_record
from volume_snapshot_day import snapshot_date_override, snapshot_day_key

UA = {"User-Agent": "Mozilla/5.0 (compatible; RobinhoodVolumeSnapshot/1.0)"}
RH_ASSETS = "https://api.robinhood.com/rhj/assets"
DEX_BATCH = "https://api.dexscreener.com/tokens/v1/robinhood/{addrs}"
CHAIN_ID = 4663
ETF_TICKERS = {
    "SPY", "QQQ", "GLD", "VTI", "BND", "SGOV", "SHY", "SMH", "XLK", "EWY",
    "USO", "IWM", "DIA", "VOO", "IVV", "TQQQ", "SQQQ", "ARKK", "HYG", "LQD",
    "EFA", "EEM", "XLF", "XLE", "TLT", "IEF", "SCHD", "EWT", "SPMO", "SOXX", "INDA",
}
# Exact official ticker. SPCXx / SPCX2 are copycats, not this set.
PRIVATE_TICKERS = {"SPCX"}
_PRIVATE_LOOKALIKE_BASES = ("SPCX", "SPACEX")
_ETF_META = {"etf", "index", "index-fund", "equity-etf"}
_PRIVATE_META = {"private", "pre-ipo", "preipo", "private-company", "private-market"}
_EXCLUDE_META = {"crypto", "commodity", "basket", "generic"}
_CLASS_META_KEYS = (
    "instrumentType",
    "assetType",
    "category",
    "kind",
    "underlyingInstrumentType",
    "underlyingType",
    "assetClass",
)
CRYPTO_SYMBOLS = {
    "BONK", "BTC", "DAI", "ETH", "FARTCOIN", "FDUSD", "SOL", "USDC", "USDT",
    "USDS", "WBTC", "WETH", "WIF", "WSOL", "PYUSD",
}
COMMODITY_SYMBOLS = {"GOLD", "OIL", "PAXG", "SILVER", "XAG", "XAU", "XAUT"}
GENERIC_BASKET_SYMBOLS = {"BASKET", "BASKETS", "BUNDLE", "EQUITIES", "EQUITY", "RWA", "STOCKS"}
CRYPTO_NAME = re.compile(
    r"\b(?:bitcoin|ethereum|solana|usd\s*coin|tether|wrapped\s+sol|wrapped\s+bitcoin|"
    r"wrapped\s+ether|memecoin|meme\s+coin|stablecoin)\b",
    re.IGNORECASE,
)
# Whole-product commodities, not miners ("Barrick Gold" stays eligible for equity).
COMMODITY_PRODUCT_NAME = re.compile(
    r"^(?:tokeni[sz]ed\s+)?(?:gold|silver|crude\s+oil|precious\s+metals?|pax\s*gold)$",
    re.IGNORECASE,
)
COMMODITY_WORD = re.compile(
    r"\b(?:gold|silver|crude\s+oil|precious\s+metals?|pax\s*gold|palladium|platinum)\b",
    re.IGNORECASE,
)
GENERIC_BASKET_NAME = re.compile(
    r"\b(?:baskets?|bundles?)\b|"
    r"^(?:the\s+)?tokeni[sz]ed(?:\s+public)?\s+(?:stocks?|equit(?:y|ies)|shares?)$",
    re.IGNORECASE,
)
COPYCAT_NAME = re.compile(
    r"\b(?:copycat|parody|fake|unofficial|memecoin|meme(?:\s+coin)?|inu)\b",
    re.IGNORECASE,
)
PREIPO_PHRASE = re.compile(
    r"\bpre[\s-]?ipo\b|\bprivate(?:[\s-]company|[\s-]market)\b",
    re.IGNORECASE,
)
# Explicit private-company names. Do not match public "SpaceMobile" / "Aerospace".
PRIVATE_COMPANY_NAME = re.compile(
    r"\b(?:space\s+exploration\s+technologies|spacex|openai|anthropic|anduril|"
    r"neuralink|databricks|perplexity|stripe|shein|polymarket|kalshi|"
    r"huggingface|epic\s+games|figure\s+ai|xai)\b",
    re.IGNORECASE,
)


def fetch_json(url: str, retries: int = 4) -> Any:
    last: Exception | None = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.6 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def normalize_symbol(sym: str | None) -> str:
    return (sym or "").strip().lstrip("$").upper()


def _class_tokens(asset: dict) -> list[str]:
    tokens: list[str] = []
    for key in _CLASS_META_KEYS:
        val = asset.get(key)
        if isinstance(val, str) and val.strip():
            tokens.append(val.strip().lower().replace("_", "-"))
    labels = asset.get("labels")
    if isinstance(labels, list):
        for item in labels:
            if isinstance(item, str) and item.strip():
                tokens.append(item.strip().lower().replace("_", "-"))
    return tokens


def _meta_class(asset: dict | None) -> str | None:
    """Official registry instrument class, when the payload carries one.

    ETF/index wins over a private or crypto label on the same mint.
    """
    if not isinstance(asset, dict):
        return None
    tokens = _class_tokens(asset)
    if any(token in _ETF_META for token in tokens):
        return "etf"
    if any(token in _EXCLUDE_META for token in tokens):
        return "exclude"
    if any(token in _PRIVATE_META for token in tokens):
        return "private"
    return None


def _signal_text(name: str, asset: dict | None) -> str:
    parts = [name or ""]
    if isinstance(asset, dict):
        labels = asset.get("labels")
        if isinstance(labels, list):
            parts.extend(item.strip() for item in labels if isinstance(item, str) and item.strip())
        for key in _CLASS_META_KEYS:
            val = asset.get(key)
            if isinstance(val, str) and val.strip():
                parts.append(val.strip())
    return " ".join(parts)


def is_etf_or_index(sym: str, name: str, asset: dict | None = None) -> bool:
    if _meta_class(asset) == "etf":
        return True
    upper = (name or "").upper()
    if sym in ETF_TICKERS:
        return True
    if " ETF" in upper or upper.endswith("ETF"):
        return True
    if "SELECT SECTOR" in upper or "GOLD TRUST" in upper or "SILVER TRUST" in upper or "OIL FUND" in upper:
        return True
    if "BOND" in upper and "ETF" in upper:
        return True
    return re.search(r"\bINDEX\b", upper) is not None


def is_crypto(sym: str, name: str) -> bool:
    return sym in CRYPTO_SYMBOLS or CRYPTO_NAME.search(name or "") is not None


def is_commodity_product(sym: str, name: str) -> bool:
    if sym in COMMODITY_SYMBOLS:
        return True
    return COMMODITY_PRODUCT_NAME.search((name or "").strip()) is not None


def mentions_commodity(sym: str, name: str) -> bool:
    if sym in COMMODITY_SYMBOLS:
        return True
    return COMMODITY_WORD.search(name or "") is not None


def is_generic_basket(sym: str, name: str) -> bool:
    if sym in GENERIC_BASKET_SYMBOLS:
        return True
    return GENERIC_BASKET_NAME.search(name or "") is not None


def is_ticker_copycat(sym: str) -> bool:
    for base in _PRIVATE_LOOKALIKE_BASES:
        if sym != base and (sym.startswith(base) or sym.endswith(base)):
            return True
    return False


def is_copycat(sym: str, name: str) -> bool:
    return is_ticker_copycat(sym) or COPYCAT_NAME.search(name or "") is not None


def has_explicit_private_signal(sym: str, name: str, asset: dict | None = None) -> bool:
    """Clear private/pre-IPO signal only. Loose 'space' / 'aerospace' names do not qualify."""
    if sym in PRIVATE_TICKERS:
        return True
    if _meta_class(asset) == "private":
        return True
    text = _signal_text(name, asset)
    return PREIPO_PHRASE.search(text) is not None or PRIVATE_COMPANY_NAME.search(text) is not None


def _blocked_from_private(sym: str, name: str, asset: dict | None) -> bool:
    if _meta_class(asset) == "exclude":
        return True
    return (
        is_crypto(sym, name)
        or mentions_commodity(sym, name)
        or is_generic_basket(sym, name)
        or is_copycat(sym, name)
    )


def classify(sym: str, name: str = "", asset: dict | None = None) -> str | None:
    """Return equity, etf, or preipo. None is excluded from every volume lane.

    ETF/index is decided before private/pre-IPO. Private admission fails closed:
    only an exact SPCX ticker, an explicit PRE-IPO / private-company phrase, or
    an official registry class of private/pre-IPO. Crypto, commodities, generic
    baskets, and copycats are never private.
    """
    symbol = normalize_symbol(sym)
    label = name or ""
    if is_etf_or_index(symbol, label, asset):
        return "etf"
    if has_explicit_private_signal(symbol, label, asset):
        if _blocked_from_private(symbol, label, asset):
            return None
        return "preipo"
    if (
        _meta_class(asset) == "exclude"
        or is_crypto(symbol, label)
        or is_commodity_product(symbol, label)
        or is_generic_basket(symbol, label)
        or is_copycat(symbol, label)
    ):
        return None
    return "equity"


def chunks(items: list[str], n: int):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def load_universe() -> list[dict]:
    data = fetch_json(RH_ASSETS)
    assets = data.get("assets") or data
    rows = []
    excluded = 0
    for a in assets:
        sym = a.get("tokenSymbol") or ""
        name = a.get("tokenName") or ""
        addr = None
        for d in a.get("deployments") or []:
            if d.get("chainId") == CHAIN_ID:
                addr = d.get("contractAddress")
                break
        if not addr and (a.get("deployments") or []):
            addr = a["deployments"][0].get("contractAddress")
        if not addr:
            continue
        kind = classify(sym, name, a)
        if kind is None:
            excluded += 1
            continue
        rows.append(
            {
                "symbol": sym,
                "name": name,
                "address": addr,
                "kind": kind,
                "issuer": "rhj",
            }
        )
    if excluded:
        print(
            f"snapshot:robinhood excluded {excluded} registry rows from volume lanes",
            file=sys.stderr,
        )
    return rows


def pair_pool_id(pair: dict) -> str:
    """Stable pool identity. Pair address wins; pair id covers payloads that use that key."""
    for key in ("pairAddress", "pairId"):
        raw = pair.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip().lower()
    return ""


def h24_volume(pair: dict) -> float | None:
    volume = pair.get("volume")
    raw = volume.get("h24") if isinstance(volume, dict) else None
    if raw is None or raw == "":
        return None
    try:
        vol = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(vol):
        return None
    return vol


def pair_display_address(pair: dict) -> str:
    for key in ("pairAddress", "pairId"):
        raw = pair.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    return ""


def pair_dex_id(pair: dict) -> str:
    raw = pair.get("dexId")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return "unknown"


def pair_liquidity_usd(pair: dict) -> float | None:
    liquidity = pair.get("liquidity")
    raw = liquidity.get("usd") if isinstance(liquidity, dict) else None
    return reported_usd(raw)


def accumulate_pair_volumes(
    pairs: list,
    universe: set[str],
    vols: dict[str, float | None],
    pool_counts: dict[str, int],
    seen_pools: dict[str, set[str]],
    pool_details: dict[str, list[dict]] | None = None,
) -> None:
    """Add each pool's h24 to a mint once. A repeated pair address / pair id is skipped."""
    for pair in pairs:
        if not isinstance(pair, dict):
            continue
        chain_id = pair.get("chainId")
        if chain_id and str(chain_id) != "robinhood":
            continue
        pool_id = pair_pool_id(pair)
        base_token = pair.get("baseToken") if isinstance(pair.get("baseToken"), dict) else {}
        quote_token = pair.get("quoteToken") if isinstance(pair.get("quoteToken"), dict) else {}
        base = str(base_token.get("address") or "").lower()
        quote = str(quote_token.get("address") or "").lower()
        vol = h24_volume(pair)
        seen_in_pair: set[str] = set()
        for addr in (base, quote):
            if addr not in universe or addr in seen_in_pair:
                continue
            seen_in_pair.add(addr)
            seen = seen_pools.setdefault(addr, set())
            if pool_id and pool_id in seen:
                continue
            if pool_id:
                seen.add(pool_id)
            pool_counts[addr] = pool_counts.get(addr, 0) + 1
            if pool_details is not None:
                pool_details.setdefault(addr, []).append(
                    pool_row(pair_display_address(pair), pair_dex_id(pair), vol, pair_liquidity_usd(pair))
                )
            if vol is None:
                continue
            prev = vols.get(addr)
            vols[addr] = vol if prev is None else prev + vol


def hydrate_volumes(
    rows: list[dict],
) -> tuple[dict[str, float | None], dict[str, int], dict[str, list[dict]]]:
    """Return address(lower) -> volume24hUsd or None if no DexScreener volume."""
    by_addr = {r["address"].lower(): r for r in rows}
    universe = set(by_addr)
    vols: dict[str, float | None] = {a: None for a in universe}
    pool_counts: dict[str, int] = {a: 0 for a in universe}
    pool_details: dict[str, list[dict]] = {a: [] for a in universe}
    seen_pools: dict[str, set[str]] = {a: set() for a in universe}

    failed_batches = 0
    for batch in chunks(list(by_addr.keys()), 20):
        # DexScreener wants original casing sometimes; use registry addresses
        addrs = ",".join(by_addr[a]["address"] for a in batch)
        url = DEX_BATCH.format(addrs=addrs)
        data = None
        for attempt in range(6):
            try:
                data = fetch_json(url, retries=1)
                break
            except Exception as e:  # noqa: BLE001
                wait = 2.5 * (attempt + 1)
                print(f"warn batch retry {attempt + 1}/6 after {wait:.1f}s: {e}", file=sys.stderr)
                time.sleep(wait)
        if data is None:
            failed_batches += 1
            print("warn batch abandoned after retries", file=sys.stderr)
            time.sleep(2)
            continue
        pairs = data if isinstance(data, list) else (data.get("pairs") or [])
        accumulate_pair_volumes(pairs, universe, vols, pool_counts, seen_pools, pool_details)
        time.sleep(0.8)

    if failed_batches:
        print(f"warn hydrate incomplete: {failed_batches} abandoned batches", file=sys.stderr)
    return vols, pool_counts, pool_details


def sum_nullable(values: list[float | None]) -> float | None:
    """Sum reported numbers. All-null stays null; a reported 0 is kept."""
    total = 0.0
    any_reported = False
    for value in values:
        if value is None:
            continue
        any_reported = True
        total += value
    return total if any_reported else None


def lane_totals(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_counts: dict[str, int],
    kind: str,
) -> tuple[float | None, int, int]:
    volumes: list[float | None] = []
    mints = 0
    pools = 0
    for row in rows:
        if row["kind"] != kind:
            continue
        mints += 1
        addr = row["address"].lower()
        pools += pool_counts.get(addr, 0)
        volumes.append(vols.get(addr))
    return sum_nullable(volumes), mints, pools


def main() -> int:
    now = datetime.now(timezone.utc)
    override = snapshot_date_override(specific_key="ROBINHOOD_SNAPSHOT_DATE")
    try:
        date, t = snapshot_day_key(now, override)
    except ValueError as exc:
        print(f"snapshot:robinhood failed: {exc}", file=sys.stderr)
        return 1

    out_dir = Path(os.environ.get("ROBINHOOD_VOLUME_SNAPSHOT_DIR") or "").expanduser()
    if not out_dir.parts:
        # default: beside this script's desk root
        out_dir = Path(__file__).resolve().parents[1] / "data" / "volume-snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "robinhood.json"

    source = "override" if override else "America/New_York"
    print(f"snapshot:robinhood starting date={date} ({source})", flush=True)

    rows = load_universe()
    if not rows:
        print("snapshot:robinhood failed: empty RH registry", file=sys.stderr)
        return 1

    vols, pool_counts, pool_details = hydrate_volumes(rows)

    eq_vol, eq_mints, eq_pools = lane_totals(rows, vols, pool_counts, "equity")
    etf_vol, etf_mints, etf_pools = lane_totals(rows, vols, pool_counts, "etf")
    pre_vol, pre_mints, pre_pools = lane_totals(rows, vols, pool_counts, "preipo")
    combined = sum_nullable([eq_vol, pre_vol, etf_vol])

    record = {
        "date": date,
        "t": t,
        "publicEquity24hUsd": eq_vol,
        "private24hUsd": pre_vol,  # SPCX / pre-IPO lane
        "etfIndex24hUsd": etf_vol,
        "combined24hUsd": combined,
        "publicMintCount": eq_mints,
        "publicPoolCount": eq_pools,
        "etfMintCount": etf_mints,
        "etfPoolCount": etf_pools,
        "preipoMintCount": pre_mints,
        "preipoPoolCount": pre_pools,
        "withVolumeEquityCount": sum(
            1 for r in rows if r["kind"] == "equity" and vols.get(r["address"].lower()) is not None
        ),
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "sources": {
            "universe": RH_ASSETS,
            "volume": "DexScreener tokens/v1/robinhood volume.h24 unique-pool sum",
            "chainId": CHAIN_ID,
            "chainSlug": "robinhood",
        },
        "assets": assets_for(rows, vols, pool_details),
        "method": (
            "ETF/index before private; private admission is fail-closed; "
            "equity ranking excludes etf+preipo; DexScreener h24 deduped by pool; "
            "assets[] is the same per-mint DexScreener sample (null is not zero)"
        ),
    }

    def fmt(v: float | None) -> str:
        return "null" if v is None else f"{v:.2f}"

    # Fail closed before write. A thin pass must not replace a better same-day record.
    # Typical equity withVol is ~130+; below ~35% is a rate-limit under-count, not $0.
    if combined is None or (
        eq_mints >= 50 and record["withVolumeEquityCount"] < max(40, int(eq_mints * 0.35))
    ):
        print(
            f"snapshot:robinhood failed: under-coverage withVol={record['withVolumeEquityCount']} "
            f"equityMints={eq_mints} combined={fmt(combined)} (likely rate-limit)",
            file=sys.stderr,
        )
        return 1

    upsert_day_record(out_file, record)

    print(
        f"snapshot:robinhood wrote {date} combined={fmt(combined)} "
        f"equity={fmt(eq_vol)} etf={fmt(etf_vol)} preipo={fmt(pre_vol)} "
        f"equityMints={eq_mints} withVol={record['withVolumeEquityCount']} "
        f"assets={len(record['assets'])} -> {out_file}",
        flush=True,
    )
    print("Next: npm run snapshot:land -- --chain robinhood --push-main", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"snapshot:robinhood failed: {e}", file=sys.stderr)
        raise SystemExit(1)
