#!/usr/bin/env python3
"""Robinhood private-lane admission and unique-pool volume sums."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


def load_writer():
    path = Path(__file__).resolve().parent / "snapshot-robinhood-volume.py"
    spec = importlib.util.spec_from_file_location("snapshot_robinhood_volume", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rh = load_writer()


def pair(pool: str, mint: str, h24, *, quote: str = "0xquote", chain: str = "robinhood") -> dict:
    return {
        "chainId": chain,
        "pairAddress": pool,
        "baseToken": {"address": mint},
        "quoteToken": {"address": quote},
        "volume": {"h24": h24},
    }


class ClassifyOrderTest(unittest.TestCase):
    def test_etf_and_index_win_before_private(self) -> None:
        official = "Space Exploration Technologies Corp. Class A Common Stock • Robinhood Token"
        self.assertEqual(rh.classify("SPCX", official), "preipo")
        self.assertEqual(rh.classify("SPCX", "SpaceX Pre-IPO ETF"), "etf")
        self.assertEqual(rh.classify("SPY", "SPDR S&P 500 ETF Trust"), "etf")
        self.assertEqual(rh.classify("QQQ", "Invesco QQQ"), "etf")
        self.assertEqual(rh.classify("GLD", "SPDR Gold Trust"), "etf")
        self.assertEqual(rh.classify("USO", "United States Oil Fund"), "etf")
        self.assertEqual(rh.classify("SLV", "iShares Silver Trust"), "etf")
        self.assertEqual(rh.classify("IDX", "Pre-IPO Index"), "etf")
        self.assertEqual(
            rh.classify("SPCX", "SpaceX", {"underlyingInstrumentType": "etf"}),
            "etf",
        )
        self.assertEqual(
            rh.classify("SPCX", "SpaceX", {"assetClass": "index"}),
            "etf",
        )
        self.assertEqual(
            rh.classify("SPCX", "SpaceX", {"labels": ["private-market", "etf"]}),
            "etf",
        )

    def test_public_space_names_stay_equity(self) -> None:
        self.assertEqual(rh.classify("AAPL", "Apple • Robinhood Token"), "equity")
        self.assertEqual(rh.classify("ASTS", "AST SpaceMobile • Robinhood Token"), "equity")
        self.assertEqual(rh.classify("HWM", "Howmet Aerospace • Robinhood Token"), "equity")
        self.assertEqual(rh.classify("FLY", "Firefly Aerospace Inc. • Robinhood Token"), "equity")
        self.assertEqual(rh.classify("COIN", "Coinbase • Robinhood Token"), "equity")
        self.assertEqual(rh.classify("GOLD", "Barrick Gold • Robinhood Token"), None)
        self.assertEqual(rh.classify("NEM", "Barrick Gold • Robinhood Token"), "equity")


class PrivateAdmissionTest(unittest.TestCase):
    def test_clear_private_signals_are_admitted(self) -> None:
        self.assertEqual(rh.classify("SPCX", "SpaceX"), "preipo")
        self.assertEqual(rh.classify("$SPCX", "Space Exploration Technologies"), "preipo")
        self.assertEqual(rh.classify("OPENAI", "OpenAI • Robinhood Token"), "preipo")
        self.assertEqual(rh.classify("FOO", "Anthropic Pre-IPO"), "preipo")
        self.assertEqual(rh.classify("FOO", "Example private company"), "preipo")
        self.assertEqual(
            rh.classify("NEWCO", "Example", {"instrumentType": "pre-ipo"}),
            "preipo",
        )
        self.assertEqual(
            rh.classify("NEWCO", "Example", {"labels": ["private-market"]}),
            "preipo",
        )

    def test_crypto_commodities_baskets_and_copycats_are_never_private(self) -> None:
        self.assertEqual(rh.classify("BTC", "Bitcoin"), None)
        self.assertEqual(rh.classify("SPCX", "Bitcoin Pre-IPO"), None)
        self.assertEqual(rh.classify("GOLD", "Gold"), None)
        self.assertEqual(rh.classify("GLD2", "Pre-IPO Gold"), None)
        self.assertEqual(rh.classify("BASK", "Pre-IPO Basket"), None)
        self.assertEqual(rh.classify("GEN", "Tokenized Stocks"), None)
        self.assertEqual(rh.classify("SPCX", "SpaceX Inu"), None)
        self.assertEqual(rh.classify("SPCXX", "Space Exploration Technologies"), None)
        self.assertEqual(rh.classify("SPACEX2", "SpaceX"), None)
        self.assertEqual(rh.classify("MEME", "OpenAI meme"), None)
        self.assertEqual(
            rh.classify("SPCX", "Space Exploration Technologies", {"assetClass": "crypto"}),
            None,
        )


class PoolDedupeAndNullTotalsTest(unittest.TestCase):
    def test_repeated_pool_is_counted_once(self) -> None:
        mint = "0xspcx"
        universe = {mint}
        vols: dict[str, float | None] = {mint: None}
        counts = {mint: 0}
        seen: dict[str, set[str]] = {mint: set()}
        pairs = [
            pair("0xPOOL", mint, 100),
            pair("0xpool", mint, 100),
            pair("0xother", mint, 40),
            pair("", mint, 7, quote="0xquote"),
        ]
        pairs[-1]["pairAddress"] = ""
        pairs[-1]["pairId"] = "pool-id-1"
        pairs.append(dict(pairs[-1]))
        rh.accumulate_pair_volumes(pairs, universe, vols, counts, seen)
        self.assertEqual(vols[mint], 147)
        self.assertEqual(counts[mint], 3)

    def test_same_pool_on_base_and_quote_is_one_pool(self) -> None:
        mint = "0xmint"
        vols = {mint: None}
        counts = {mint: 0}
        seen = {mint: set()}
        row = pair("0xpool", mint, 25, quote=mint)
        rh.accumulate_pair_volumes([row], {mint}, vols, counts, seen)
        self.assertEqual(vols[mint], 25)
        self.assertEqual(counts[mint], 1)

    def test_null_h24_is_not_zero_and_all_null_lane_stays_null(self) -> None:
        mint = "0xmint"
        other = "0xother"
        vols = {mint: None, other: None}
        counts = {mint: 0, other: 0}
        seen = {mint: set(), other: set()}
        rh.accumulate_pair_volumes(
            [pair("0xa", mint, None), pair("0xb", other, 0)],
            {mint, other},
            vols,
            counts,
            seen,
        )
        self.assertIsNone(vols[mint])
        self.assertEqual(counts[mint], 1)
        self.assertEqual(vols[other], 0)
        rows = [
            {"kind": "preipo", "address": mint},
            {"kind": "preipo", "address": other},
        ]
        private_only_null, mints, pools = rh.lane_totals(
            [{"kind": "preipo", "address": mint}],
            vols,
            counts,
            "preipo",
        )
        self.assertIsNone(private_only_null)
        self.assertEqual(mints, 1)
        self.assertEqual(pools, 1)
        private_with_zero, _, _ = rh.lane_totals(rows, vols, counts, "preipo")
        self.assertEqual(private_with_zero, 0)
        public = 10.0
        etf = None
        self.assertEqual(rh.sum_nullable([public, private_only_null, etf]), 10)
        self.assertEqual(rh.sum_nullable([public, private_with_zero, 5.0]), 15)
        self.assertIsNone(rh.sum_nullable([None, None, None]))

    def test_other_chains_are_ignored(self) -> None:
        mint = "0xmint"
        vols = {mint: None}
        counts = {mint: 0}
        seen = {mint: set()}
        rh.accumulate_pair_volumes(
            [pair("0xsol", mint, 999, chain="solana"), pair("0xrh", mint, 4)],
            {mint},
            vols,
            counts,
            seen,
        )
        self.assertEqual(vols[mint], 4)
        self.assertEqual(counts[mint], 1)


if __name__ == "__main__":
    raise SystemExit(unittest.main())
