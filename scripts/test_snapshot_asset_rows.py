#!/usr/bin/env python3
"""Per-asset nightly rows match the Base assets[] schema and do not invent volume."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from snapshot_asset_rows import assets_for, upsert_day_record


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


if __name__ == "__main__":
    raise SystemExit(unittest.main())
