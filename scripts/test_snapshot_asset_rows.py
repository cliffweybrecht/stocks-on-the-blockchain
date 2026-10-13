#!/usr/bin/env python3
"""Per-asset nightly rows match the Base assets[] schema and do not invent volume."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from snapshot_asset_rows import (
    LIQUIDITY_SANITY_REASON_DEAD_DEPTH,
    LIQUIDITY_SANITY_REASON_DOMINANCE,
    LIQUIDITY_SANITY_REASON_GECKO,
    apply_liquidity_sanity,
    assets_for,
    correct_stored_snapshot,
    upsert_day_record,
)


def load(name: str):
    path = Path(__file__).resolve().parent / name
    spec = importlib.util.spec_from_file_location(name.replace("-", "_").replace(".py", ""), path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rh = load("snapshot-robinhood-volume.py")
bnb = load("snapshot-bnb-volume.py")


class AssetRowSchemaTest(unittest.TestCase):
    def test_preipo_is_private_zero_is_kept_and_missing_is_omitted(self) -> None:
        rows = [
            {"address": "0xAaa", "symbol": "BBB", "kind": "equity", "issuer": "xstocks"},
            {"address": "0xBbb", "symbol": "AAA", "kind": "preipo", "issuer": "colb"},
            {"address": "0xCcc", "symbol": "CCC", "kind": "etf", "issuer": "ondo"},
        ]
        vols = {"0xaaa": 0.0, "0xbbb": 1.239, "0xccc": None}
        pools = {
            "0xaaa": [
                {"pairAddress": "0xPool", "dexId": "pancake", "volume24hUsd": 0.0, "liquidityUsd": None}
            ],
            "0xbbb": [],
            "0xccc": [],
        }
        assets = assets_for(rows, vols, pools)
        self.assertEqual([asset["symbol"] for asset in assets], ["AAA", "BBB"])
        self.assertEqual(assets[0]["instrumentKind"], "private")
        self.assertEqual(assets[0]["issuer"], "colb")
        self.assertEqual(assets[0]["volume24hUsd"], 1.24)
        self.assertIsNone(assets[0]["displayedLiquidityUsd"])
        self.assertEqual(assets[1]["volume24hUsd"], 0.0)
        self.assertEqual(assets[1]["instrumentKind"], "equity")
        self.assertEqual(assets[1]["pools"][0]["liquidityUsd"], None)

    def test_upsert_replaces_one_day_and_keeps_file_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bnb.json"
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "dayKey": "America/New_York",
                        "records": [
                            {"date": "2026-10-05", "combined24hUsd": 1, "issuersByLane": {"equity": {}}},
                            {"date": "2026-10-06", "combined24hUsd": 2},
                        ],
                    }
                )
            )
            upsert_day_record(
                path,
                {
                    "date": "2026-10-06",
                    "combined24hUsd": 9,
                    "assets": [{"address": "0x1", "symbol": "A", "volume24hUsd": 9}],
                },
            )
            payload = json.loads(path.read_text())
            self.assertEqual(payload["dayKey"], "America/New_York")
            by_date = {row["date"]: row for row in payload["records"]}
            self.assertEqual(by_date["2026-10-05"]["combined24hUsd"], 1)
            self.assertIn("issuersByLane", by_date["2026-10-05"])
            self.assertEqual(by_date["2026-10-06"]["combined24hUsd"], 9)
            self.assertEqual(by_date["2026-10-06"]["assets"][0]["volume24hUsd"], 9)


class RobinhoodAssetCaptureTest(unittest.TestCase):
    def test_unique_pools_keep_liquidity_and_feed_assets(self) -> None:
        mint = "0xmint"
        vols: dict[str, float | None] = {mint: None}
        counts = {mint: 0}
        seen: dict[str, set[str]] = {mint: set()}
        details: dict[str, list[dict]] = {}
        pairs = [
            {
                "chainId": "robinhood",
                "pairAddress": "0xPOOL",
                "dexId": "uniswap",
                "baseToken": {"address": mint},
                "quoteToken": {"address": "0xquote"},
                "volume": {"h24": 10.5},
                "liquidity": {"usd": 4},
            },
            {
                "chainId": "robinhood",
                "pairAddress": "0xpool",
                "dexId": "uniswap",
                "baseToken": {"address": mint},
                "quoteToken": {"address": "0xquote"},
                "volume": {"h24": 10.5},
                "liquidity": {"usd": 4},
            },
            {
                "chainId": "solana",
                "pairAddress": "0xother",
                "baseToken": {"address": mint},
                "volume": {"h24": 99},
                "liquidity": {"usd": 1},
            },
        ]
        rh.accumulate_pair_volumes(pairs, {mint}, vols, counts, seen, details)
        self.assertEqual(vols[mint], 10.5)
        self.assertEqual(counts[mint], 1)
        self.assertEqual(len(details[mint]), 1)
        self.assertEqual(details[mint][0]["liquidityUsd"], 4)
        self.assertEqual(details[mint][0]["volume24hUsd"], 10.5)
        assets = assets_for(
            [{"address": mint, "symbol": "SPCX", "kind": "preipo", "issuer": "rhj"}],
            vols,
            details,
        )
        self.assertEqual(assets[0]["instrumentKind"], "private")
        self.assertEqual(assets[0]["issuer"], "rhj")
        self.assertEqual(assets[0]["volume24hUsd"], 10.5)
        self.assertEqual(assets[0]["displayedLiquidityUsd"], 4)


class BnbAssetCaptureTest(unittest.TestCase):
    def test_pool_details_do_not_change_the_lane_sum(self) -> None:
        mint = "0x1111111111111111111111111111111111111111"
        pairs = [
            {
                "chainId": "bsc",
                "pairAddress": "0xPOOL",
                "dexId": "pancakeswap",
                "baseToken": {"address": mint},
                "quoteToken": {"address": "0xquote"},
                "volume": {"h24": 3},
                "liquidity": {"usd": 8},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xpool",
                "baseToken": {"address": mint},
                "volume": {"h24": 3},
                "liquidity": {"usd": 8},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xquiet",
                "baseToken": {"address": mint},
                "volume": {"h24": None},
                "liquidity": {},
            },
        ]
        details: dict[str, list[dict]] = {}
        totals, counts = bnb.sum_unique_pool_volumes(pairs, {mint}, details)
        self.assertEqual(totals[mint], 3)
        self.assertEqual(counts[mint], 2)
        self.assertEqual(len(details[mint]), 2)
        self.assertEqual(details[mint][0]["dexId"], "pancakeswap")
        self.assertEqual(details[mint][0]["liquidityUsd"], 8)
        self.assertIsNone(details[mint][1]["volume24hUsd"])
        self.assertIsNone(details[mint][1]["liquidityUsd"])
        assets = assets_for(
            [{"address": mint, "symbol": "NVDAx", "kind": "equity", "issuer": "xstocks"}],
            totals,
            details,
        )
        self.assertEqual(assets[0]["volume24hUsd"], 3)
        self.assertEqual(assets[0]["displayedLiquidityUsd"], 8)
        self.assertEqual(assets[0]["issuer"], "xstocks")


class LiquiditySanityTest(unittest.TestCase):
    def test_dead_depth_is_excluded_and_volume_stays(self) -> None:
        pool = "7co5wJY7chDAmkE8Rd3UsSkwjB1X8YC4WDB1FqoyyMYY"
        assets = assets_for(
            [{"address": "Mint", "symbol": "SPCX", "kind": "preipo", "issuer": "backpack"}],
            {"mint": 10.96},
            {
                "mint": [
                    {
                        "pairAddress": pool,
                        "dexId": "orca",
                        "volume24hUsd": 10.96,
                        "liquidityUsd": 596_294_797.53,
                    }
                ]
            },
        )
        self.assertEqual(assets[0]["volume24hUsd"], 10.96)
        self.assertEqual(assets[0]["pools"][0]["volume24hUsd"], 10.96)
        self.assertEqual(assets[0]["pools"][0]["liquidityUsd"], 596_294_797.53)
        self.assertEqual(assets[0]["displayedLiquidityUsd"], 0)
        self.assertEqual(assets[0]["excludedLiquidityPools"][0]["poolId"], pool)
        self.assertEqual(assets[0]["excludedLiquidityPools"][0]["liquidityUsd"], 596_294_797.53)
        self.assertEqual(assets[0]["excludedLiquidityPools"][0]["reason"], LIQUIDITY_SANITY_REASON_DEAD_DEPTH)

    def test_active_large_pool_and_exact_thresholds_stay(self) -> None:
        kept = apply_liquidity_sanity(
            [{"poolId": "deep", "liquidityUsd": 60_000_000, "volume24hUsd": 10_000}]
        )
        self.assertEqual(kept["displayedLiquidityUsd"], 60_000_000)
        self.assertEqual(kept["excludedLiquidityPools"], [])
        boundary = apply_liquidity_sanity(
            [{"poolId": "edge", "liquidityUsd": 50_000_000, "volume24hUsd": 0}]
        )
        self.assertEqual(boundary["displayedLiquidityUsd"], 50_000_000)
        ratio = apply_liquidity_sanity(
            [{"poolId": "ratio", "liquidityUsd": 60_000_000, "volume24hUsd": 6_000}]
        )
        self.assertEqual(ratio["displayedLiquidityUsd"], 60_000_000)

    def test_remaining_pools_stay_in_the_sum(self) -> None:
        result = apply_liquidity_sanity(
            [
                {"poolId": "bogus", "liquidityUsd": 442_228_509.38, "volume24hUsd": 29_053.87},
                {"poolId": "real", "liquidityUsd": 1_966_749.25, "volume24hUsd": 100},
            ]
        )
        self.assertEqual(result["displayedLiquidityUsd"], 1_966_749.25)
        self.assertEqual(result["excludedLiquidityPools"][0]["poolId"], "bogus")

    def test_dominance_needs_a_known_market_value(self) -> None:
        pools = [
            {"poolId": "wide", "liquidityUsd": 40_000_000, "volume24hUsd": 5_000_000},
            {"poolId": "next", "liquidityUsd": 100_000, "volume24hUsd": 1_000},
        ]
        unknown = apply_liquidity_sanity(pools)
        self.assertEqual(unknown["displayedLiquidityUsd"], 40_100_000)
        known = apply_liquidity_sanity(pools, market_value_usd=1_000_000)
        self.assertEqual(known["displayedLiquidityUsd"], 100_000)
        self.assertEqual(known["excludedLiquidityPools"][0]["reason"], LIQUIDITY_SANITY_REASON_DOMINANCE)
        single = apply_liquidity_sanity(
            [{"poolId": "only", "liquidityUsd": 40_000_000, "volume24hUsd": 5_000_000}],
            market_value_usd=1_000_000,
        )
        self.assertEqual(single["displayedLiquidityUsd"], 40_000_000)

    def test_gecko_reserve_replaces_a_far_higher_report(self) -> None:
        result = apply_liquidity_sanity(
            [
                {
                    "poolId": "pool",
                    "liquidityUsd": 2_000_000,
                    "volume24hUsd": 50_000,
                    "geckoReserveUsd": 20_000,
                }
            ]
        )
        self.assertEqual(result["displayedLiquidityUsd"], 20_000)
        self.assertEqual(result["excludedLiquidityPools"][0]["reason"], LIQUIDITY_SANITY_REASON_GECKO)
        self.assertEqual(result["excludedLiquidityPools"][0]["replacementLiquidityUsd"], 20_000)
        self.assertEqual(result["excludedLiquidityPools"][0]["liquidityUsd"], 2_000_000)
        raw_dead = apply_liquidity_sanity(
            [
                {
                    "poolId": "7co5wJY7chDAmkE8Rd3UsSkwjB1X8YC4WDB1FqoyyMYY",
                    "liquidityUsd": 596_294_797.53,
                    "volume24hUsd": 10.96,
                    "geckoReserveUsd": 2_000_000,
                }
            ]
        )
        self.assertEqual(raw_dead["displayedLiquidityUsd"], 2_000_000)
        self.assertEqual(raw_dead["excludedLiquidityPools"][0]["reason"], LIQUIDITY_SANITY_REASON_GECKO)

    def test_stored_row_keeps_the_original_displayed_total(self) -> None:
        payload = {
            "records": [
                {
                    "date": "2026-10-11",
                    "combined24hUsd": 1,
                    "assets": [
                        {
                            "address": "mint",
                            "symbol": "SPCX",
                            "volume24hUsd": 10.96,
                            "displayedLiquidityUsd": 596_294_797.53,
                            "pools": [
                                {
                                    "pairAddress": "7co5wJY7chDAmkE8Rd3UsSkwjB1X8YC4WDB1FqoyyMYY",
                                    "volume24hUsd": 10.96,
                                    "liquidityUsd": 596_294_797.53,
                                }
                            ],
                        }
                    ],
                }
            ]
        }
        changes = correct_stored_snapshot(payload)
        asset = payload["records"][0]["assets"][0]
        self.assertEqual(len(changes), 1)
        self.assertEqual(asset["volume24hUsd"], 10.96)
        self.assertEqual(asset["pools"][0]["volume24hUsd"], 10.96)
        self.assertEqual(asset["pools"][0]["liquidityUsd"], 596_294_797.53)
        self.assertEqual(asset["displayedLiquidityUsd"], 0)
        self.assertEqual(asset["correction"]["displayedLiquidityUsd"], 596_294_797.53)
        self.assertIn("7co5wJY7chDAmkE8Rd3UsSkwjB1X8YC4WDB1FqoyyMYY", asset["correction"]["reason"])
        self.assertEqual(correct_stored_snapshot(payload), [])


if __name__ == "__main__":
    raise SystemExit(unittest.main())
