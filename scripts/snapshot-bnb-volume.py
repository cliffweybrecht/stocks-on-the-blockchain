#!/usr/bin/env python3
"""Daily BNB Chain tokenized-stock volume snapshot (DexScreener truth).

Writes data/volume-snapshots/bnb.json.
- Universe: union of public BNB (chainId 56 / DexScreener slug bsc) listings
  for every issuer, deduped by contract address. Stocksonchain alone only
  indexes Ondo and xStocks, so the writer also reads the Ondo GM API
  (bsc-56), the xStocks public asset list and CowSwap token list, the
  Jumper bStocks catalog, Colb Finance's BNB pre-IPO contracts, Paimon
  pre-IPO SPV tokens, and the Four.meme 4Stock seed (no public contract
  list). A 403 on one source does not blank the day.
- Lanes are public equity, ETF/index, and private (pre-IPO). ETF/index is
  classified before private. Private is fail-closed: Colb/Paimon wrappers, or
  registry kind preipo|private plus a private-company name/symbol. Crypto,
  commodities, generic baskets, copycats, leveraged/inverse products, perps,
  synthetics, fan tokens (ALPINE), tokenized treasuries (BUIDL/VBILL), and
  Paimon Prime stay out. Other chains stay out.
- 24h volume: DexScreener token-pairs/v1/bsc sum of non-null volume.h24
  across unique pools per mint (chain 56 / bsc). tokens/v1 returns one
  primary pair, so every mint also reads token-pairs, and known pools past
  that 30-pair cap are re-read from /latest/dex/pairs. A pool whose base and
  quote are both desk tokens is counted once, on the base token.
  Four.meme is also the quote asset for Stock Meme pairs. Those mints count
  only pools where the 4Stock is the base token against a cash or wrapped
  native quote (USDT, USDC, WBNB, BNB, and the other addresses in
  BNB_QUOTE_ASSETS).
- null != 0. Missing or invalid h24 is omitted; a reported 0 stays 0.
  A mint or lane with no reported volume stays null (sumNullable). No Gecko backfill.
- issuersByLane partitions that same sum by issuer inside each lane
  (equity, etf, private). Each issuer keeps usd, mint count, and pool count.
  An issuer with mints but no reported h24 stays in the map with usd null.
  Missing liquidity does not blank the day.
- One America/New_York calendar day per record (12:00:00 AM–11:59:59 PM Eastern).
  The day key is that Eastern date, not UTC. `t` is unix seconds for Eastern
  midnight. DexScreener pool volume.h24 sampled at end of day is that day's volume.
  BNB_SNAPSHOT_DATE or SNAPSHOT_DATE (YYYY-MM-DD) forces the key only; it does
  not invent volume.
- Each night also writes `assets[]` (Base schema) from that same DexScreener
  sample: address, symbol, issuer, instrumentKind, volume24hUsd,
  displayedLiquidityUsd, and pools. Lane totals and issuersByLane stay.

Run:
  python3 scripts/snapshot-bnb-volume.py
  BNB_VOLUME_SNAPSHOT_DIR=/path/to/data/volume-snapshots python3 scripts/snapshot-bnb-volume.py
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCRIPT_DIR = str(Path(__file__).resolve().parent)
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from bnb_volume_universe import (  # noqa: E402
    CHAIN_ID,
    CHAIN_SLUG,
    DESK_KINDS,
    count_issuers,
    issuer_slug,
    load_universe,
)
from snapshot_asset_rows import assets_for, pool_row, upsert_day_record  # noqa: E402
from volume_snapshot_day import snapshot_date_override, snapshot_day_key  # noqa: E402

UA = {"User-Agent": "Mozilla/5.0 (compatible; BnbVolumeSnapshot/1.0)"}
DEX_BATCH = "https://api.dexscreener.com/tokens/v1/bsc/{addrs}"
# Up to 30 pools. tokens/v1/bsc returns one primary pair, which is not enough
# when that pair is another stock or a smaller pool than the main one.
DEX_TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1/bsc/{addr}"
DEX_KNOWN_PAIRS = "https://api.dexscreener.com/latest/dex/pairs/bsc/{addrs}"

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
        volume = reported_h24((pair.get("volume") or {}).get("h24"))
        # One pool, one mint. Base wins when both sides are desk tokens so a
        # stock/stock pair is not added to both lane totals.
        recipients: list[str] = []
        for addr in (base, quote):
            if addr not in wanted or addr in recipients:
                continue
            if addr in restricted and not _quote_restricted_pool(addr, base, quote, quotes):
                continue
            recipients.append(addr)
        if len(recipients) > 1:
            recipients = recipients[:1]
        for addr in recipients:
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


def known_pair_addresses(snapshot_file: Path) -> list[str]:
    """Pair addresses already seen, plus the committed known-pools list.

    token-pairs caps at 30. These addresses are fetched again via
    /latest/dex/pairs so a pool that fell off that list still counts.
    """
    found: list[str] = []
    seen: set[str] = set()

    def add(raw: object) -> None:
        if not isinstance(raw, str):
            return
        text = raw.strip()
        key = text.lower()
        if not key.startswith("0x") or key in seen:
            return
        seen.add(key)
        found.append(text)

    extra = Path(__file__).resolve().parents[1] / "data" / "volume-known-pools" / "bnb.json"
    for path in (extra, snapshot_file):
        if not path.exists():
            continue
        try:
            payload = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        for addr in payload.get("pairs") or []:
            add(addr)
        for rec in payload.get("records") or []:
            if not isinstance(rec, dict):
                continue
            for asset in rec.get("assets") or []:
                if not isinstance(asset, dict):
                    continue
                for pool in asset.get("pools") or []:
                    if isinstance(pool, dict):
                        add(pool.get("pairAddress"))
    return found


def _pair_rows(data: Any) -> list:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        pairs = data.get("pairs")
        if isinstance(pairs, list):
            return pairs
        pair = data.get("pair")
        if isinstance(pair, dict):
            return [pair]
    return []


def hydrate_volumes(
    rows: list[dict],
    known_pairs: list[str] | None = None,
) -> tuple[dict[str, float | None], dict[str, int], dict[str, list[dict]], list[str]]:
    by_addr = {r["address"].lower(): r for r in rows}
    vols: dict[str, float | None] = {a: None for a in by_addr}
    pool_counts: dict[str, int] = {a: 0 for a in by_addr}
    pool_details: dict[str, list[dict]] = {a: [] for a in by_addr}
    warnings: list[str] = []
    failed_batches = 0
    # Stock Meme pairs quote the 4Stock. Only those mints are quote-restricted.
    restricted = {
        addr
        for addr, row in by_addr.items()
        if issuer_slug(str(row.get("issuer") or "")) == "fourmeme"
    }
    collected: list[Any] = []

    def pull(url: str, label: str) -> None:
        nonlocal failed_batches
        try:
            data = fetch_json(url)
        except Exception as e:  # noqa: BLE001
            message = str(e)
            if "404" in message or "400" in message:
                return
            failed_batches += 1
            print(f"warn {label} failed: {e}", file=sys.stderr)
            time.sleep(1)
            return
        collected.extend(_pair_rows(data))

    for batch in chunks(list(by_addr.keys()), 20):
        addrs = ",".join(by_addr[a]["address"] for a in batch)
        pull(DEX_BATCH.format(addrs=addrs), "batch")
        time.sleep(0.35)

    # tokens/v1 returns one primary pair. Every mint also reads token-pairs.
    for addr in sorted(by_addr):
        pull(DEX_TOKEN_PAIRS.format(addr=by_addr[addr]["address"]), "token-pairs")
        time.sleep(0.25)

    for batch in chunks(list(known_pairs or []), 30):
        pull(DEX_KNOWN_PAIRS.format(addrs=",".join(batch)), "known-pairs")
        time.sleep(0.35)

    mint_sum, mint_pools = sum_unique_pool_volumes(
        collected,
        set(by_addr),
        pool_details,
        base_against_quotes=restricted,
        quote_assets=BNB_QUOTE_ASSETS,
    )
    _apply_pool_sum(vols, pool_counts, mint_sum, mint_pools, add=False)

    if failed_batches:
        warnings.append(f"failed DexScreener batches: {failed_batches}")
    return vols, pool_counts, pool_details, warnings


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
) -> dict[str, dict[str, dict[str, Any]]]:
    """Partition each lane by issuer. usd uses the same sumNullable as the lane total.

    An issuer with no mints in a lane is omitted. An issuer with mints but no
    reported h24 stays, with usd null (null is not zero). Pool count is the
    sum of unique BNB pools already counted for those mints. Issuer keys are
    sorted so the file is stable across nights.
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
        lanes[field][issuer] = {
            "usd": sum_nullable([vols.get(addr) for addr in addresses]),
            "mints": len(group),
            "pools": sum(pool_counts.get(addr, 0) for addr in addresses),
        }
    return {field: dict(sorted(lanes[field].items())) for _, field in LANE_FIELDS}


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

    vols, pool_counts, pool_details, vol_warns = hydrate_volumes(rows, known_pair_addresses(out_file))
    for warning in vol_warns:
        print(f"warn {warning}", file=sys.stderr)
    if any(warning.startswith("failed DexScreener") for warning in vol_warns):
        print(
            "snapshot:bnb failed: DexScreener pair reads failed (refusing a one-pair under-count)",
            file=sys.stderr,
        )
        return 1

    def lane(kind: str) -> tuple[float | None, int, int]:
        mints = 0
        pools = 0
        for row in rows:
            if row["kind"] != kind:
                continue
            mints += 1
            pools += pool_counts.get(row["address"].lower(), 0)
        return lane_volume(rows, vols, kind), mints, pools

    # private24hUsd is the fail-closed pre-IPO lane. Combined sums only non-null lanes.
    eq_vol, eq_mints, eq_pools = lane("equity")
    etf_vol, etf_mints, etf_pools = lane("etf")
    pre_vol, pre_mints, pre_pools = lane("preipo")
    combined = sum_nullable([eq_vol, etf_vol, pre_vol])

    kind_counts = {kind: sum(1 for row in rows if row["kind"] == kind) for kind in DESK_KINDS}
    issuers = count_issuers(rows)
    by_lane = issuers_by_lane(rows, vols, pool_counts)

    record = {
        "date": date,
        "t": t,
        "publicEquity24hUsd": eq_vol,
        "private24hUsd": pre_vol,
        "etfIndex24hUsd": etf_vol,
        "combined24hUsd": combined,
        "issuersByLane": by_lane,
        "assets": assets_for(rows, vols, pool_details),
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
        "sources": {
            "universe": "BNB chainId 56 equity/pre-IPO/ETF union by contract address",
            "volume": (
                "DexScreener token-pairs/v1/bsc volume.h24 unique-pool sumNullable, "
                "plus known pools from /latest/dex/pairs; tokens/v1 is not the pair list; "
                "a pool with two desk tokens is counted once on the base; "
                "Four.meme keeps only base-vs-cash-quote pools"
            ),
            "chainId": CHAIN_ID,
            "chainSlug": CHAIN_SLUG,
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
            "sumNullable of DexScreener volume.h24 across unique BNB pools from token-pairs and known pairs; "
            "a pool with two desk tokens is counted once on the base token; "
            "Four.meme counts only base-token pools against cash or wrapped-native quotes; "
            "issuersByLane is that sum partitioned by issuer inside equity, etf, and private; "
            "assets[] is that same per-mint DexScreener sample; "
            "null means no reported volume (not zero)"
        ),
    }

    upsert_day_record(out_file, record)

    def fmt(value: float | None) -> str:
        return "null" if value is None else f"{value:.2f}"

    def lane_issuers(field: str) -> str:
        parts = []
        for slug, stats in by_lane[field].items():
            parts.append(f"{slug}:{fmt(stats['usd'])}/{stats['mints']}m/{stats['pools']}p")
        return ",".join(parts) if parts else "none"

    print(
        f"snapshot:bnb wrote {date} combined={fmt(combined)} "
        f"equity={fmt(eq_vol)} etf={fmt(etf_vol)} preipo={fmt(pre_vol)} "
        f"equityMints={eq_mints} etfMints={etf_mints} preipoMints={pre_mints} "
        f"withVol={record['withVolumeEquityCount']} assets={len(record['assets'])} "
        f"issuers={issuers} "
        f"equityByIssuer={lane_issuers('equity')} "
        f"etfByIssuer={lane_issuers('etf')} "
        f"privateByIssuer={lane_issuers('private')} -> {out_file}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"snapshot:bnb failed: {e}", file=sys.stderr)
        raise SystemExit(1)
