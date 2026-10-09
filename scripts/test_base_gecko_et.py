#!/usr/bin/env python3
"""Exact Eastern-day window, one-count pools, and DexScreener fallback."""

from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from base_gecko_et import (
    BACKFILL_SOURCE,
    WINDOW_SOURCE,
    apply_folded_record,
    day_in_coverage,
    expected_window_hours,
    fold_day,
    page_max_h24,
    pair_bucket,
    parse_gecko_pools,
    pool_owner,
    series_covers_day,
    volume_on_day,
)

EASTERN = ZoneInfo("America/New_York")


def _open(day: str, hour: int, volume: float) -> list:
    stamp = int(datetime.fromisoformat(f"{day}T{hour:02d}:00:00").replace(tzinfo=EASTERN).timestamp())
    return [stamp, 0, 0, 0, 0, volume]


class EasternWindowTest(unittest.TestCase):
    def test_dst_windows_are_23_and_25_hours(self) -> None:
        self.assertEqual(expected_window_hours("2026-03-08"), 23)
        self.assertEqual(expected_window_hours("2026-11-01"), 25)
        self.assertEqual(expected_window_hours("2026-10-08"), 24)

    def test_sum_keeps_the_last_duplicate_open_and_drops_the_next_day(self) -> None:
        candles = [
            _open("2026-10-08", 0, 10),
            _open("2026-10-08", 0, 4),
            _open("2026-10-08", 23, 1.5),
            _open("2026-10-09", 0, 100),
        ]
        volume, hours = volume_on_day(candles, "2026-10-08")
        self.assertEqual(volume, 5.5)
        self.assertEqual(hours, 2)
        self.assertTrue(series_covers_day(candles, "2026-10-08"))
        self.assertFalse(series_covers_day([], "2026-10-08"))

    def test_fall_back_day_counts_25_distinct_opens(self) -> None:
        candles = []
        # 00:00 through 23:00 is 24 opens. The repeated 1 AM adds the 25th.
        for hour in range(24):
            candles.append(_open("2026-11-01", hour, 1))
        first = int(datetime(2026, 11, 1, 1, 0, tzinfo=EASTERN).timestamp())
        candles.append([first + 3600, 0, 0, 0, 0, 1])
        volume, hours = volume_on_day(candles, "2026-11-01")
        self.assertEqual(hours, 25)
        self.assertEqual(volume, 25)
        self.assertEqual(expected_window_hours("2026-11-01"), 25)

    def test_coverage_reaches_a_day_the_oldest_candle_still_touches(self) -> None:
        oldest = int(datetime(2026, 8, 28, 22, 0, tzinfo=EASTERN).timestamp())
        self.assertTrue(day_in_coverage("2026-09-25", oldest))
        self.assertFalse(day_in_coverage("2026-08-27", oldest))
        self.assertFalse(day_in_coverage("2026-09-25", None))


class PoolFoldTest(unittest.TestCase):
    def test_two_tracked_sides_count_once_and_meme_quotes_stay(self) -> None:
        nvda = "0x" + "11" * 20
        wrapped = "0x" + "22" * 20
        usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
        meme = "0x" + "33" * 20
        tokens = {
            nvda: {"address": nvda, "symbol": "NVDAc", "issuer": "coinbase", "kind": "equity"},
            wrapped: {"address": wrapped, "symbol": "wtNVDA", "issuer": "st0x", "kind": "equity"},
        }
        cash = "0x" + "aa" * 20
        cross = "0x" + "bb" * 20
        junk = "0x" + "cc" * 20
        pools = {
            cash: {
                "pairAddress": cash,
                "dexId": "aerodrome",
                "baseToken": nvda,
                "quoteToken": usdc,
                "baseSymbol": "NVDAc",
                "quoteSymbol": "USDC",
                "holders": [nvda],
                "listedOnDex": True,
            },
            cross: {
                "pairAddress": cross,
                "dexId": "uniswap-v4-base",
                "baseToken": nvda,
                "quoteToken": wrapped,
                "baseSymbol": "NVDAc",
                "quoteSymbol": "wtNVDA",
                "holders": [nvda, wrapped],
                "listedOnDex": False,
            },
            junk: {
                "pairAddress": junk,
                "dexId": "uniswap-v4-base",
                "baseToken": meme,
                "quoteToken": nvda,
                "baseSymbol": "PEPE",
                "quoteSymbol": "NVDAc",
                "holders": [nvda],
                "listedOnDex": False,
            },
        }
        candles = {
            cash: [_open("2026-10-08", 1, 50), _open("2026-10-08", 2, 7)],
            cross: [_open("2026-10-08", 1, 9)],
            junk: [_open("2026-10-08", 4, 3)],
        }
        folded = fold_day(tokens, pools, candles, "2026-10-08", {})
        self.assertEqual(folded["combined"], 69)
        self.assertEqual(folded["equity"], 69)
        self.assertEqual(folded["etf"], None)
        self.assertEqual(folded["private"], None)
        self.assertEqual(folded["volumes"][nvda], 69)
        self.assertEqual(folded["volumes"][wrapped], 9)
        self.assertEqual(pool_owner(pools[cross], tokens), nvda)
        buckets = {row["key"]: row["bucket"] for row in folded["poolRows"]}
        self.assertEqual(buckets[cash], "cash")
        self.assertEqual(buckets[cross], "stock")
        self.assertEqual(buckets[junk], "other")
        self.assertEqual(pair_bucket(pools[junk], set(tokens)), "other")

    def test_empty_gecko_falls_back_to_dex_h24_and_keeps_original_combined(self) -> None:
        token = "0x" + "11" * 20
        pair = "0x" + "ab" * 20
        tokens = {token: {"address": token, "symbol": "AAPLc", "issuer": "coinbase", "kind": "equity"}}
        pools = {
            pair: {
                "pairAddress": pair,
                "dexId": "aerodrome",
                "baseToken": token,
                "quoteToken": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                "baseSymbol": "AAPLc",
                "quoteSymbol": "USDC",
                "holders": [token],
                "listedOnDex": True,
            }
        }
        folded = fold_day(tokens, pools, {pair: []}, "2026-10-08", {pair: 12.5})
        self.assertEqual(folded["combined"], 12.5)
        self.assertEqual(folded["fallbacks"][0]["reason"], "no-geckoterminal-candles")
        record = {
            "date": "2026-10-08",
            "combined24hUsd": 4,
            "originalCombined24hUsd": 1.25,
            "issuers": [{"issuer": "coinbase", "publicMintCount": 2}],
            "assets": [],
            "notes": [],
            "sources": {},
        }
        apply_folded_record(record, tokens, folded, backfill=True)
        self.assertEqual(record["originalCombined24hUsd"], 1.25)
        self.assertEqual(record["combined24hUsd"], 12.5)
        self.assertEqual(record["backfillSource"], BACKFILL_SOURCE)
        self.assertEqual(record["windowSource"], WINDOW_SOURCE)
        self.assertEqual(record["windowHours"], 24)
        fresh = {
            "date": "2026-09-25",
            "combined24hUsd": 8,
            "issuers": [],
            "assets": [],
            "notes": [],
            "sources": {},
        }
        apply_folded_record(fresh, tokens, folded, backfill=True)
        self.assertEqual(fresh["originalCombined24hUsd"], 8)

    def test_gecko_page_parser_and_dust_stop(self) -> None:
        payload = {
            "data": [
                {
                    "id": "base_0x" + "aa" * 32,
                    "attributes": {
                        "address": "0x" + "aa" * 32,
                        "name": "NVDAc / PEPE",
                        "reserve_in_usd": "10",
                        "volume_usd": {"h24": "3.5"},
                    },
                    "relationships": {
                        "base_token": {"data": {"id": "base_0x" + "11" * 20, "type": "token"}},
                        "quote_token": {"data": {"id": "base_0x" + "33" * 20, "type": "token"}},
                        "dex": {"data": {"id": "uniswap-v4-base", "type": "dex"}},
                    },
                }
            ],
            "included": [
                {"id": "base_0x" + "11" * 20, "attributes": {"address": "0x" + "11" * 20, "symbol": "NVDAc"}},
                {"id": "base_0x" + "33" * 20, "attributes": {"address": "0x" + "33" * 20, "symbol": "PEPE"}},
            ],
        }
        pools = parse_gecko_pools(payload)
        self.assertEqual(len(pools), 1)
        self.assertEqual(pools[0]["dexId"], "uniswap-v4-base")
        self.assertEqual(pools[0]["quoteSymbol"], "PEPE")
        self.assertEqual(page_max_h24(pools), 3.5)
        self.assertEqual(page_max_h24([{"h24": 0}, {"h24": None}]), 0)


if __name__ == "__main__":
    unittest.main()
