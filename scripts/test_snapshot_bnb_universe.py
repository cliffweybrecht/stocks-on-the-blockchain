#!/usr/bin/env python3
"""BNB snapshot universe: union of registries, not a stocksonchain allowlist."""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

from bnb_volume_universe import (
    CHAIN_ID,
    CHAIN_SLUG,
    FOURMEME_4STOCKS,
    HttpStatus,
    PAIMON_PRIME,
    add_colb_docs,
    add_cowswap_tokenlist,
    add_fourmeme,
    add_jumper_bstocks,
    add_ondo_metadata,
    add_paimon,
    add_xstocks_nodes,
    classify_kind,
    count_issuers,
    exclusion_reason,
    load_universe,
    rows_from_stocksonchain,
)

_SCRIPT = Path(__file__).resolve().parent / "snapshot-bnb-volume.py"
_SPEC = importlib.util.spec_from_file_location("snapshot_bnb_volume", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
_MOD = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MOD)
lane_volume = _MOD.lane_volume
issuers_by_lane = _MOD.issuers_by_lane
sum_reported = _MOD.sum_reported
sum_nullable = _MOD.sum_nullable
reported_h24 = _MOD.reported_h24
sum_unique_pool_volumes = _MOD.sum_unique_pool_volumes

AAPL = "0x1111111111111111111111111111111111111111"
NVDA = "0x3333333333333333333333333333333333333333"
QQQ = "0x4444444444444444444444444444444444444444"
SPCX = "0x5555555555555555555555555555555555555555"
HOOD = "0x7777777777777777777777777777777777777777"
TQQQ = "0x8888888888888888888888888888888888888888"
BSTOCK = "0x9999999999999999999999999999999999999999"
TQQQB = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
COLB = "0xDeAa0f353C507A2F0d9b92d20e3fF0FF06f3ACe9"
XSPCX = "0x05353Dabf163Fb2fec87f9e0f00f94Eae4AC1631"
XOPAI = "0x7DdEF360f3C2DB4CC41C3967984fefa2598cC9A6"


def listing(chain: str, issuer: str, address: str, symbol: str = "TOKon") -> dict:
    return {
        "chain": chain,
        "issuer": issuer,
        "address": address,
        "onchainSymbol": symbol,
    }


class BnbUniverseTest(unittest.TestCase):
    def test_stocksonchain_keeps_new_issuers_and_drops_other_chains(self) -> None:
        payload = {
            "stocks": [
                {
                    "ticker": "AAPL",
                    "company": "Apple Inc.",
                    "kind": "stock",
                    "listings": [
                        listing("bnb-chain", "ondo", AAPL, "AAPLon"),
                        listing("ethereum", "ondo", "0x2222222222222222222222222222222222222222", "AAPLon"),
                    ],
                },
                {
                    "ticker": "NVDA",
                    "company": "NVIDIA Corporation",
                    "kind": "equity",
                    "listings": [listing("bsc", "new-issuer", NVDA, "NVDAx")],
                },
                {
                    "ticker": "QQQ",
                    "company": "Invesco QQQ Trust",
                    "kind": "etf",
                    "listings": [listing("56", "backed-xstocks", QQQ, "QQQx")],
                },
                {
                    "ticker": "SPCX",
                    "company": "SpaceX",
                    "kind": "private",
                    "listings": [listing("bnb-chain", "another-issuer", SPCX, "SPCXx")],
                },
                {
                    "ticker": "MEME",
                    "company": "Meme Coin",
                    "kind": "meme",
                    "listings": [listing("bnb-chain", "noise", "0x6666666666666666666666666666666666666666", "MEME")],
                },
                {
                    "ticker": "TQQQ",
                    "company": "ProShares UltraPro QQQ",
                    "kind": "etf",
                    "listings": [listing("bnb-chain", "ondo", TQQQ, "TQQQon")],
                },
                {
                    "ticker": "ALPINE",
                    "company": "Alpine F1 Fan Token",
                    "kind": "stock",
                    "listings": [listing("bnb-chain", "fan", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "ALPINE")],
                },
                {
                    "ticker": "BUIDL",
                    "company": "BlackRock USD Institutional Digital Liquidity Fund",
                    "kind": "etf",
                    "listings": [listing("bnb-chain", "ondo", "0xcccccccccccccccccccccccccccccccccccccccc", "BUIDL")],
                },
                {
                    "ticker": "HOOD",
                    "company": "Robinhood Markets, Inc.",
                    "kind": "stock",
                    "listings": [listing("bnb-chain", "", HOOD, "HOODx")],
                },
            ]
        }
        rows, _warnings = rows_from_stocksonchain(payload)
        by_ticker = {row["ticker"]: row for row in rows}
        self.assertEqual(set(by_ticker), {"AAPL", "NVDA", "QQQ", "SPCX", "HOOD"})
        self.assertEqual(by_ticker["NVDA"]["issuer"], "new-issuer")
        self.assertEqual(by_ticker["QQQ"]["issuer"], "xstocks")
        self.assertEqual(by_ticker["QQQ"]["kind"], "etf")
        self.assertEqual(by_ticker["SPCX"]["kind"], "preipo")
        self.assertEqual(by_ticker["HOOD"]["issuer"], "unknown")
        self.assertEqual(
            count_issuers(rows),
            {"another-issuer": 1, "new-issuer": 1, "ondo": 1, "unknown": 1, "xstocks": 1},
        )

    def test_leveraged_names_stay_out_and_plain_etfs_stay_in(self) -> None:
        self.assertEqual(exclusion_reason("TQQQon", "ProShares UltraPro QQQ", "TQQQ"), "leveraged")
        self.assertEqual(exclusion_reason("SOXSx", "3x Short Semiconductor ETF xStock", "SOXS"), "leveraged")
        self.assertEqual(exclusion_reason("VOW3x", "Volkswagen xStock", "VOW3"), None)
        self.assertEqual(exclusion_reason("JPSTx", "JPMorgan Ultra-Short Income xStock", "JPST"), None)
        self.assertEqual(exclusion_reason("SNXx", "TD Synnex xStock", "SNX"), None)
        self.assertEqual(exclusion_reason("SNXXB", "SNDK 2x Long ETF", "SNXX"), "leveraged")
        self.assertIsNone(
            exclusion_reason("STRCx", "Strategy Inc Variable Rate Series A Perpetual Stretch Preferred Stock", "STRC")
        )
        self.assertIsNone(classify_kind("etf", ticker="MYSTERY", name="Mystery Product"))
        self.assertEqual(classify_kind("etf", ticker="ARM", name="Arm Holdings plc"), "equity")
        self.assertIsNone(classify_kind("stock", ticker="TQQQ", name="ProShares UltraPro QQQ"))
        self.assertEqual(classify_kind("etf", ticker="QQQ", name="Invesco QQQ Trust"), "etf")
        self.assertEqual(classify_kind("pre-ipo", ticker="SPCX", name="SpaceX"), "preipo")

    def test_etf_is_classified_before_private_and_private_is_fail_closed(self) -> None:
        # ETF/index wins even when the registry kind is private/preipo.
        self.assertEqual(classify_kind("private", ticker="QQQ", name="Invesco QQQ Trust"), "etf")
        self.assertEqual(classify_kind("preipo", ticker="SPCX", name="SpaceX ETF"), "etf")
        self.assertEqual(classify_kind("pre_ipo", ticker="OPENAI", name="OpenAI"), "preipo")
        self.assertEqual(classify_kind("pre ipo", ticker="ANTHROPIC", name="Anthropic"), "preipo")
        # Kind string alone does not admit. Company name alone does not admit.
        self.assertIsNone(classify_kind("private", ticker="MYSTERY", name="Mystery Product"))
        self.assertIsNone(classify_kind("pre-ipo", ticker="BASKET", name="Pre-IPO Basket"))
        self.assertIsNone(classify_kind("stock", ticker="SPCX", name="SpaceX"))
        # Colb / Paimon wrappers are the BNB private mint signal.
        self.assertEqual(
            classify_kind("stock", ticker="CSPX", name="Colb SpaceX", issuer="colb"),
            "preipo",
        )
        self.assertEqual(
            classify_kind("stock", ticker="xOPAI", name="Paimon OpenAI SPV", issuer="Paimon Finance"),
            "preipo",
        )
        self.assertEqual(exclusion_reason("USDT", "Tether USD"), "crypto")
        self.assertEqual(exclusion_reason("PAXG", "Pax Gold"), "commodity")
        self.assertEqual(exclusion_reason("GOLD", "Tokenized Gold"), "commodity")
        self.assertEqual(exclusion_reason("STOCKS", "Tokenized Stocks"), "generic")
        self.assertEqual(classify_kind("etf", ticker="GLD", name="SPDR Gold Trust"), "etf")
        self.assertEqual(classify_kind("stock", ticker="AAPL", name="Apple Inc."), "equity")

        from bnb_volume_universe import Book

        book = Book()
        self.assertFalse(
            book.add(
                symbol="SPCXx",
                name="SpaceX",
                address=SPCX,
                issuer="copycat",
                source="test",
                ticker="SPCX",
                kind_raw="stock",
            )
        )
        self.assertFalse(
            book.add(
                symbol="CSPX",
                name="Colb SpaceX",
                address="0x1212121212121212121212121212121212121212",
                issuer="noise",
                source="test",
                ticker="CSPX",
                kind_raw="stock",
            )
        )
        self.assertFalse(
            book.add(
                symbol="USDT",
                name="Tether USD",
                address="0x1313131313131313131313131313131313131313",
                issuer="noise",
                source="test",
                ticker="USDT",
                kind_raw="stock",
            )
        )
        self.assertTrue(
            book.add(
                symbol="SPCXx",
                name="SpaceX",
                address=SPCX,
                issuer="another-issuer",
                source="test",
                ticker="SPCX",
                kind_raw="private",
            )
        )
        self.assertEqual(book.skipped.get("private"), 1)
        self.assertEqual(book.skipped.get("copycat"), 1)
        self.assertEqual(book.skipped.get("crypto"), 1)
        self.assertEqual(book.rows[0]["kind"], "preipo")

    def test_registries_union_by_address_and_keep_bnb_only(self) -> None:
        from bnb_volume_universe import Book

        book = Book()
        add_ondo_metadata(
            [
                {
                    "symbol": "AAPLon",
                    "ticker": "AAPL",
                    "underlyingName": "Apple",
                    "tags": {"assetClass": "Equities", "instrumentType": "Stock"},
                    "addresses": [
                        {"networkChainId": "bsc-56", "address": AAPL},
                        {"networkChainId": "ethereum-1", "address": "0x2222222222222222222222222222222222222222"},
                    ],
                }
            ],
            book,
        )
        add_xstocks_nodes(
            {
                "nodes": [
                    {
                        "symbol": "AAPLx",
                        "name": "Apple xStock",
                        "underlyingSymbol": "AAPL",
                        "underlying": {"symbol": "AAPL", "type": None},
                        "deployments": [
                            {"network": "BinanceSmartChain", "address": NVDA},
                            {"network": "Solana", "address": "NotAnEvmAddress"},
                            {"network": "Ethereum", "address": "0x2222222222222222222222222222222222222222"},
                        ],
                    },
                    {
                        "symbol": "TQQQx",
                        "name": "ProShares UltraPro QQQ xStock",
                        "underlying": {"symbol": "TQQQ"},
                        "deployments": [{"network": "BinanceSmartChain", "address": TQQQ}],
                    },
                ]
            },
            book,
        )
        add_cowswap_tokenlist(
            {
                "tokens": [
                    {"chainId": 56, "address": NVDA, "symbol": "NVDAx", "name": "NVIDIA xStock"},
                    {"chainId": 1, "address": "0x2222222222222222222222222222222222222222", "symbol": "NVDAx", "name": "NVIDIA xStock"},
                    {"chainId": 56, "address": QQQ, "symbol": "QQQx", "name": "Invesco QQQ Trust xStock"},
                ]
            },
            book,
        )
        add_jumper_bstocks(
            '"underlying":"AAPL","name":"Apple","kind":"stock","instances":['
            '{"provider":"bStocks","tokenSymbol":"AAPLB","chain":"bsc","chainId":56,"address":"' + BSTOCK + '"},'
            '{"provider":"Ondo","tokenSymbol":"AAPLon","chain":"ethereum","chainId":1,"address":"0x2222222222222222222222222222222222222222"}'
            '],"assetClass":"Stocks"'
            '"underlying":"TQQQ","name":"ProShares UltraPro QQQ","kind":"etf","instances":['
            '{"provider":"bStocks","tokenSymbol":"TQQQB","chain":"bsc","chainId":56,"address":"' + TQQQB + '"}'
            ']',
            book,
        )
        add_colb_docs(
            "### BNB Chain\n| Colb SpaceX (CSPX) | `" + COLB + "` |\n"
            "| Colb SpaceX Oracle | `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` |\n"
            "### Moonbeam\n| Colb Balanced USD (CBAL) | `0xffffffffffffffffffffffffffffffffffffffff` |\n",
            book,
        )
        add_paimon(
            '<a href="/assets/xspcx"> Paimon SpaceX SPV Tradable Token $ xSPCX '
            f'<a href="https://bscscan.com/token/{XSPCX}"></a>'
            '<a href="/assets/xopai"> Paimon OpenAI SPV Tradable Token $ xOPAI '
            f'<a href="https://bscscan.com/token/{XOPAI}"></a>'
            f'<a href="/assets/pp"> Paimon Prime $ PPT <a href="https://bscscan.com/token/{PAIMON_PRIME}"></a>',
            book,
        )
        by_addr = {row["address"].lower(): row for row in book.rows}
        self.assertIn(AAPL, by_addr)
        self.assertEqual(by_addr[AAPL]["issuer"], "ondo")
        self.assertIn(NVDA, by_addr)
        self.assertEqual(by_addr[NVDA]["issuer"], "xstocks")
        self.assertEqual(by_addr[QQQ.lower()]["kind"], "etf")
        self.assertIn(BSTOCK, by_addr)
        self.assertEqual(by_addr[BSTOCK]["issuer"], "bstocks")
        self.assertNotIn(TQQQ, by_addr)
        self.assertNotIn(TQQQB, by_addr)
        self.assertEqual(by_addr[COLB.lower()]["issuer"], "colb")
        self.assertEqual(by_addr[COLB.lower()]["kind"], "preipo")
        self.assertNotIn("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", by_addr)
        self.assertNotIn("0xffffffffffffffffffffffffffffffffffffffff", by_addr)
        self.assertEqual(by_addr[XSPCX.lower()]["issuer"], "paimon")
        self.assertEqual(by_addr[XOPAI.lower()]["kind"], "preipo")
        self.assertNotIn(PAIMON_PRIME, by_addr)
        self.assertIn("0x6dc9a487bf8fd047e41ab336003ae6e4fe602646", by_addr)
        issuers = count_issuers(book.rows)
        self.assertEqual(set(issuers), {"ondo", "xstocks", "bstocks", "colb", "paimon"})

    def test_ondo_403_does_not_drop_the_other_registries(self) -> None:
        def fetch(url: str):
            if "ondo.finance" in url or "bstocks.finance" in url:
                raise HttpStatus(url, 403)
            if "stocksonchain" in url:
                return {
                    "stocks": [
                        {
                            "ticker": "AAPL",
                            "company": "Apple Inc.",
                            "kind": "stock",
                            "listings": [listing("bnb-chain", "ondo", AAPL, "AAPLon")],
                        }
                    ]
                }
            if "xstocks.fi" in url:
                return {"nodes": [], "page": {"hasNextPage": False}}
            if "tokenlist" in url:
                return {"tokens": []}
            if "jumper" in url:
                return (
                    '"underlying":"NVDA","name":"NVIDIA","kind":"stock","instances":['
                    '{"provider":"bStocks","tokenSymbol":"NVDAB","chain":"bsc","chainId":56,"address":"'
                    + BSTOCK
                    + '"}]'
                )
            if "colb.finance" in url:
                return "### BNB Chain\n| Colb SpaceX (CSPX) | `" + COLB + "` |\n### Moonbeam\n"
            if "paimon" in url:
                return (
                    '<a href="/assets/xspcx"> Paimon SpaceX SPV Tradable Token $ xSPCX '
                    f'<a href="https://bscscan.com/token/{XSPCX}"></a>'
                )
            raise HttpStatus(url, 404)

        rows, warnings, meta = load_universe(fetch)
        issuers = count_issuers(rows)
        self.assertEqual(issuers["ondo"], 1)
        self.assertEqual(issuers["bstocks"], 1)
        self.assertEqual(issuers["colb"], 1)
        self.assertGreaterEqual(issuers["paimon"], 1)
        self.assertEqual(issuers["fourmeme"], 1)
        bnc4 = next(row for row in rows if row["issuer"] == "fourmeme")
        self.assertEqual(bnc4["symbol"], "BNC4")
        self.assertEqual(bnc4["kind"], "equity")
        self.assertEqual(bnc4["address"], FOURMEME_4STOCKS[0][2])
        self.assertEqual(meta["registries"]["ondo-gm"]["status"], 403)
        self.assertEqual(meta["registries"]["bstocks-finance"]["status"], 403)
        self.assertTrue(any("HTTP 403" in warning and "ondo" in warning for warning in warnings))
        self.assertTrue(any("HTTP 403" in warning and "bstocks.finance" in warning for warning in warnings))

    def test_missing_volume_stays_null_and_reported_zero_stays_zero(self) -> None:
        self.assertIsNone(sum_reported([None, None]))
        self.assertEqual(sum_reported([None, 0.0]), 0.0)
        self.assertEqual(sum_reported([1.5, None, 2.0]), 3.5)
        rows = [
            {"address": "0xaaa", "kind": "equity"},
            {"address": "0xbbb", "kind": "equity"},
            {"address": "0xccc", "kind": "etf"},
        ]
        self.assertIsNone(lane_volume(rows, {"0xaaa": None, "0xbbb": None, "0xccc": 4.0}, "equity"))
        self.assertEqual(lane_volume(rows, {"0xaaa": None, "0xbbb": 0.0, "0xccc": None}, "equity"), 0.0)
        self.assertEqual(lane_volume(rows, {"0xaaa": 2.0, "0xbbb": None, "0xccc": 4.0}, "etf"), 4.0)
        private_rows = [
            {"address": AAPL, "kind": "preipo"},
            {"address": NVDA, "kind": "equity"},
            {"address": QQQ, "kind": "etf"},
        ]
        private_vols = {AAPL.lower(): None, NVDA.lower(): 5.0, QQQ.lower(): None}
        self.assertIsNone(lane_volume(private_rows, private_vols, "preipo"))
        self.assertIsNone(lane_volume(private_rows, private_vols, "etf"))
        self.assertEqual(
            sum_nullable(
                [
                    lane_volume(private_rows, private_vols, "equity"),
                    lane_volume(private_rows, private_vols, "preipo"),
                    lane_volume(private_rows, private_vols, "etf"),
                ]
            ),
            5.0,
        )
        self.assertIs(sum_reported, sum_nullable)

    def test_issuers_by_lane_partitions_sum_nullable(self) -> None:
        rows = [
            {"address": AAPL, "kind": "equity", "issuer": "Backed / xStocks"},
            {"address": NVDA, "kind": "equity", "issuer": "ondo"},
            {"address": HOOD, "kind": "equity", "issuer": "ondo"},
            {"address": QQQ, "kind": "etf", "issuer": "xstocks"},
            {"address": SPCX, "kind": "preipo", "issuer": "paimon"},
            {"address": XSPCX, "kind": "preipo", "issuer": "colb"},
            {"address": TQQQ, "kind": "other", "issuer": "xstocks"},
        ]
        vols = {
            AAPL.lower(): 10.0,
            NVDA.lower(): None,
            HOOD.lower(): 0.0,
            QQQ.lower(): None,
            SPCX.lower(): 2.5,
            XSPCX.lower(): None,
            TQQQ.lower(): 99.0,
        }
        pools = {
            AAPL.lower(): 2,
            NVDA.lower(): 0,
            HOOD.lower(): 1,
            QQQ.lower(): 3,
            SPCX.lower(): 1,
            XSPCX.lower(): 0,
        }
        breakdown = issuers_by_lane(rows, vols, pools)
        self.assertEqual(list(breakdown), ["equity", "etf", "private"])
        self.assertEqual(list(breakdown["equity"]), ["ondo", "xstocks"])
        self.assertEqual(breakdown["equity"]["xstocks"], {"usd": 10.0, "mints": 1, "pools": 2})
        self.assertEqual(breakdown["equity"]["ondo"], {"usd": 0.0, "mints": 2, "pools": 1})
        self.assertEqual(breakdown["etf"]["xstocks"]["usd"], None)
        self.assertEqual(breakdown["etf"]["xstocks"]["mints"], 1)
        self.assertEqual(breakdown["etf"]["xstocks"]["pools"], 3)
        self.assertNotIn("xstocks", breakdown["private"])
        self.assertIsNone(breakdown["private"]["colb"]["usd"])
        self.assertEqual(breakdown["private"]["colb"]["mints"], 1)
        self.assertEqual(breakdown["private"]["paimon"], {"usd": 2.5, "mints": 1, "pools": 1})
        for kind, field in (("equity", "equity"), ("etf", "etf"), ("preipo", "private")):
            self.assertEqual(
                lane_volume(rows, vols, kind),
                sum_nullable([stats["usd"] for stats in breakdown[field].values()]),
            )
            self.assertEqual(
                sum(1 for row in rows if row["kind"] == kind),
                sum(stats["mints"] for stats in breakdown[field].values()),
            )
        self.assertNotIn("other", breakdown)

    def test_unique_bnb_pools_omit_invalid_h24_and_keep_reported_zero(self) -> None:
        quote = "0x" + "ab" * 20
        pairs = [
            {
                "chainId": "bsc",
                "pairAddress": "0xpool",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": quote},
                "volume": {"h24": 10},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xpool",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": quote},
                "volume": {"h24": 10},
            },
            {
                "chainId": "ethereum",
                "pairAddress": "0xeth",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": quote},
                "volume": {"h24": 99},
            },
            {
                "chainId": 56,
                "pairAddress": "0xzero",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": quote},
                "volume": {"h24": 0},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xbad",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": quote},
                "volume": {"h24": "nope"},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xnan",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": quote},
                "volume": {"h24": float("nan")},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xother",
                "baseToken": {"address": NVDA},
                "quoteToken": {"address": quote},
                "volume": {"h24": None},
            },
        ]
        totals, counts = sum_unique_pool_volumes(pairs, {AAPL, NVDA, QQQ})
        self.assertEqual(totals[AAPL.lower()], 10.0)
        self.assertEqual(counts[AAPL.lower()], 4)
        self.assertIsNone(totals[NVDA.lower()])
        self.assertEqual(counts[NVDA.lower()], 1)
        self.assertIsNone(totals[QQQ.lower()])
        self.assertEqual(counts[QQQ.lower()], 0)
        self.assertIsNone(reported_h24(None))
        self.assertIsNone(reported_h24(float("nan")))
        self.assertIsNone(reported_h24(-1))
        self.assertEqual(reported_h24(0), 0.0)
        self.assertEqual(reported_h24("0"), 0.0)

    def test_fourmeme_seed_is_public_equity_and_easy_to_extend(self) -> None:
        from bnb_volume_universe import Book

        self.assertEqual(FOURMEME_4STOCKS[0][0], "BNC4")
        self.assertEqual(FOURMEME_4STOCKS[0][3], "BNC")
        book = Book()
        self.assertEqual(add_fourmeme(book), 1)
        self.assertEqual(add_fourmeme(book), 0)
        row = book.rows[0]
        self.assertEqual(row["issuer"], "fourmeme")
        self.assertEqual(row["kind"], "equity")
        self.assertEqual(row["symbol"], "BNC4")
        self.assertEqual(row["name"], "Cea Industries")
        self.assertEqual(row["ticker"], "BNC")
        self.assertEqual(row["source"], "fourmeme")

    def test_fourmeme_counts_only_base_against_real_quotes(self) -> None:
        bnc4 = FOURMEME_4STOCKS[0][2]
        usdt = "0x55d398326f99059ff775485246999027b3197955"
        bncb = "0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f"
        meme = "0x" + "cd" * 20
        pairs = [
            {
                "chainId": "bsc",
                "pairAddress": "0xusdt",
                "baseToken": {"address": bnc4},
                "quoteToken": {"address": usdt},
                "volume": {"h24": 100},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xusdt",
                "baseToken": {"address": bnc4},
                "quoteToken": {"address": usdt},
                "volume": {"h24": 100},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xusdc",
                "baseToken": {"address": bnc4},
                "quoteToken": {"address": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"},
                "volume": {"h24": 40},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xwbnb",
                "baseToken": {"address": bnc4},
                "quoteToken": {"address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"},
                "volume": {"h24": 0},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xbncb",
                "baseToken": {"address": bnc4},
                "quoteToken": {"address": bncb},
                "volume": {"h24": 500},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xmeme-quote",
                "baseToken": {"address": meme, "symbol": "MEME"},
                "quoteToken": {"address": bnc4},
                "volume": {"h24": 9000},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xmeme-base",
                "baseToken": {"address": bnc4},
                "quoteToken": {"address": meme, "symbol": "BOB"},
                "volume": {"h24": 700},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xother-stock",
                "baseToken": {"address": meme},
                "quoteToken": {"address": AAPL},
                "volume": {"h24": 3},
            },
        ]
        restricted = {bnc4.lower()}
        totals, counts = sum_unique_pool_volumes(
            pairs,
            {bnc4, AAPL},
            base_against_quotes=restricted,
            quote_assets=_MOD.BNB_QUOTE_ASSETS,
        )
        self.assertEqual(totals[bnc4.lower()], 140.0)
        self.assertEqual(counts[bnc4.lower()], 3)
        self.assertEqual(totals[AAPL.lower()], 3.0)
        self.assertEqual(counts[AAPL.lower()], 1)

    def test_writer_does_not_hardcode_an_issuer_allowlist(self) -> None:
        text = _SCRIPT.read_text() + Path(__file__).with_name("bnb_volume_universe.py").read_text()
        self.assertNotIn("ALLOWED_ISSUERS", text)
        self.assertIn("every issuer", text)
        self.assertIn(f"chainId {CHAIN_ID}", text)
        self.assertIn(CHAIN_SLUG, text)
        self.assertNotIn("geckoterminal", text.lower())


if __name__ == "__main__":
    raise SystemExit(unittest.main())
