#!/usr/bin/env python3
"""Replace stored Solana, Robinhood, and BNB days with Gecko Eastern sums.

Reads /tmp/volume-audit/gecko-derived-v2.json. A day Gecko could not cover
keeps its stored dollars and is tagged. The replaced dollars stay on
`correction`. Does not touch Base.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from et_closed_day import export_discovered_pools

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / "data" / "volume-snapshots"
DERIVED = Path("/tmp/volume-audit/gecko-derived-v2.json")
SOURCE = (
    "GeckoTerminal hourly USD candles summed over the America/New_York day "
    "(candle open from 12:00:00 AM to the next midnight, exclusive). Every "
    "discovered pool at or above $100 current h24, each pool once, including "
    "PancakeSwap Infinity, Uniswap v4, and Solana pools DexScreener token-pairs "
    "does not list. Pools under that floor were not fetched. A pool whose candle "
    "window does not cover the day keeps the stored value and is tagged."
)
LANE_FIELD = {
    "equity": "publicEquity24hUsd",
    "private": "private24hUsd",
    "etf": "etfIndex24hUsd",
}


def canon(addr: str) -> str:
    text = (addr or "").strip()
    return text.lower() if text.startswith("0x") or text.startswith("0X") else text


def round_usd(value: float) -> float:
    return round(value + 1e-9, 2)


def universe_index(chain: str) -> dict[str, dict]:
    """Issuer and kind from the live desk universe. Missing issuers stay blank."""
    found: dict[str, dict] = {}
    try:
        if chain == "bnb":
            import importlib.util

            path = Path(__file__).resolve().parent / "snapshot-bnb-volume.py"
            spec = importlib.util.spec_from_file_location("snapshot_bnb_volume_apply", path)
            if spec is None or spec.loader is None:
                return found
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            rows, _warnings, _meta = module.load_universe()
            kind_map = {"equity": "equity", "etf": "etf", "preipo": "private", "private": "private"}
            for row in rows:
                key = canon(str(row.get("address") or ""))
                if not key:
                    continue
                found[key] = {
                    "address": row.get("address"),
                    "symbol": row.get("symbol") or "",
                    "issuer": row.get("issuer") or "",
                    "instrumentKind": kind_map.get(row.get("kind") or "", "equity"),
                }
        elif chain == "robinhood":
            # The RHJ registry is the only spot issuer on this desk.
            return found
    except Exception as exc:  # noqa: BLE001
        print(f"warn {chain} universe issuers: {exc}")
    return found


def issuer_index(records: list[dict]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for record in records:
        for asset in record.get("assets") or []:
            if not isinstance(asset, dict):
                continue
            key = canon(str(asset.get("address") or ""))
            if not key:
                continue
            row = found.setdefault(key, {})
            if asset.get("issuer") and not row.get("issuer"):
                row["issuer"] = asset["issuer"]
            if asset.get("symbol") and not row.get("symbol"):
                row["symbol"] = asset["symbol"]
            if asset.get("instrumentKind") and not row.get("instrumentKind"):
                row["instrumentKind"] = asset["instrumentKind"]
            if asset.get("displayedLiquidityUsd") is not None and "displayedLiquidityUsd" not in row:
                row["displayedLiquidityUsd"] = asset["displayedLiquidityUsd"]
    return found


def apply_chain(chain: str, derived: dict) -> dict:
    path = SNAP / f"{chain}.json"
    payload = json.loads(path.read_text())
    records = payload["records"]
    known = universe_index(chain)
    for key, row in issuer_index(records).items():
        current = known.setdefault(key, {})
        for field in ("address", "symbol", "issuer", "instrumentKind", "displayedLiquidityUsd"):
            if row.get(field) and not current.get(field):
                current[field] = row[field]
    chain_derived = derived[chain]
    days = chain_derived["days"]
    replaced = 0
    tagged = 0
    for record in records:
        day = record.get("date")
        info = days.get(day)
        stored = record.get("combined24hUsd")
        if not info or info.get("pools_covered", 0) <= 0:
            record["correction"] = {
                "source": SOURCE,
                "unverified": True,
                "reason": "GeckoTerminal has no hourly coverage for this Eastern day",
                "storedCombined24hUsd": stored,
            }
            record["volumeSource"] = record.get("volumeSource") or "stored-unverified"
            tagged += 1
            continue
        lanes = info.get("lanes") or {}
        equity = float(lanes.get("equity") or 0.0)
        private = float(lanes.get("private") or 0.0)
        etf = float(lanes.get("etf") or 0.0)
        unknown = float(lanes.get("unknown") or 0.0)
        unique = float(info.get("unique_volume") or 0.0)
        if unique > 0 and unknown / unique > 0.2:
            record["correction"] = {
                "source": SOURCE,
                "unverified": True,
                "reason": "More than 20% of the Gecko sum is on an unclassified token, so the stored lanes were kept",
                "storedCombined24hUsd": stored,
                "geckoUniqueVolumeUsd": info.get("unique_volume"),
                "excludedUnclassifiedUsd": round_usd(unknown),
            }
            record["volumeSource"] = "stored-unverified"
            tagged += 1
            continue
        by_addr = {}
        for asset in record.get("assets") or []:
            if isinstance(asset, dict) and asset.get("address"):
                by_addr[canon(asset["address"])] = asset
        new_assets = []
        seen: set[str] = set()
        for row in info.get("assets") or []:
            kind = row.get("kind") or ""
            if kind not in LANE_FIELD:
                continue
            key = canon(str(row.get("address") or ""))
            seen.add(key)
            prior = by_addr.get(key) or {}
            meta = known.get(key) or {}
            item = {
                "address": prior.get("address") or meta.get("address") or row.get("address") or key,
                "symbol": prior.get("symbol") or row.get("symbol") or meta.get("symbol") or "",
                "instrumentKind": kind if kind in {"equity", "etf", "private"} else meta.get("instrumentKind") or "equity",
                "volume24hUsd": row.get("volumeUsd"),
                "displayedLiquidityUsd": prior.get("displayedLiquidityUsd", meta.get("displayedLiquidityUsd")),
                "pools": prior.get("pools") or [],
                "volumeSource": "geckoterminal-hourly-et",
            }
            issuer = prior.get("issuer") or meta.get("issuer")
            if not issuer and chain == "robinhood":
                issuer = "rhj"
            if issuer:
                item["issuer"] = issuer
            if "poolCount" in prior:
                item["poolCount"] = len(item["pools"])
            new_assets.append(item)
        # Pools Gecko did not assign stay off the lane total. Adding the old
        # per-asset figure would count a pool twice when it moved to the base token.
        uncovered = float(info.get("stored_uncovered_usd") or 0.0)
        equity_r, private_r, etf_r = round_usd(equity), round_usd(private), round_usd(etf)
        combined = round_usd(equity_r + private_r + etf_r)
        gap = None
        if isinstance(stored, (int, float)) and max(abs(stored), abs(combined), 1) > 0:
            gap = round(abs(float(stored) - combined) / max(abs(float(stored)), abs(combined), 1) * 100, 2)
        prior_correction = record.get("correction") if isinstance(record.get("correction"), dict) else None
        record["publicEquity24hUsd"] = equity_r
        record["private24hUsd"] = private_r
        record["etfIndex24hUsd"] = etf_r
        record["combined24hUsd"] = combined
        record["assets"] = new_assets
        record["volumeSource"] = info.get("volume_source") or "geckoterminal-hourly-et"
        record["geckoCombined24hUsd"] = info.get("unique_volume")
        correction = {
            "source": SOURCE,
            "previousPublicEquity24hUsd": stored if False else record.get("correction", {}) and None,
            "previousPrivate24hUsd": None,
            "previousEtfIndex24hUsd": None,
            "previousCombined24hUsd": stored,
            "geckoUniqueVolumeUsd": info.get("unique_volume"),
            "poolsCovered": info.get("pools_covered"),
            "poolsMissingOhlcv": info.get("pools_missing_ohlcv"),
            "poolsTruncated": info.get("pools_truncated"),
            "unfetchedCurrentH24": chain_derived.get("skipped_current_h24"),
            "minH24Usd": chain_derived.get("min_h24"),
            "excludedUnclassifiedUsd": round_usd(unknown),
            "storedUncoveredUsd": round_usd(uncovered),
            "gapPct": gap,
        }
        # previous* must be the dollars this rewrite replaced, captured above.
        correction["previousPublicEquity24hUsd"] = None
        record["correction"] = correction
        if prior_correction:
            record["correction"]["priorCorrection"] = prior_correction
        if gap is not None and gap > 5:
            record["crossCheck"] = "stored-gecko-gap"
        elif "crossCheck" in record:
            record.pop("crossCheck", None)
        retarget_issuers(record)
        replaced += 1
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return {"replaced": replaced, "tagged": tagged}


def retarget_issuers(record: dict) -> None:
    lanes = record.get("issuersByLane")
    if not isinstance(lanes, dict):
        return
    sums: dict[str, dict[str, float]] = {"equity": {}, "etf": {}, "private": {}}
    for asset in record.get("assets") or []:
        kind = asset.get("instrumentKind")
        issuer = asset.get("issuer")
        vol = asset.get("volume24hUsd")
        if kind not in sums or not isinstance(issuer, str) or not isinstance(vol, (int, float)):
            continue
        sums[kind][issuer] = sums[kind].get(issuer, 0.0) + float(vol)
    for lane, issuers in lanes.items():
        if lane not in sums or not isinstance(issuers, dict):
            continue
        for slug, cell in issuers.items():
            if not isinstance(cell, dict):
                continue
            if slug in sums[lane]:
                cell["usd"] = round_usd(sums[lane][slug])
            else:
                cell["usd"] = None


def main() -> None:
    derived = json.loads(DERIVED.read_text())
    # Capture previous lane dollars before mutation. apply_chain currently
    # stores only combined; fill the lane previous fields here by wrapping.
    wanted = sys.argv[1:] or ["solana", "robinhood", "bnb"]
    for chain in wanted:
        if chain not in derived:
            print("skip", chain, "not derived yet")
            continue
        path = SNAP / f"{chain}.json"
        payload = json.loads(path.read_text())
        previous = {
            row["date"]: {
                "public": row.get("publicEquity24hUsd"),
                "private": row.get("private24hUsd"),
                "etf": row.get("etfIndex24hUsd"),
                "combined": row.get("combined24hUsd"),
            }
            for row in payload["records"]
        }
        summary = apply_chain(chain, derived)
        payload = json.loads(path.read_text())
        for row in payload["records"]:
            correction = row.get("correction")
            if not isinstance(correction, dict) or correction.get("unverified"):
                continue
            prior = previous.get(row["date"]) or {}
            correction["previousPublicEquity24hUsd"] = prior.get("public")
            correction["previousPrivate24hUsd"] = prior.get("private")
            correction["previousEtfIndex24hUsd"] = prior.get("etf")
            correction["previousCombined24hUsd"] = prior.get("combined")
        path.write_text(json.dumps(payload, indent=2) + "\n")
        print(chain, summary, "known-pools", export_discovered_pools(chain))


if __name__ == "__main__":
    main()
