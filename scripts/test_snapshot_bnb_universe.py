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
        self.assertEqual(by_ticker["SPCX"]["kind"], "equity")
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
        self.assertEqual(classify_kind("pre-ipo", ticker="SPCX", name="SpaceX"), "equity")
        self.assertEqual(classify_kind("stock", ticker="SPCXB", name="SpaceX", issuer="bstocks", underlying="SPCX"), "equity")

    def test_etf_is_classified_before_private_and_private_is_fail_closed(self) -> None:
        # ETF/index wins even when the registry kind is private/preipo.
        self.assertEqual(classify_kind("private", ticker="QQQ", name="Invesco QQQ Trust"), "etf")
        self.assertEqual(classify_kind("preipo", ticker="SPCX", name="SpaceX ETF"), "etf")
        self.assertEqual(classify_kind("pre_ipo", ticker="OPENAI", name="OpenAI"), "preipo")
        self.assertEqual(classify_kind("pre ipo", ticker="ANTHROPIC", name="Anthropic"), "preipo")
        # Kind string alone does not admit. Company name alone does not admit.
        self.assertIsNone(classify_kind("private", ticker="MYSTERY", name="Mystery Product"))
        self.assertIsNone(classify_kind("pre-ipo", ticker="BASKET", name="Pre-IPO Basket"))
        self.assertEqual(classify_kind("stock", ticker="SPCX", name="SpaceX"), "equity")
        self.assertEqual(classify_kind("private", ticker="SPCX", name="SpaceX", issuer="bstocks"), "equity")
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
        self.assertTrue(
            book.add(
                symbol="SPCXx",
                name="SpaceX",
                address=SPCX,
                issuer="xstocks",
                source="test",
                ticker="SPCX",
                kind_raw="stock",
            )
        )
        self.assertEqual(book.rows[0]["kind"], "equity")
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
        self.assertFalse(
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
        self.assertEqual(book.skipped.get("duplicate"), 1)
        self.assertEqual(book.skipped.get("copycat"), 1)
        self.assertEqual(book.skipped.get("crypto"), 1)
        self.assertEqual(book.rows[0]["kind"], "equity")

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
        self.assertGreaterEqual(issuers["bstocks"], 69)
        bncb = next(row for row in rows if row["symbol"] == "BNCB")
        self.assertEqual(bncb["address"].lower(), "0x4902c5ebc598265ed2212b559b042de8a5eeec3f")
        self.assertEqual(bncb["issuer"], "bstocks")
        self.assertEqual(bncb["kind"], "equity")
        spcxb = next(row for row in rows if row["symbol"] == "SPCXB")
        self.assertEqual(spcxb["kind"], "equity")
        self.assertEqual(spcxb["issuer"], "bstocks")
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

    def test_stock_stock_pool_is_counted_once_on_the_base(self) -> None:
        quote = "0x" + "11" * 20
        pairs = [
            {
                "chainId": "bsc",
                "pairAddress": "0xcross",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": NVDA},
                "volume": {"h24": 80},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xcross",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": NVDA},
                "volume": {"h24": 80},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xusdt",
                "baseToken": {"address": NVDA},
                "quoteToken": {"address": quote},
                "volume": {"h24": 5},
            },
        ]
        tracked = {
            AAPL.lower(): {"address": AAPL},
            NVDA.lower(): {"address": NVDA},
            QQQ.lower(): {"address": QQQ},
        }
        totals, counts, _details, _pair_h24 = _MOD.fold_desk_pools(pairs, tracked)
        self.assertEqual(totals[AAPL.lower()], 80.0)
        self.assertEqual(totals[NVDA.lower()], 5.0)
        self.assertEqual(counts[AAPL.lower()], 1)
        self.assertEqual(counts[NVDA.lower()], 1)

    def test_writer_reads_token_pairs_for_every_mint(self) -> None:
        text = Path(__file__).resolve().parent.joinpath("snapshot-bnb-volume.py").read_text()
        self.assertIn("token-pairs/v1/bsc", text)
        self.assertIn("latest/dex/pairs/bsc", text)
        self.assertIn("for addr in sorted(by_addr)", text)
        self.assertNotIn("for addr in sorted(restricted)", text)

    def test_writer_does_not_hardcode_an_issuer_allowlist(self) -> None:
        text = _SCRIPT.read_text() + Path(__file__).with_name("bnb_volume_universe.py").read_text()
        self.assertNotIn("ALLOWED_ISSUERS", text)
        self.assertIn("every issuer", text)
        self.assertIn(f"chainId {CHAIN_ID}", text)
        self.assertIn(CHAIN_SLUG, text)
        self.assertIn("token-pairs/v1", text)
        self.assertIn("geckoterminal", text.lower())
        self.assertIn("cash", text.lower())

    def test_cash_quotes_apply_to_every_mint_and_stock_pairs_count_once(self) -> None:
        usdt = "0x55d398326f99059ff775485246999027b3197955"
        meme = "0x" + "cd" * 20
        pairs = [
            {
                "chainId": "bsc",
                "pairAddress": "0xcash",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": usdt},
                "volume": {"h24": 10},
                "liquidity": {"usd": 5000},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xmeme",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": meme},
                "volume": {"h24": 80},
                "liquidity": {"usd": 9000},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xcross",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": NVDA},
                "volume": {"h24": 4},
                "liquidity": {"usd": 2000},
            },
            {
                "chainId": "bsc",
                "pairAddress": "0xwash",
                "dexId": "uniswap-v4-bsc",
                "baseToken": {"address": AAPL},
                "quoteToken": {"address": usdt},
                "volume": {"h24": 273000},
                "liquidity": {"usd": 5},
            },
        ]
        tracked = {
            AAPL.lower(): {"address": AAPL, "symbol": "AAPL"},
            NVDA.lower(): {"address": NVDA, "symbol": "NVDA"},
        }
        vols, counts, details, _pair_h24 = _MOD.fold_desk_pools(pairs, tracked)
        self.assertEqual(vols[AAPL.lower()], 14.0)
        self.assertEqual(counts[AAPL.lower()], 2)
        self.assertIsNone(vols[NVDA.lower()])
        self.assertEqual(counts[NVDA.lower()], 0)
        sources = {pool["source"] for pool in details[AAPL.lower()]}
        self.assertEqual(sources, {"dexscreener"})

    def test_ppoly_united_stables_wash_is_excluded_from_the_desk_sum(self) -> None:
        usdt = "0x55d398326f99059ff775485246999027b3197955"
        ppoly = "0x1d80392d12caaaf9e333bb0bb7f021eacf297fe6"
        united = "0xce24439f2d9c6a2289f741120fe202248b666666"
        wash = "0xe2d5738b246526194b19adf0dcdf5fc511126d276798e8fe5102ed464f7720e2"
        fresh = "0x" + "ab" * 32
        pairs = [
            {
                "chainId": "bsc",
                "pairAddress": "0xgoodppoly",
                "dexId": "pancakeswap",
                "baseToken": {"address": ppoly},
                "quoteToken": {"address": usdt},
                "volume": {"h24": 12.5},
                "liquidity": {"usd": 200_000},
            },
            {
                "chainId": "bsc",
                "pairAddress": wash,
                "dexId": "pancakeswap-infinity-clmm",
                "baseToken": {"address": ppoly},
                "quoteToken": {"address": usdt},
                "volume": {"h24": 9_000_000},
                "liquidity": {"usd": 2_670_000},
            },
            {
                "chainId": "bsc",
                "pairAddress": fresh,
                "dexId": "uniswap-v4-bsc",
                "baseToken": {"address": ppoly},
                "quoteToken": {"address": united},
                "volume": {"h24": 8_000_000},
                "liquidity": {"usd": 50_000},
            },
        ]
        tracked = {ppoly: {"address": ppoly, "symbol": "pPOLY"}}
        vols, counts, details, _pair_h24 = _MOD.fold_desk_pools(pairs, tracked)
        self.assertEqual(vols[ppoly], 12.5)
        self.assertEqual(counts[ppoly], 1)
        self.assertEqual([pool["pairAddress"] for pool in details[ppoly]], ["0xgoodppoly"])

    def test_backfill_skips_ppoly_united_stables_pool(self) -> None:
        path = Path(__file__).resolve().parent / "backfill-bnb-gecko-hourly.py"
        spec = importlib.util.spec_from_file_location("backfill_bnb_gecko_hourly", path)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        day = "2026-10-07"
        start = mod.eastern_midnight(day)
        ppoly = "0x1d80392d12caaaf9e333bb0bb7f021eacf297fe6"
        wash = "0xe2d5738b246526194b19adf0dcdf5fc511126d276798e8fe5102ed464f7720e2"
        good = "0xb2c8244fbeee2da006b5d9cf09908081f807c649"
        catalog = {
            ppoly: {
                "address": ppoly,
                "symbol": "pPOLY",
                "issuer": "paimon",
                "kind": "preipo",
                "pools": [
                    {"pairAddress": wash, "dexId": "pancakeswap-infinity-clmm", "uniswapV4": False},
                    {"pairAddress": good, "dexId": "pancakeswap-v3-bsc", "uniswapV4": False},
                ],
            }
        }
        rebuilt = mod.rebuild(
            {
                "date": day,
                "assets": [],
                "publicEquity24hUsd": None,
                "etfIndex24hUsd": None,
                "private24hUsd": None,
                "combined24hUsd": None,
            },
            catalog,
            {wash: [(start, 50_000_000.0)], good: [(start, 12.5)]},
        )
        asset = next(row for row in rebuilt["assets"] if row["symbol"] == "pPOLY")
        self.assertEqual(asset["volume24hUsd"], 12.5)
        self.assertEqual([pool["pairAddress"] for pool in asset["pools"]], [good])
        self.assertEqual(rebuilt["private24hUsd"], 12.5)
        self.assertIn(f"excluded-pool:pPOLY:{wash}:", rebuilt["backfillNote"])

    def test_registry_keeps_cash_pools_and_drops_meme_pairs(self) -> None:
        usdt = "0x55d398326f99059ff775485246999027b3197955"
        meme = "0x" + "ab" * 20
        rows = [{"address": AAPL, "symbol": "AAPLB", "issuer": "bstocks", "kind": "equity"}]
        payload = {
            "pairs": [
                {
                    "chainId": "bsc",
                    "pairAddress": "0xcashpool",
                    "dexId": "pancakeswap",
                    "baseToken": {"address": AAPL},
                    "quoteToken": {"address": usdt},
                    "volume": {"h24": 10},
                    "liquidity": {"usd": 5000},
                },
                {
                    "chainId": "bsc",
                    "pairAddress": "0xmemepool",
                    "dexId": "pancakeswap",
                    "baseToken": {"address": AAPL},
                    "quoteToken": {"address": meme},
                    "volume": {"h24": 80},
                    "liquidity": {"usd": 9000},
                },
            ]
        }
        vols, _counts, _details, warnings, _pair_h24, known = _MOD.hydrate_volumes(
            rows, {}, fetch=lambda _url: payload, discover_gecko=False
        )
        self.assertEqual(warnings, [])
        self.assertEqual(vols[AAPL.lower()], 10.0)
        pools = known[AAPL.lower()]["pools"]
        self.assertIn("0xcashpool", pools)
        self.assertNotIn("0xmemepool", pools)

    def test_volume_drop_warns_without_blanking(self) -> None:
        rows = [{"address": AAPL, "symbol": "AAPLB", "kind": "equity"}]
        vols = {AAPL.lower(): 5.0}
        known = {
            AAPL.lower(): {
                "mainPool": "0xmain",
                "pools": {"0xmain": {"pairAddress": "0xmain"}},
            }
        }
        warnings = _MOD.volume_drop_warnings(
            rows,
            vols,
            known,
            {"0xmain": 80_000.0},
            {AAPL.lower(): 100.0},
        )
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["volume24hUsd"], 5.0)
        self.assertEqual(vols[AAPL.lower()], 5.0)
        quiet = _MOD.volume_drop_warnings(
            rows,
            vols,
            known,
            {"0xmain": 0.0},
            {AAPL.lower(): 100.0},
        )
        self.assertEqual(quiet, [])

    def test_seed_bstocks_are_equity_and_fakes_stay_out(self) -> None:
        from bnb_volume_universe import (
            BSTOCKS_SEED,
            Book,
            add_bstocks_seed,
            discover_bstocks_from_pairs,
        )

        book = Book()
        self.assertGreaterEqual(add_bstocks_seed(book), 69)
        by_symbol = {row["symbol"]: row for row in book.rows}
        self.assertEqual(by_symbol["SPCXB"]["kind"], "equity")
        self.assertEqual(by_symbol["BNCB"]["kind"], "equity")
        self.assertEqual(by_symbol["BNCB"]["issuer"], "bstocks")
        self.assertEqual(by_symbol["BNCB"]["address"].lower(), "0x4902c5ebc598265ed2212b559b042de8a5eeec3f")
        self.assertEqual(by_symbol["QQQB"]["kind"], "etf")
        self.assertEqual(by_symbol["DRAMB"]["kind"], "etf")
        self.assertEqual(by_symbol["SPYB"]["kind"], "etf")
        self.assertIn("LLYB", by_symbol)
        self.assertFalse(
            book.add(
                symbol="PDDB",
                name="PDD Holdings",
                address="0x1d55111111111111111111111111111111111111",
                issuer="bstocks",
                source="test",
                ticker="PDD",
                kind_raw="equity",
            )
        )
        self.assertFalse(
            book.add(
                symbol="SOXLB",
                name="Direxion Semiconductor Bull 3X",
                address="0x2222222222222222222222222222222222222222",
                issuer="bstocks",
                source="test",
                ticker="SOXL",
                kind_raw="etf",
            )
        )
        fresh = "0x3333333333333333333333333333333333333333"
        added = discover_bstocks_from_pairs(
            [
                {
                    "chainId": "bsc",
                    "baseToken": {"address": fresh, "symbol": "NEWB", "name": "New Co"},
                    "quoteToken": {"address": "0x55d398326f99059ff775485246999027b3197955", "symbol": "USDT"},
                },
                {
                    "chainId": "bsc",
                    "baseToken": {"address": "0x4444444444444444444444444444444444444444", "symbol": "FAKEB", "name": "Nope"},
                    "quoteToken": {"address": "0x55d398326f99059ff775485246999027b3197955", "symbol": "USDT"},
                },
            ],
            book,
            lambda address: "0x156d6dce9a4f6139a3406f1f021f1a4880de93a3" if address.lower() == fresh else "0x" + "11" * 20,
        )
        self.assertEqual(added, 1)
        self.assertEqual(next(row for row in book.rows if row["symbol"] == "NEWB")["source"], "bstocks-beacon")
        self.assertTrue(any(sym == "SPCXB" for sym, _name, _addr, _tick in BSTOCKS_SEED))
        self.assertTrue(any(sym == "BNCB" for sym, _name, _addr, _tick in BSTOCKS_SEED))

    def test_snapshot_history_keeps_a_high_volume_mint_and_warns(self) -> None:
        from bnb_volume_universe import load_universe as load

        gone = "0x" + "12" * 20
        quiet = "0x" + "13" * 20
        etf = "0x" + "14" * 20

        def fetch(url: str):
            if "stocksonchain" in url:
                return {"stocks": []}
            if "xstocks.fi" in url:
                return {"nodes": [], "page": {"hasNextPage": False}}
            if "tokenlist" in url or "dexscreener" in url:
                return {"tokens": [], "pairs": []}
            if "colb" in url:
                return "### BNB Chain\n### Moonbeam\n"
            if "jumper" in url or "paimon" in url or "ondo" in url or "bstocks.finance" in url:
                return ""
            raise HttpStatus(url, 404)

        records = [
            {
                "date": "2026-10-10",
                "assets": [
                    {
                        "address": gone,
                        "symbol": "GONEB",
                        "issuer": "bstocks",
                        "instrumentKind": "equity",
                        "volume24hUsd": 150_000.5,
                    },
                    {
                        "address": quiet,
                        "symbol": "QUIETB",
                        "issuer": "bstocks",
                        "instrumentKind": "equity",
                        "volume24hUsd": 100_000,
                    },
                    {
                        "address": etf,
                        "symbol": "HISTB",
                        "issuer": "ondo",
                        "instrumentKind": "etf",
                        "volume24hUsd": 250_000,
                    },
                ],
            }
        ]
        rows, warnings, meta = load(fetch, snapshot_records=records)
        by_addr = {row["address"].lower(): row for row in rows}
        self.assertEqual(by_addr[gone]["source"], "snapshot-seen")
        self.assertEqual(by_addr[gone]["issuer"], "bstocks")
        self.assertEqual(by_addr[gone]["kind"], "equity")
        self.assertEqual(by_addr[quiet]["source"], "snapshot-seen")
        self.assertEqual(by_addr[etf]["kind"], "etf")
        self.assertEqual(by_addr[etf]["issuer"], "ondo")
        self.assertEqual(by_addr["0x4902c5ebc598265ed2212b559b042de8a5eeec3f"]["source"], "bstocks-seed")
        self.assertTrue(any("GONEB" in warning and "kept from snapshot history" in warning for warning in warnings))
        self.assertTrue(any("HISTB" in warning and "kept from snapshot history" in warning for warning in warnings))
        self.assertFalse(any("QUIETB" in warning for warning in warnings))
        self.assertFalse(any("BNCB" in warning and "vanished" in warning for warning in warnings))
        self.assertGreater(meta["registries"]["snapshot-seen"]["added"], 0)
        self.assertGreater(len(rows), 3)


USDT = "0x55d398326f99059ff775485246999027b3197955"
WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
DAI = "0x1AF3F329e8be154074D8769D1FFa4eE058B1DBc3"


def price_pair(
    base: str,
    quote: str,
    pair: str,
    price: float,
    liquidity: float,
    *,
    volume: float = 1000,
    change: float = 0,
    base_amt: float | None = None,
    quote_amt: float | None = None,
    chain: str = "bsc",
) -> dict:
    liquidity_row: dict = {"usd": liquidity}
    if base_amt is not None:
        liquidity_row["base"] = base_amt
    if quote_amt is not None:
        liquidity_row["quote"] = quote_amt
    return {
        "chainId": chain,
        "pairAddress": pair,
        "baseToken": {"address": base},
        "quoteToken": {"address": quote},
        "priceUsd": str(price),
        "priceNative": str(price),
        "priceChange": {"h24": change},
        "volume": {"h24": volume},
        "liquidity": liquidity_row,
    }


class BnbMarketValueTest(unittest.TestCase):
    def test_cash_pool_price_skips_guard_failures_and_non_cash_quotes(self) -> None:
        from bnb_market_value import index_cash_price_candidates, resolve_market_values

        meme = "0x" + "cd" * 20
        pairs = [
            price_pair(AAPL, meme, "0x" + "01" * 20, 80, 9_000_000),
            price_pair(AAPL, DAI, "0x" + "02" * 20, 70, 8_000_000),
            price_pair(AAPL, USDT, "0x" + "03" * 20, 50, 60_000_000, volume=1),
            price_pair(AAPL, WBNB, "0x" + "04" * 20, 4, 10_000),
            price_pair(AAPL, USDT, "0x" + "05" * 20, 3, 2_000),
            price_pair(USDT, AAPL, "0x" + "06" * 20, 1, 20_000_000),
            price_pair(AAPL, USDT, "0x" + "07" * 20, 9, 50_000, chain="ethereum"),
        ]
        candidates = index_cash_price_candidates(pairs, {AAPL.lower()})
        readings, warnings, nulls = resolve_market_values(
            [{"address": AAPL, "symbol": "AAPLB", "kind": "equity", "issuer": "xstocks"}],
            {AAPL.lower(): 10},
            candidates,
            {},
        )
        self.assertEqual(readings[AAPL.lower()]["priceUsd"], 4)
        self.assertEqual(readings[AAPL.lower()]["priceSource"], "dexscreener")
        self.assertEqual(readings[AAPL.lower()]["marketValueUsd"], 40)
        self.assertEqual(readings[AAPL.lower()]["supply"], 10)
        self.assertEqual(warnings, [])
        self.assertEqual(nulls, {})

    def test_price_far_from_pool_history_falls_through_to_gecko_or_null(self) -> None:
        from bnb_market_value import index_cash_price_candidates, resolve_market_values

        pairs = [price_pair(AAPL, USDT, "0x" + "11" * 20, 350, 10_000, change=5000)]
        candidates = index_cash_price_candidates(pairs, {AAPL.lower()})
        row = {"address": AAPL, "symbol": "AAPLB", "kind": "equity", "issuer": "ondo"}
        near, warnings, nulls = resolve_market_values([row], {AAPL.lower(): 2}, candidates, {AAPL.lower(): 354})
        self.assertEqual(near[AAPL.lower()]["priceSource"], "geckoterminal")
        self.assertEqual(near[AAPL.lower()]["priceUsd"], 354)
        self.assertEqual(near[AAPL.lower()]["marketValueUsd"], 708)
        self.assertEqual(warnings[0]["reason"], "price-far-from-pool-history")
        self.assertEqual(nulls, {})

        dead = price_pair(NVDA, USDT, "0x" + "12" * 20, 100, 60_000_000, volume=1, change=0)
        dead_candidates = index_cash_price_candidates([dead], {NVDA.lower()})
        nvda = {"address": NVDA, "symbol": "NVDAB", "kind": "equity", "issuer": "bstocks"}
        far, far_warnings, far_nulls = resolve_market_values(
            [nvda], {NVDA.lower(): 2}, dead_candidates, {NVDA.lower(): 1500}
        )
        self.assertIsNone(far[NVDA.lower()]["marketValueUsd"])
        self.assertIsNone(far[NVDA.lower()]["priceUsd"])
        self.assertEqual(far[NVDA.lower()]["supply"], 2)
        self.assertIn("gecko-far-from-pool-history", {item["reason"] for item in far_warnings})
        self.assertEqual(far_nulls, {"gecko-far-from-pool-history": 1})

    def test_skewed_reserves_stay_priced_and_ten_billion_cap_stays_null(self) -> None:
        from bnb_market_value import index_cash_price_candidates, resolve_market_values

        skewed = price_pair(
            AAPL,
            USDT,
            "0x" + "21" * 20,
            100,
            10_000,
            base_amt=100,
            quote_amt=100,
        )
        huge = price_pair(NVDA, USDT, "0x" + "22" * 20, 6, 10_000)
        candidates = index_cash_price_candidates([skewed, huge], {AAPL.lower(), NVDA.lower()})
        rows = [
            {"address": AAPL, "symbol": "AAPLB", "kind": "equity", "issuer": "xstocks"},
            {"address": NVDA, "symbol": "NVDAB", "kind": "equity", "issuer": "bstocks"},
            {"address": QQQ, "symbol": "QQQB", "kind": "etf", "issuer": "xstocks"},
            {"address": SPCX, "symbol": "SPCX", "kind": "preipo", "issuer": "paimon"},
        ]
        readings, warnings, nulls = resolve_market_values(
            rows,
            {AAPL.lower(): 5, NVDA.lower(): 2_000_000_000, QQQ.lower(): 4, SPCX.lower(): 0},
            candidates,
            {QQQ.lower(): None},
        )
        self.assertEqual(readings[AAPL.lower()]["marketValueUsd"], 500)
        self.assertEqual(readings[AAPL.lower()]["priceUsd"], 100)
        self.assertEqual(readings[AAPL.lower()]["priceSource"], "dexscreener")
        self.assertEqual(readings[AAPL.lower()]["supply"], 5)
        self.assertIsNone(readings[NVDA.lower()]["marketValueUsd"])
        self.assertIsNone(readings[QQQ.lower()]["marketValueUsd"])
        self.assertEqual(readings[QQQ.lower()]["supply"], 4)
        self.assertIsNone(readings[SPCX.lower()]["marketValueUsd"])
        self.assertIsNone(readings[SPCX.lower()]["priceUsd"])
        reasons = {item["reason"] for item in warnings}
        self.assertNotIn("price-far-from-reserves", reasons)
        self.assertIn("market-value-above-10b", reasons)
        self.assertEqual(nulls["market-value-above-10b"], 1)
        self.assertEqual(nulls["no-price"], 2)
        self.assertNotIn("no-supply-and-no-price", nulls)

        values = {addr: reading["marketValueUsd"] for addr, reading in readings.items()}
        self.assertEqual(lane_volume(rows, values, "equity"), 500)
        self.assertIsNone(lane_volume(rows, values, "etf"))
        self.assertIsNone(lane_volume(rows, values, "preipo"))
        self.assertEqual(sum_nullable([lane_volume(rows, values, kind) for kind in ("equity", "etf", "preipo")]), 500)

    def test_missing_supply_or_price_is_null_and_zero_supply_counts(self) -> None:
        from bnb_market_value import index_cash_price_candidates, resolve_market_values

        pairs = [
            price_pair(AAPL, USDT, "0x" + "31" * 20, 3, 5_000),
            price_pair(HOOD, USDT, "0x" + "32" * 20, 3, 5_000),
        ]
        candidates = index_cash_price_candidates(pairs, {AAPL.lower(), HOOD.lower()})
        rows = [
            {"address": AAPL, "symbol": "A", "kind": "equity", "issuer": "ondo"},
            {"address": HOOD, "symbol": "H", "kind": "equity", "issuer": "ondo"},
            {"address": QQQ, "symbol": "Q", "kind": "etf", "issuer": "xstocks"},
        ]
        readings, _warnings, nulls = resolve_market_values(
            rows,
            {AAPL.lower(): None, HOOD.lower(): 0, QQQ.lower(): None},
            candidates,
            {QQQ.lower(): 8},
        )
        self.assertEqual(readings[AAPL.lower()]["priceUsd"], 3)
        self.assertEqual(readings[AAPL.lower()]["priceSource"], "dexscreener")
        self.assertIsNone(readings[AAPL.lower()]["marketValueUsd"])
        self.assertEqual(readings[HOOD.lower()]["marketValueUsd"], 0)
        self.assertEqual(readings[HOOD.lower()]["priceUsd"], 3)
        self.assertIsNone(readings[QQQ.lower()]["marketValueUsd"])
        self.assertEqual(readings[QQQ.lower()]["priceSource"], "geckoterminal")
        self.assertEqual(nulls, {"no-supply": 2})

        market_values = {addr: reading["marketValueUsd"] for addr, reading in readings.items()}
        breakdown = issuers_by_lane(rows, {AAPL.lower(): None, HOOD.lower(): 0, QQQ.lower(): None}, {}, market_values)
        self.assertEqual(
            breakdown["equity"]["ondo"],
            {"usd": 0.0, "mints": 2, "pools": 0, "marketValueUsd": 0.0, "marketValueMints": 1},
        )
        self.assertIsNone(breakdown["etf"]["xstocks"]["marketValueUsd"])
        self.assertEqual(breakdown["etf"]["xstocks"]["marketValueMints"], 0)
        self.assertEqual(
            lane_volume(rows, market_values, "equity"),
            sum_nullable([stats["marketValueUsd"] for stats in breakdown["equity"].values()]),
        )
        self.assertIsNone(lane_volume(rows, market_values, "etf"))
        self.assertIsNone(sum_nullable([None, None, None]))

    def test_supply_scales_by_decimals_and_budget_stays_unread(self) -> None:
        from bnb_market_value import read_token_supplies

        failed = "0x" + "bb" * 20

        def post(_url: str, payload: list[dict]) -> list[dict]:
            out = []
            for item in payload:
                addr = item["params"][0]["to"].lower()
                data = item["params"][0]["data"]
                if addr == failed:
                    out.append({"jsonrpc": "2.0", "id": item["id"], "error": {"message": "missing"}})
                elif data == "0x18160ddd":
                    out.append({"jsonrpc": "2.0", "id": item["id"], "result": hex(123 * 10**18)})
                else:
                    out.append({"jsonrpc": "2.0", "id": item["id"], "result": hex(18)})
            return out

        supplies, warnings, unread = read_token_supplies(
            [AAPL, failed],
            post=post,
            rpcs=["http://rpc"],
            budget_s=30,
            clock=lambda: 0,
        )
        self.assertEqual(supplies[AAPL.lower()], 123)
        self.assertIsNone(supplies[failed])
        self.assertEqual(unread, set())
        self.assertEqual(warnings, [])

        state = {"n": 0}

        def clock() -> float:
            state["n"] += 1
            return 0 if state["n"] == 1 else 10_000

        skipped, notes, still = read_token_supplies(
            [AAPL],
            post=post,
            rpcs=["http://rpc"],
            budget_s=5,
            clock=clock,
        )
        self.assertIsNone(skipped[AAPL.lower()])
        self.assertEqual(still, {AAPL.lower()})
        self.assertTrue(any("time budget" in note for note in notes))

        def rate_limited(url: str, payload: list[dict]) -> list[dict]:
            if "bad" in url:
                return [{"jsonrpc": "2.0", "id": None, "error": {"code": -32005, "message": "method eth_call in batch triggered rate limit"}}]
            return post(url, payload)

        rotated, _notes, unread_after = read_token_supplies(
            [AAPL],
            post=rate_limited,
            rpcs=["http://bad", "http://good"],
            budget_s=30,
            clock=lambda: 0,
        )
        self.assertEqual(rotated[AAPL.lower()], 123)
        self.assertEqual(unread_after, set())

    def test_attach_keeps_nulls_and_upsert_does_not_touch_past_rows(self) -> None:
        import json
        import tempfile

        from snapshot_asset_rows import upsert_day_record

        rows = [
            {"address": AAPL, "symbol": "AAPLB", "kind": "equity", "issuer": "xstocks"},
            {"address": QQQ, "symbol": "QQQ", "kind": "etf", "issuer": "ondo"},
            {"address": NVDA, "symbol": "NVDAB", "kind": "equity", "issuer": "bstocks"},
        ]
        readings = {
            AAPL.lower(): {"supply": 5, "priceUsd": 2, "priceSource": "dexscreener", "marketValueUsd": 10},
            QQQ.lower(): {"supply": None, "priceUsd": None, "priceSource": None, "marketValueUsd": None},
            NVDA.lower(): {"supply": 8, "priceUsd": None, "priceSource": None, "marketValueUsd": None},
        }
        assets = _MOD.attach_market_values(
            [{"address": QQQ, "symbol": "QQQ", "instrumentKind": "etf", "volume24hUsd": 1, "pools": []}],
            rows,
            readings,
        )
        by_symbol = {item["symbol"]: item for item in assets}
        self.assertEqual(by_symbol["AAPLB"]["marketValueUsd"], 10)
        self.assertEqual(by_symbol["AAPLB"]["volume24hUsd"], None)
        self.assertIsNone(by_symbol["QQQ"]["marketValueUsd"])
        self.assertIsNone(by_symbol["QQQ"]["supply"])
        self.assertEqual(by_symbol["QQQ"]["priceSource"], None)
        self.assertEqual(by_symbol["QQQ"]["volume24hUsd"], 1)
        self.assertNotIn("NVDAB", by_symbol)

        past = {
            "date": "2026-10-19",
            "combined24hUsd": 12.5,
            "publicEquity24hUsd": 12.5,
            "assets": [{"address": AAPL, "symbol": "A", "volume24hUsd": 12.5, "pools": []}],
        }
        today = {
            "date": "2026-10-20",
            "combined24hUsd": 1,
            "publicEquity24hUsd": 1,
            "publicEquityMarketValueUsd": 10,
            "assets": [
                {
                    "address": AAPL,
                    "symbol": "A",
                    "volume24hUsd": 1,
                    "supply": 5,
                    "priceUsd": 2,
                    "priceSource": "dexscreener",
                    "marketValueUsd": 10,
                }
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bnb.json"
            path.write_text(json.dumps({"version": 1, "records": [past]}))
            upsert_day_record(path, today)
            loaded = json.loads(path.read_text())
        stored = {row["date"]: row for row in loaded["records"]}
        self.assertEqual(stored["2026-10-19"]["publicEquity24hUsd"], 12.5)
        self.assertEqual(stored["2026-10-19"]["assets"][0]["volume24hUsd"], 12.5)
        self.assertNotIn("publicEquityMarketValueUsd", stored["2026-10-19"])
        self.assertNotIn("marketValueUsd", stored["2026-10-19"]["assets"][0])
        self.assertNotIn("supply", stored["2026-10-19"]["assets"][0])
        self.assertEqual(stored["2026-10-20"]["assets"][0]["volume24hUsd"], 1)
        self.assertEqual(stored["2026-10-20"]["publicEquityMarketValueUsd"], 10)


if __name__ == "__main__":
    raise SystemExit(unittest.main())
