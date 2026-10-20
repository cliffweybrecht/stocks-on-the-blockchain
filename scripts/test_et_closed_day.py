#!/usr/bin/env python3
"""Closed-day pool sums: one pool once, Gecko candles, Dex fallback, gap tag."""

from __future__ import annotations

import unittest

from et_closed_day import (
    attach_gecko_candles,
    build_closed_totals,
    cross_check_tag,
    eastern_midnight,
    is_perp,
    rank_pools,
    recipient,
    sum_candles_for_day,
)


class ClosedDayTest(unittest.TestCase):
    def test_eastern_window_drops_the_neighboring_hours(self) -> None:
        start = eastern_midnight("2026-10-08")
        volume, covered = sum_candles_for_day(
            [[start - 3600, 50], [start, 10], [start + 3600, 2.5], [start + 86400, 99]],
            "2026-10-08",
        )
        self.assertTrue(covered)
        self.assertEqual(volume, 12.5)

    def test_stock_stock_pool_is_counted_once_on_the_base(self) -> None:
        universe = {"base", "quote"}
        self.assertEqual(recipient("base", "quote", universe), "base")
        rows = [
            {"address": "base", "kind": "equity"},
            {"address": "quote", "kind": "equity"},
            {"address": "etf", "kind": "etf"},
        ]
        totals = build_closed_totals(
            rows,
            [
                {
                    "pair": "cross",
                    "base": "base",
                    "quote": "quote",
                    "dex_volume": 100,
                    "gecko_volume": 80,
                    "gecko_ok": True,
                    "dex": "raydium",
                },
                {
                    "pair": "etf-pool",
                    "base": "etf",
                    "quote": "usdc",
                    "dex_volume": 40,
                    "gecko_volume": None,
                    "gecko_ok": False,
                    "dex": "orca",
                },
            ],
        )
        self.assertEqual(totals["vols"]["base"], 80)
        self.assertIsNone(totals["vols"]["quote"])
        self.assertEqual(totals["combined"], 120)
        self.assertEqual(totals["volumeSource"], "geckoterminal-hourly-et+dexscreener-h24-fallback")
        self.assertEqual(totals["crossCheck"], "dex-gecko-gap")
        self.assertEqual(cross_check_tag(100, 100), None)
        gecko_only = build_closed_totals(
            rows,
            [
                {
                    "pair": "infinity",
                    "base": "base",
                    "quote": "usdc",
                    "dex_volume": 500,
                    "gecko_volume": 80,
                    "gecko_ok": True,
                    "from_gecko": True,
                    "dex": "uniswap-v4",
                }
            ],
        )
        self.assertIsNone(gecko_only["dexCombined"])
        self.assertEqual(gecko_only["geckoCombined"], 80)
        self.assertEqual(gecko_only["combined"], 80)

    def test_dex_fallback_and_perps(self) -> None:
        self.assertTrue(is_perp("TSLAPERP", "Tesla"))
        self.assertFalse(is_perp("PERPLEXITY", "Perplexity"))
        totals = build_closed_totals(
            [{"address": "mint", "kind": "equity"}],
            [
                {
                    "pair": "only-dex",
                    "base": "mint",
                    "quote": "usdc",
                    "dex_volume": 15,
                    "gecko_volume": None,
                    "gecko_ok": False,
                    "dex": "raydium",
                }
            ],
        )
        self.assertEqual(totals["combined"], 15)
        self.assertEqual(totals["volumeSource"], "dexscreener-h24-fallback")
        self.assertIsNone(totals["crossCheck"])
        self.assertEqual(totals["barMethod"], "dex")
        self.assertEqual(totals["geckoCoveragePct"], 0.0)

    def test_mixed_coverage_is_the_candle_share_of_counted_dollars(self) -> None:
        totals = build_closed_totals(
            [{"address": "mint", "kind": "equity"}],
            [
                {
                    "pair": "candles",
                    "base": "mint",
                    "quote": "usdc",
                    "dex_volume": 100,
                    "gecko_volume": 80,
                    "gecko_ok": True,
                    "dex": "uniswap",
                },
                {
                    "pair": "fallback",
                    "base": "mint",
                    "quote": "usdc",
                    "dex_volume": 40,
                    "gecko_volume": None,
                    "gecko_ok": False,
                    "dex": "uniswap",
                },
            ],
        )
        self.assertEqual(totals["barMethod"], "mixed")
        self.assertEqual(totals["combined"], 120)
        self.assertEqual(totals["geckoCoveragePct"], 66.67)
        self.assertEqual(totals["overlapPools"], 1)
        self.assertEqual(totals["overlapGapPct"], 20.0)


class CandleBudgetTest(unittest.TestCase):
    def test_highest_volume_pools_consume_the_budget_first(self) -> None:
        calls: list[str] = []
        clock = {"t": 0.0}
        start = eastern_midnight("2026-10-19")

        def mono() -> float:
            return clock["t"]

        def fetch(_chain: str, pool: str) -> list[list[float]]:
            calls.append(pool)
            clock["t"] += 10
            return [[start, 5.0], [start + 3600, 1.0]]

        pools = [
            {"pair": "low", "dex_volume": 150, "liquidity": 0},
            {"pair": "high", "dex_volume": 900, "liquidity": 0},
            {"pair": "mid", "dex_volume": 400, "liquidity": 0},
            {"pair": "dust", "dex_volume": 1, "liquidity": 0},
        ]
        self.assertEqual([pool["pair"] for pool in rank_pools(pools)], ["high", "mid", "low", "dust"])
        result = attach_gecko_candles(
            "robinhood",
            "2026-10-19",
            pools,
            budget_s=15,
            fetch_ohlcv=fetch,
            monotonic=mono,
            read_cache=lambda _chain, _pool: None,
        )
        self.assertEqual(calls, ["high", "mid"])
        self.assertEqual(result["stats"]["budgetSkipped"], 1)
        self.assertEqual(result["stats"]["geckoOk"], 2)
        self.assertEqual(result["stats"]["candidates"], 3)
        by_pair = {pool["pair"]: pool for pool in result["pools"]}
        self.assertTrue(by_pair["low"]["budget_skipped"])
        self.assertFalse(by_pair["dust"].get("candle_candidate"))
        self.assertFalse(by_pair["dust"]["gecko_ok"])

    def test_cached_empty_series_is_not_fetched_again(self) -> None:
        calls: list[str] = []

        def fetch(_chain: str, pool: str) -> list[list[float]]:
            calls.append(pool)
            return []

        result = attach_gecko_candles(
            "robinhood",
            "2026-10-19",
            [{"pair": "known-miss", "dex_volume": 500}],
            budget_s=60,
            fetch_ohlcv=fetch,
            read_cache=lambda _chain, _pool: [],
        )
        self.assertEqual(calls, [])
        self.assertEqual(result["stats"]["cacheHits"], 1)
        self.assertEqual(result["stats"]["geckoOk"], 0)
        self.assertEqual(result["stats"]["networkFetches"], 0)


if __name__ == "__main__":
    unittest.main()
