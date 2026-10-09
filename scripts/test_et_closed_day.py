#!/usr/bin/env python3
"""Closed-day pool sums: one pool once, Gecko candles, Dex fallback, gap tag."""

from __future__ import annotations

import unittest

from et_closed_day import (
    build_closed_totals,
    cross_check_tag,
    eastern_midnight,
    is_perp,
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


if __name__ == "__main__":
    unittest.main()
