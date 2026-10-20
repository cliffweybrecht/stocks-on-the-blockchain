"""BNB Chain equity / pre-IPO / ETF universe for the daily volume snapshot.

Stocksonchain only lists Ondo and xStocks on BNB. This module unions that
registry with the other public BNB listings the desk has to cover:

- Ondo Global Markets metadata, filtered to networkChainId bsc-56
- xStocks public assets on BinanceSmartChain, plus the Backed CowSwap list
- bStocks BEP-20s from the Jumper RWA catalog (bstocks.finance 403s),
  a seed of listings Jumper missed, and DexScreener search hits whose
  EIP-1967 beacon matches NVDAB
- Colb Finance pre-IPO tokens in the BNB section of the Colb docs
- Paimon pre-IPO SPV tokens (not the Paimon Prime vault)
- Four.meme 4Stock public equities from FOURMEME_4STOCKS (no contract registry)

Leveraged/inverse products, perps, synthetics, fan tokens, tokenized
treasuries, Paimon Prime, and meme tickers stay out. Crypto, commodities,
generic baskets, and copycats stay out. Other chains stay out.

Lane order matches the Solana private-leg standard: exclusions, then
ETF/index, then private, then public equity. Private is fail-closed. BNB has
no PreStocks mint convention. A mint is private only for a Colb or Paimon
wrapper, or a registry kind of preipo|private together with a clear
private-company name or symbol. A private label alone does not admit.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

STOCKSONCHAIN = "https://stocksonchain.io/api/tokens.json"
ONDO_GM_METADATA = "https://api.gm.ondo.finance/v1/assets/all/metadata"
XSTOCKS_ASSETS = "https://api.xstocks.fi/api/v2/public/assets"
XSTOCKS_TOKENLIST = "https://raw.githubusercontent.com/backed-fi/cowswap-xstocks-tokenlist/main/tokenlist.json"
JUMPER_BSTOCKS = "https://rwa.jumper.xyz/providers/bstocks"
BSTOCKS_SITE = "https://www.bstocks.finance/en/"
COLB_CONTRACTS = "https://docs.colb.finance/getting-started/smart-contracts.md"
COLB_CONTRACTS_HTML = "https://docs.colb.finance/getting-started/smart-contracts"
PAIMON_TRADE = "https://app.paimon.finance/trade"
PAIMON_DOCS = "https://paimon-finance.gitbook.io/paimon.finance"
FOURMEME_DOCS = "https://four-meme.gitbook.io/four.meme/stock-meme/4stock"

CHAIN_ID = 56
CHAIN_SLUG = "bsc"
BNB_CHAINS = {"bnb-chain", "bsc", "bnb", "56", "eip155:56", "binance", "binancesmartchain"}
DESK_KINDS = ("equity", "etf", "preipo")

# Documented Paimon SpaceX security token. The trade page lists the shadow
# ERC-20s; this KYC wrapper is not on that page.
PAIMON_PSPCX = {
    "symbol": "pSPCX",
    "name": "Paimon SpaceX SPV",
    "address": "0x6DC9a487bF8Fd047e41AB336003AE6e4FE602646",
    "ticker": "SPCX",
}
# Paimon Prime vault. Never a pre-IPO equity.
PAIMON_PRIME = "0x8505c32631034a7ce8800239c08547e0434edad9"
# BSC USDT shows up beside Paimon trade links. It is not a stock.
BSC_USDT = "0x55d398326f99059ff775485246999027b3197955"

# Verified from the Colb BNB Chain table. Used when the docs page does not parse.
COLB_BNB_FALLBACK = (
    ("CSPX", "Colb SpaceX", "0xDeAa0f353C507A2F0d9b92d20e3fF0FF06f3ACe9"),
    ("CANP", "Colb Anthropic", "0xdc22f0a9a60eee3697e925414bdb4580d1c35f91"),
    ("CREV", "Colb Revolut", "0xe626cd87f9ec3c9cc48ebb2689e427f544554608"),
)
# bStocks beacon proxy. NVDAB and every genuine bStock store this address in the
# EIP-1967 beacon slot. The token's own implementation slot is empty.
BSTOCK_BEACON = "0x156d6dce9a4f6139a3406f1f021f1a4880de93a3"
BSTOCK_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"
BSTOCK_REFERENCE = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"  # NVDAB
DEX_SEARCH = "https://api.dexscreener.com/latest/dex/search?q={q}"
BSTOCK_SEARCH_QUERIES = ("bStocks", "bStock")
# Jumper's catalog is stale and DexScreener search only returns 30 pairs.
# These BEP-20s are the same beacon as NVDAB. Near-zero names stay in so a
# later print is not dropped. Leveraged products are not in this list (SOXLB
# and the rest still fail the leveraged screen). The list is every bStocks
# mint that appeared in bnb.json assets[] on 2026-10-08, 2026-10-09, or
# 2026-10-10, including BNCB, plus the earlier beacon seed.
# (symbol, name, address, underlying ticker)
BSTOCKS_SEED = (
    ("SPCXB", "SpaceX", "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", "SPCX"),
    ("LLYB", "Eli Lilly", "0x5407912F1Aa4B9E05cBE6aBeb9721547a643eC6b", "LLY"),
    ("PDDB", "PDD Holdings Inc", "0x95b0409679B55C31772daA2fB4bEE7B125B77521", "PDD"),
    ("WENB", "Wendy's", "0xDed1c5FB38C262beb9CfF1E1116EfF3c5bf278Cd", "WEN"),
    ("RDDTB", "Reddit", "0x41622a9125A22767Df8C1dC79FC17299BAc4Bd0b", "RDDT"),
    ("ADBEB", "Adobe", "0x65c0249d49E3231540Fd0db0a1ae9259e6eAaf57", "ADBE"),
    ("JPMB", "JPMorgan Chase", "0xbd49D695ba2cc46c8C603eb62aFcd7Fff4698281", "JPM"),
    ("CRMB", "Salesforce", "0x8C433eCa1be0e2a357015602F63751C768F6f643", "CRM"),
    ("CRWDB", "CrowdStrike", "0x814981CF5df4a14D4D7328f9ABf0d02e9ED54CD1", "CRWD"),
    ("AMATB", "Applied Materials", "0xa304bd78e739c0f777202b3eb73ac3736d1df801", "AMAT"),
    ("COHRB", "Coherent", "0x5131859a059b2446abeefe0f5d313b3c54ff3d36", "COHR"),
    ("DELLB", "Dell Technologies", "0x0e7a51966c66648999d506e1372efdea1b78cb0b", "DELL"),
    ("PYPLB", "PayPal", "0x2806a561fc1f9259b2d54a281796bde0d92762ae", "PYPL"),
    ("AAOIB", "Applied Optoelectronics", "0x10343ef7da3301493d7ecb647d68a288c6c1db2f", "AAOI"),
    ("AAPLB", "Apple", "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a", "AAPL"),
    ("ALABB", "Astera Labs", "0x1282493ede6a22753d45cb2c0fdbd8d35e97555a", "ALAB"),
    ("AMDB", "Advanced Micro Devices Inc", "0x75fd4cf6f8392e41e70391d60c90c0d5211603a1", "AMD"),
    ("AMZNB", "Amazon", "0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00", "AMZN"),
    ("ARMB", "Arm Holdings", "0xd42a79ebb7f527f40faecd196ffb47ad5e8d6f8c", "ARM"),
    ("ASMLB", "ASML", "0xfbfb4f79cfb4c34dcd7c82bdee5a0fa199b2e7f9", "ASML"),
    ("ASTSB", "AST SpaceMobile", "0x58b6f5feeb8436489f5bf4a56619092b1fa8e777", "ASTS"),
    ("AVGOB", "Broadcom", "0x76682c454467b3a1150ad8b6a92fc5ee2c21d7ed", "AVGO"),
    ("AXTIB", "AXT", "0x9bdc8b470dbf89dbcb123587c6f5e49cca3463be", "AXTI"),
    ("BABAB", "Alibaba", "0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec", "BABA"),
    ("BEB", "Bloom Energy", "0x5519de00f5388c17d886b97cb5d2d43a812a82bc", "BE"),
    ("BMNRB", "BitMine Immersion Technologies", "0x3548da95a9effe481e8604664d75e95821e557f5", "BMNR"),
    ("BNCB", "CEA Industries", "0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f", "BNC"),
    ("CBRSB", "Cerebras", "0xe81c6bb0266cd68b4f17278531dd03ea1f12da4e", "CBRS"),
    ("COINB", "Coinbase", "0x585bde7c54abb5ccd7791f923d6c2187635f3952", "COIN"),
    ("CRCLB", "Circle Internet Group Inc.", "0x80f3d493ebce97e343c53d29a137942416b4ffc0", "CRCL"),
    ("CRDOB", "Credo Technology", "0x6e7d451f9d30327d32020f116fa79c23b24e9c8d", "CRDO"),
    ("CRWVB", "CoreWeave", "0x33e7317e17838fee56b10fe8d0b9ca6ca3090c95", "CRWV"),
    ("DJTB", "Trump Media & Technology Group Corp", "0xf2ec508422174ee564de98187db9359d318afb6b", "DJT"),
    ("DRAMB", "Roundhill Memory ETF", "0x93862d63fd9fd488b1328e9b47717d75e994a84b", "DRAM"),
    ("EWYB", "iShares MSCI South Korea ETF", "0xbe82f76637dba2c114c41df856c2c51e522e2cb8", "EWY"),
    ("FLNCB", "Fluence Energy", "0x4af1d41cd9dd950dca43984b43aaa2a8702714ac", "FLNC"),
    ("GLWB", "Corning", "0x740e075cbbea22a082b9d6679e65e82767875b6a", "GLW"),
    ("GMEB", "GameStop", "0x46ceefda28dd7207059ed19b0acdc026955bb15c", "GME"),
    ("GOOGLB", "Alphabet", "0x3f53de71c126bdabae20f9cd64848d317f6c3238", "GOOGL"),
    ("GSB", "Goldman Sachs", "0x20cce6656e5f7f79f280e2d0f5db55b401bdbfce", "GS"),
    ("HOODB", "Robinhood", "0xa394dcea3fd3847fd793afbfd163e2e3858b7c65", "HOOD"),
    ("IBMB", "IBM", "0xfa273b076feb8c0fb34e554ae341082323d016a3", "IBM"),
    ("INTCB", "Intel Corporation", "0xe614e2fc6c787035ff51f452e8e826bfd32d5283", "INTC"),
    ("IRENB", "IREN", "0xfdc2f2cab77b28f7ef6c819a404706cfa9bca33b", "IREN"),
    ("LITEB", "Lumentum Holdings", "0x64748bea17b6d19e242adf20425de2440c656142", "LITE"),
    ("METAB", "Meta Platforms", "0x7425889fe94f9d693e8daefe88bcced6acfef4c0", "META"),
    ("MRVLB", "Marvell Technology", "0x16cd4fe7e8880ecc3ba222795229e20489fc2c76", "MRVL"),
    ("MSFTB", "Microsoft", "0x80106cb3ead06659a5ad19df39d9b4733863b9b0", "MSFT"),
    ("MSTRB", "Strategy Inc.", "0xe87afb3076aeb0f9b14e368de8145ae6a2826a14", "MSTR"),
    ("MUB", "Micron Technology Inc", "0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699", "MU"),
    ("NBISB", "Nebius", "0xe256bc2a4f5297f8ba6f043f180a46300ecbcbb1", "NBIS"),
    ("NFLXB", "Netflix", "0xd6829ea836b6fa224d099d40e54b31262f874631", "NFLX"),
    ("NOKB", "Nokia", "0x7c4d7a180d737dd5a70d8065a90e6746a69c37ea", "NOK"),
    ("NVDAB", "NVIDIA Corp", "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", "NVDA"),
    ("ORCLB", "Oracle", "0x4684d9887fc1c71cba7bab8e88835cec217eb598", "ORCL"),
    ("PLTRB", "Palantir Technologies", "0x0ca5d51d0277bd006fd9607d3e560785ebad8222", "PLTR"),
    ("QCOMB", "Qualcomm", "0x5f7a56e877b9130608bf8be962621011182fefe1", "QCOM"),
    ("QNTB", "Quantinuum", "0xd721c192d612db77621df57a9fab38418033c02e", "QNT"),
    ("QQQB", "Invesco QQQ", "0x205812cdbed920aff76c6580abd681a46d11efc7", "QQQ"),
    ("RKLBB", "Rocket Lab", "0xc8da12cbcce7c45180692a6420b0076e03a5179a", "RKLB"),
    ("SKHYB", "SK Hynix", "0xca750ef65f295bbecd685abf54e82caf297bdb61", "SKHY"),
    ("SMCIB", "Super Micro Computer", "0x387dea1d2772d716d081a29116f3effa0ffe1f36", "SMCI"),
    ("SMHB", "VanEck Semiconductor ETF", "0xbe1fced7047fdce935f45700727845df2c76877a", "SMH"),
    ("SNDKB", "Sandisk Corporation", "0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb", "SNDK"),
    ("SPYB", "SPDR S&P 500 ETF", "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8", "SPY"),
    ("TSLAB", "Tesla, Inc.", "0x5b1910eaad6450e50f816082aa078c41f10c292f", "TSLA"),
    ("TSMB", "TSMC", "0xab78b89b5bb00236be0b4b20704cbfa04efc711c", "TSM"),
    ("USARB", "USA Rare Earth", "0xcd345d4450e04cdef422a60b97d9265d24e0bcee", "USAR"),
    ("WDCB", "Western Digital", "0xebe29695f8047c13d36e7a790ca8c1b239ffad1c", "WDC"),
)
# Not bStocks. A second PDDB, copycat tickers, and Ondo generic baskets.
FAKE_BSTOCK_SYMBOLS = {
    "FWDIB", "HPEB", "SHAZB", "USDEB", "SECZB", "MAG7XON", "BRAINON", "YLD5ON",
}
# The other PDDB (not 0x95b0…). Prefix is enough; the genuine mint is seeded above.
FAKE_PDDB_PREFIX = "0x1d55"

# Four.meme 4Stock. The docs describe the product and do not publish contracts,
# and the four.meme token search is a meme-token index (and 403s from here).
# Extend this tuple when another 4Stock mint is published.
# (symbol, name, address, underlying ticker)
# BNC4 verified on DexScreener as "Cea Industries" / BNC4, the 1:1
# CEA Industries (Nasdaq: BNC) wrapper.
FOURMEME_4STOCKS = (
    ("BNC4", "Cea Industries", "0x7C8D5502b544dDAf8852Fc46D1174E34876D545C", "BNC"),
)

ISSUER_SLUGS = {
    "ondo": "ondo",
    "backed": "xstocks",
    "backed-xstocks": "xstocks",
    "backed / xstocks": "xstocks",
    "xstocks": "xstocks",
    "bstocks": "bstocks",
    "colb": "colb",
    "colb finance": "colb",
    "paimon": "paimon",
    "paimon finance": "paimon",
    "fourmeme": "fourmeme",
    "four.meme": "fourmeme",
    "four.meme 4stock": "fourmeme",
    "4stock": "fourmeme",
}

# Plain ETFs stay in. These tickers are leveraged or inverse products.
LEVERAGED_TICKERS = {
    "TQQQ", "SQQQ", "SOXL", "SOXS", "UPRO", "SPXU", "SPXL", "TNA", "TZA",
    "FAS", "FAZ", "LABU", "LABD", "TECL", "TECS", "BULZ", "BERZ", "FNGU",
    "FNGD", "NUGT", "DUST", "JNUG", "JDST", "UVXY", "SVXY", "BOIL", "KOLD",
    "BITX", "BITU", "SBIT", "CONL", "MSTU", "MSTZ", "TSLL", "TSLQ", "NVDL",
    "NVDX", "NVDU", "AAPU", "AMZU", "GGLL", "METU", "MSFU", "TSLS", "PSQ",
    "QLD", "QID", "SSO", "SDS", "UDOW", "SDOW", "INTW", "KORU", "MUU",
    "MVLL", "SNXX",
}
TREASURY_TICKERS = {"BUIDL", "VBILL", "USDY", "USYC", "OUSG", "USTB", "BENJI", "WTGXX"}
FAN_TICKERS = {"ALPINE"}
# SpaceX listed on Nasdaq on 2026-06-12. SPCX / SPCXB / SPCXx are public equity.
# Colb and Paimon wrappers stay private because of the issuer, not this set.
PRIVATE_TICKERS = {"SHEIN", "OPENAI", "ANTHROPIC"}
# Validated BNB private wrappers. Not a mint-prefix convention.
PRIVATE_ISSUERS = {"colb", "paimon"}
# Registry strings that mean the private lane. Any one of these, not a single spelling.
PRIVATE_KIND_COMPACT = {"private", "preipo"}
CRYPTO_SYMBOLS = {
    "BNB", "BTC", "BUSD", "DAI", "ETH", "FDUSD", "USDC", "USDT", "WBTC", "WBNB", "WETH",
}
COMMODITY_SYMBOLS = {"GOLD", "OIL", "PAXG", "SILVER", "XAG", "XAU", "XAUT"}
GENERIC_SYMBOLS = {
    "BASKET", "EQUITY", "PREIPO", "PRIVATE", "RWA", "STOCK", "STOCKS", "XSTOCK", "XSTOCKS",
}

ETF_TICKERS = {
    "SPY", "QQQ", "IVV", "VOO", "VTI", "IWM", "DIA", "GLD", "SLV", "IAU", "IBIT",
    "TLT", "IEF", "SHY", "SGOV", "AGG", "BND", "HYG", "LQD", "EFA", "EEM", "IEMG",
    "IEFA", "XLK", "XLF", "XLE", "SMH", "SOXX", "ARKK", "FXI", "EWT", "EWY",
    "INDA", "USO", "BINC",
}

LEVERAGED_NAME = re.compile(
    r"\b(?:[23]x|ultra-?pro|leveraged|inverse|daily bull|daily bear)\b",
    re.I,
)
PRIVATE_NAME = re.compile(r"\b(?:openai|anthropic|shein|revolut|anduril)\b", re.I)
# Public SpaceX wrappers. A stale preipo/private registry kind does not keep them out.
SPACEX_NAME = re.compile(r"\bspacex\b", re.I)
PUBLIC_EQUITY_TICKERS = {"SPCX"}
PERP_NAME = re.compile(r"\b(?:perp|synthetics?)\b", re.I)
PERPETUAL_FUTURE = re.compile(r"\bperpetual\b(?!\s+preferred\b)", re.I)
FAN_NAME = re.compile(r"\bfan token\b", re.I)
TREASURY_NAME = re.compile(
    r"\b(?:buidl|vbill|institutional digital liquidity|tokenized treasur)",
    re.I,
)
MEME_NAME = re.compile(r"\b(?:memecoin|meme coin)\b", re.I)
CRYPTO_NAME = re.compile(
    r"\b(?:usd\s*coin|tether|wrapped\s+bnb|wrapped\s+bitcoin|wrapped\s+ether|memecoin|meme\s+coin|stablecoin)\b",
    re.I,
)
# Full-name commodity tokens only. "SPDR Gold Trust" stays an ETF.
COMMODITY_PRODUCT_NAME = re.compile(
    r"^(?:tokeni[sz]ed\s+)?(?:gold|silver|crude\s+oil|precious\s+metal|pax\s*gold)(?:\s+xstocks?)?$",
    re.I,
)
GENERIC_CATEGORY_NAME = re.compile(
    r"^(?:the\s+)?(?:xstocks?|bstocks?|colb|paimon|tokeni[sz]ed(?:\s+public)?\s+(?:stocks?|equit(?:y|ies)|shares?)|pre-?ipos?|private\s+markets?)$",
    re.I,
)
GENERIC_BASKET_NAME = re.compile(
    r"\b(?:basket|pre-?ipo\s+basket|private\s+markets?\s+basket)\b",
    re.I,
)
WRAPPER_BRAND = re.compile(r"^\s*(colb|paimon)\b", re.I)
BEP20 = re.compile(r"0x[a-fA-F0-9]{40}")
COLB_ROW = re.compile(
    r"\|\s*Colb\s+([^(|]+?)\s*\(([A-Z0-9]+)\)\s*\|\s*`(0x[a-fA-F0-9]{40})`",
    re.I,
)

Fetch = Callable[[str], Any]


class HttpStatus(Exception):
    def __init__(self, url: str, code: int):
        super().__init__(f"HTTP {code} {url}")
        self.url = url
        self.code = code


def issuer_slug(raw: str) -> str:
    slug = re.sub(r"\s+", " ", (raw or "").strip().lower())
    return ISSUER_SLUGS.get(slug, slug or "unknown")


def count_issuers(rows: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        slug = issuer_slug(str(row.get("issuer") or ""))
        counts[slug] = counts.get(slug, 0) + 1
    return counts


def is_bep20(address: str) -> bool:
    return bool(BEP20.fullmatch(address or ""))


def ticker_candidates(symbol: str = "", underlying: str = "") -> set[str]:
    """Underlying ticker plus the wrapper symbol with one issuer suffix removed.

    SNXx is TD Synnex (SNX), not the SNDK 2x product whose ticker is SNXX.
    Checking the raw wrapped symbol would collide those two.
    """
    found: set[str] = set()
    underlying_ticker = (underlying or "").upper().strip()
    if underlying_ticker:
        found.add(underlying_ticker)
    raw = (symbol or "").upper().strip()
    if not raw:
        return found
    if raw.endswith("ON") and len(raw) > 3:
        found.add(raw[:-2])
    elif raw.endswith("X") and len(raw) > 2:
        found.add(raw[:-1])
    elif raw.endswith("B") and len(raw) > 2:
        found.add(raw[:-1])
    else:
        found.add(raw)
    return found


def exclusion_reason(symbol: str = "", name: str = "", underlying: str = "", kind_raw: str = "") -> str | None:
    """Why a listing stays off the desk, or None when it can be a lane."""
    tickers = ticker_candidates(symbol, underlying)
    label = name or ""
    kind = (kind_raw or "").lower().strip()
    if tickers & LEVERAGED_TICKERS or LEVERAGED_NAME.search(label):
        return "leveraged"
    if tickers & TREASURY_TICKERS or TREASURY_NAME.search(label):
        return "treasury"
    if tickers & FAN_TICKERS or FAN_NAME.search(label):
        return "fan"
    if kind in {"perp", "perps", "perpetual", "synthetic", "synthetics"} or PERP_NAME.search(label):
        return "perp"
    if PERPETUAL_FUTURE.search(label) and not re.search(r"\bpreferred\b", label, re.I):
        return "perp"
    if "prime" in label.lower() and "paimon" in label.lower():
        return "paimon-prime"
    if kind in {"meme", "memecoin"} or MEME_NAME.search(label):
        return "meme"
    if (symbol or "").upper().endswith("PERP"):
        return "perp"
    if tickers & CRYPTO_SYMBOLS or CRYPTO_NAME.search(label):
        return "crypto"
    if tickers & COMMODITY_SYMBOLS or COMMODITY_PRODUCT_NAME.fullmatch(label.strip() or ""):
        return "commodity"
    if tickers & GENERIC_SYMBOLS or GENERIC_CATEGORY_NAME.fullmatch(label.strip() or ""):
        return "generic"
    if GENERIC_BASKET_NAME.search(label):
        return "generic"
    return None


def _name_looks_etf(name: str) -> bool:
    upper = (name or "").upper()
    needles = (
        " ETF", "ETF ", "ETF)", " ETF,", "TRUST", " FUND", " INDEX", "ETP",
        "PROSHARES", "ISHARES", "SPDR", "VANGUARD", "INVESCO QQQ", "SELECT SECTOR",
        "GOLD TRUST", "SILVER TRUST", "BITCOIN TRUST", "BOND",
    )
    return any(needle in upper for needle in needles) or upper.endswith("ETF")


def is_private(symbol: str = "", name: str = "", underlying: str = "") -> bool:
    """Clear private-company name or symbol. Not an admission by itself."""
    if ticker_candidates(symbol, underlying) & PRIVATE_TICKERS:
        return True
    return bool(PRIVATE_NAME.search(name or ""))


def _listed_spacex(symbol: str = "", name: str = "", underlying: str = "") -> bool:
    """SpaceX common stock. Public since the 2026-06-12 Nasdaq listing."""
    if ticker_candidates(symbol, underlying) & PUBLIC_EQUITY_TICKERS:
        return True
    return bool(SPACEX_NAME.search(name or ""))


def _kind_is_private(kind_raw: str) -> bool:
    """True for registry kind preipo|private in any of the usual spellings."""
    compact = re.sub(r"[\s_\-]+", "", (kind_raw or "").lower().strip())
    return compact in PRIVATE_KIND_COMPACT


def _desk_ticker(ticker: str, underlying: str) -> str:
    tick = (underlying or ticker or "").upper().strip()
    if tick.endswith("ON") and len(tick) > 3:
        return tick[:-2]
    if tick.endswith("X") and len(tick) > 2 and tick not in ETF_TICKERS:
        base = tick[:-1]
        if base in ETF_TICKERS or base in LEVERAGED_TICKERS:
            return base
    return tick


def _verifiable_private(
    kind_raw: str,
    ticker: str = "",
    name: str = "",
    underlying: str = "",
    issuer: str = "",
) -> bool:
    """Colb/Paimon wrapper, or registry kind preipo|private plus a company signal.

    BNB has no PreStocks mint convention. A private/preipo kind string alone is
    not enough, and a private-company name alone is not enough (that is a copycat).
    """
    if issuer_slug(issuer) in PRIVATE_ISSUERS:
        return True
    return _kind_is_private(kind_raw) and is_private(ticker, name, underlying)


def _private_candidate(
    kind_raw: str,
    ticker: str = "",
    name: str = "",
    underlying: str = "",
    issuer: str = "",
) -> bool:
    if issuer_slug(issuer) in PRIVATE_ISSUERS or _kind_is_private(kind_raw):
        return True
    return is_private(ticker, name, underlying)


def classify_lane(
    kind_raw: str,
    ticker: str = "",
    name: str = "",
    underlying: str = "",
    issuer: str = "",
) -> tuple[str | None, str]:
    """Classify one listing. Returns (lane, skip_reason).

    Order is the Solana private-leg standard:
    1. Reject leveraged/inverse, perps, fan tokens, treasuries, crypto,
       commodities, generic baskets, memes, and Paimon Prime.
    2. ETF/index before private. A pre-IPO label cannot steal an ETF.
    3. Private only with a verifiable signal (Colb/Paimon, or registry kind
       preipo|private plus a private-company name/symbol). Otherwise fail closed.
    4. Public equity last.
    """
    blocked = exclusion_reason(ticker, name, underlying, kind_raw)
    if blocked:
        return None, blocked

    kind = (kind_raw or "").lower().strip()
    tick = _desk_ticker(ticker, underlying)
    etf_like = tick in ETF_TICKERS or _name_looks_etf(name)
    etf_labeled = kind in {"etf", "index"}
    # ETF/index before private, even when the registry says preipo/private.
    if etf_like or etf_labeled:
        if etf_like:
            return "etf", ""
        upper = (name or "").upper()
        if any(
            token in upper
            for token in (
                "INC", "CORP", "PLC", "LTD", "HOLDINGS", "ORDINARY SHARES",
                "AMERICAN DEPOSITARY", "ADS", "CLASS A", "CLASS C",
            )
        ):
            return "equity", ""
        return None, "kind"

    # A Colb/Paimon label on someone else's mint is a copycat, including
    # "Colb SpaceX". That check is before the Nasdaq SpaceX equity lane.
    brand = WRAPPER_BRAND.match(name or "")
    if brand and issuer_slug(issuer) != brand.group(1).lower():
        return None, "copycat"
    # SPCXB and SPCXx are public equity. Colb and Paimon SpaceX wrappers stay
    # on the private path below because their issuer is the wrapper.
    if _listed_spacex(ticker, name, underlying) and issuer_slug(issuer) not in PRIVATE_ISSUERS:
        return "equity", ""

    if _verifiable_private(kind_raw, ticker, name, underlying, issuer):
        return "preipo", ""
    if _private_candidate(kind_raw, ticker, name, underlying, issuer):
        return None, "private"

    if kind in {"stock", "equity", "share", ""}:
        return "equity", ""
    return None, "kind"


def classify_kind(
    kind_raw: str,
    ticker: str = "",
    name: str = "",
    underlying: str = "",
    issuer: str = "",
) -> str | None:
    """Map a registry kind onto equity / etf / preipo. Excluded products return None."""
    lane, _reason = classify_lane(kind_raw, ticker, name, underlying, issuer)
    return lane


class Book:
    """Contract-address union. The first accepted listing wins."""

    def __init__(self) -> None:
        self.rows: list[dict] = []
        self._seen: set[str] = set()
        self.added_by_source: dict[str, int] = {}
        self.skipped: dict[str, int] = {}

    def add(
        self,
        *,
        symbol: str,
        name: str,
        address: str,
        issuer: str,
        source: str,
        ticker: str = "",
        underlying: str = "",
        kind_raw: str = "",
        kind: str | None = None,
        trust_lane: bool = False,
    ) -> bool:
        if not is_bep20(address):
            self._skip("not-bep20")
            return False
        key = address.lower()
        if key in {PAIMON_PRIME, BSC_USDT}:
            self._skip("denied-address")
            return False
        symbol_key = (symbol or ticker or "").upper().strip()
        if symbol_key in FAKE_BSTOCK_SYMBOLS:
            self._skip("fake")
            return False
        if symbol_key == "PDDB" and key.startswith(FAKE_PDDB_PREFIX):
            self._skip("fake")
            return False
        if key in self._seen:
            self._skip("duplicate")
            return False
        raw_kind = kind_raw or kind or ""
        if trust_lane:
            # A mint already stored on a nightly row keeps that issuer and lane.
            # Re-classifying from a symbol alone drops ETFs the heuristics miss.
            lane = raw_kind if raw_kind in DESK_KINDS else None
            reason = "" if lane else "kind"
        else:
            lane, reason = classify_lane(
                raw_kind,
                ticker or symbol,
                name,
                underlying,
                issuer,
            )
        if lane not in DESK_KINDS:
            self._skip(reason or "kind")
            return False
        self._seen.add(key)
        self.rows.append(
            {
                "symbol": symbol or ticker,
                "name": name,
                "address": address,
                "kind": lane,
                "issuer": issuer_slug(issuer),
                "ticker": ticker or underlying or symbol,
                "source": source,
            }
        )
        self.added_by_source[source] = self.added_by_source.get(source, 0) + 1
        return True

    def _skip(self, reason: str) -> None:
        self.skipped[reason] = self.skipped.get(reason, 0) + 1


def _stocks(data: Any) -> list[dict] | None:
    if isinstance(data, dict):
        stocks = data.get("stocks")
        if isinstance(stocks, list):
            return [row for row in stocks if isinstance(row, dict)]
        tokens = data.get("tokens")
        if isinstance(tokens, list):
            return [row for row in tokens if isinstance(row, dict)]
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return None


def add_stocksonchain(data: Any, book: Book) -> None:
    stocks = _stocks(data)
    if stocks is None:
        return
    for token in stocks:
        kind_raw = str(token.get("kind") or token.get("type") or "stock")
        company = str(token.get("company") or token.get("name") or token.get("ticker") or "")
        ticker = str(token.get("ticker") or token.get("symbol") or "")
        listings = token.get("listings") if isinstance(token.get("listings"), list) else []
        if not listings:
            deps = token.get("deployments") or token.get("chains") or []
            built: list[dict] = []
            for deployment in deps if isinstance(deps, list) else []:
                if not isinstance(deployment, dict):
                    continue
                chain = str(deployment.get("chainId") or deployment.get("chain") or "").lower()
                if chain not in BNB_CHAINS:
                    continue
                built.append(
                    {
                        "chain": "bnb-chain",
                        "address": deployment.get("address") or deployment.get("contractAddress"),
                        "issuer": token.get("issuer") or "",
                        "onchainSymbol": token.get("symbol") or ticker,
                    }
                )
            listings = built
        for listing in listings:
            if not isinstance(listing, dict):
                continue
            chain = str(listing.get("chain") or "").lower()
            if chain not in BNB_CHAINS:
                continue
            book.add(
                symbol=str(listing.get("onchainSymbol") or ticker),
                name=company,
                address=str(listing.get("address") or listing.get("contractAddress") or ""),
                issuer=str(listing.get("issuer") or token.get("issuer") or ""),
                source="stocksonchain",
                ticker=ticker,
                kind_raw=kind_raw,
            )


def add_ondo_metadata(data: Any, book: Book) -> None:
    rows = data if isinstance(data, list) else (data.get("assets") if isinstance(data, dict) else None)
    if not isinstance(rows, list):
        return
    for asset in rows:
        if not isinstance(asset, dict):
            continue
        tags = asset.get("tags") if isinstance(asset.get("tags"), dict) else {}
        instrument = str(tags.get("instrumentType") or asset.get("instrumentType") or "")
        asset_class = str(tags.get("assetClass") or "")
        kind_raw = instrument or asset_class or "stock"
        symbol = str(asset.get("symbol") or "")
        ticker = str(asset.get("ticker") or "")
        name = str(asset.get("underlyingName") or asset.get("displayName") or symbol)
        for item in asset.get("addresses") or []:
            if not isinstance(item, dict):
                continue
            network = str(item.get("networkChainId") or "").lower()
            if network not in {"bsc-56", "56", "bsc"}:
                continue
            book.add(
                symbol=symbol or ticker,
                name=name,
                address=str(item.get("address") or ""),
                issuer="ondo",
                source="ondo-gm",
                ticker=ticker or symbol,
                kind_raw=kind_raw,
            )


def add_xstocks_nodes(data: Any, book: Book) -> None:
    nodes = data.get("nodes") if isinstance(data, dict) else data
    if not isinstance(nodes, list):
        return
    for node in nodes:
        if not isinstance(node, dict):
            continue
        underlying = node.get("underlying") if isinstance(node.get("underlying"), dict) else {}
        underlying_symbol = str(underlying.get("symbol") or node.get("underlyingSymbol") or "")
        underlying_type = str(underlying.get("type") or "")
        name = str(node.get("name") or "")
        symbol = str(node.get("symbol") or underlying_symbol)
        for deployment in node.get("deployments") or []:
            if not isinstance(deployment, dict):
                continue
            network = str(deployment.get("network") or "")
            if network.lower() not in BNB_CHAINS:
                continue
            book.add(
                symbol=symbol,
                name=name,
                address=str(deployment.get("address") or ""),
                issuer="xstocks",
                source="xstocks",
                ticker=underlying_symbol or symbol,
                underlying=underlying_symbol,
                kind_raw=underlying_type,
            )


def add_cowswap_tokenlist(data: Any, book: Book) -> None:
    tokens = data.get("tokens") if isinstance(data, dict) else None
    if not isinstance(tokens, list):
        return
    for token in tokens:
        if not isinstance(token, dict):
            continue
        try:
            chain_id = int(token.get("chainId"))
        except (TypeError, ValueError):
            continue
        if chain_id != CHAIN_ID:
            continue
        book.add(
            symbol=str(token.get("symbol") or ""),
            name=str(token.get("name") or ""),
            address=str(token.get("address") or ""),
            issuer="xstocks",
            source="xstocks-tokenlist",
            ticker=str(token.get("symbol") or ""),
            kind_raw="",
        )


def add_jumper_bstocks(html: str, book: Book) -> None:
    text = html.replace('\\"', '"')
    for part in text.split('"underlying":')[1:]:
        header = re.match(r'"([^"]+)","name":"([^"]*)","kind":"([^"]+)"', part)
        if not header:
            continue
        underlying, name, kind = header.groups()
        name = name.replace("\\u0026", "&").replace("\\u0027", "'")
        inst = re.search(
            r'\{"provider":"bStocks","tokenSymbol":"([^"]+)","chain":"([^"]+)","chainId":(\d+),"address":"(0x[a-fA-F0-9]{40})"',
            part,
        )
        if not inst:
            continue
        chain_id = int(inst.group(3))
        if chain_id != CHAIN_ID or inst.group(2).lower() not in BNB_CHAINS:
            continue
        book.add(
            symbol=inst.group(1),
            name=name,
            address=inst.group(4),
            issuer="bstocks",
            source="jumper-bstocks",
            ticker=underlying,
            underlying=underlying,
            kind_raw=kind,
        )


def _bnb_docs_section(text: str) -> str:
    """BNB Chain table only. Moonbeam and Ethereum Colb tokens stay out."""
    start = text.find("BNB Chain")
    if start < 0:
        return ""
    section = text[start:]
    for end in ("Moonbeam", "Ethereum", "Polygon"):
        at = section.find(end, 1)
        if at > 0:
            section = section[:at]
            break
    return section


def add_colb_docs(text: str, book: Book) -> int:
    section = _bnb_docs_section(text)
    added = 0
    for match in COLB_ROW.finditer(section):
        label, ticker, address = match.groups()
        if re.search(r"oracle|aggregator", label, re.I):
            continue
        if book.add(
            symbol=ticker,
            name=f"Colb {label.strip()}",
            address=address,
            issuer="colb",
            source="colb",
            ticker=ticker,
            kind="preipo",
            kind_raw="preipo",
        ):
            added += 1
    if added == 0:
        for ticker, name, address in COLB_BNB_FALLBACK:
            if book.add(
                symbol=ticker,
                name=name,
                address=address,
                issuer="colb",
                source="colb",
                ticker=ticker,
                kind="preipo",
                kind_raw="preipo",
            ):
                added += 1
    return added


def _paimon_products(text: str) -> list[tuple[str, str, str]]:
    """SPV tokens linked to a BscScan address. Paimon Prime is not an SPV."""
    found: list[tuple[str, str, str]] = []
    for match in re.finditer(r"bscscan\.com/token/(0x[a-fA-F0-9]{40})", text, re.I):
        window = text[max(0, match.start() - 1800) : match.start()]
        plain = re.sub(r"<!--.*?-->", " ", window, flags=re.S)
        plain = re.sub(r"<[^>]+>", " ", plain)
        plain = re.sub(r"\s+", " ", plain)
        products = list(re.finditer(r"Paimon\s+(.+?)\s+\$\s*([A-Za-z0-9]+)", plain))
        if not products:
            continue
        product, symbol = products[-1].groups()
        product = re.sub(r"\s+", " ", product).strip()
        if "spv" not in product.lower() or "prime" in product.lower():
            continue
        found.append((symbol, product, match.group(1)))
    return found


def add_paimon(text: str, book: Book) -> None:
    if text:
        for symbol, product, address in _paimon_products(text):
            book.add(
                symbol=symbol,
                name=f"Paimon {product}",
                address=address,
                issuer="paimon",
                source="paimon",
                ticker=symbol,
                kind="preipo",
                kind_raw="preipo",
            )
    book.add(
        symbol=PAIMON_PSPCX["symbol"],
        name=PAIMON_PSPCX["name"],
        address=PAIMON_PSPCX["address"],
        issuer="paimon",
        source="paimon",
        ticker=PAIMON_PSPCX["ticker"],
        kind="preipo",
        kind_raw="preipo",
    )


def add_bstocks_seed(book: Book) -> int:
    """Listings missing from the stale Jumper catalog. Duplicates are ignored."""
    added = 0
    for symbol, name, address, ticker in BSTOCKS_SEED:
        if book.add(
            symbol=symbol,
            name=name,
            address=address,
            issuer="bstocks",
            source="bstocks-seed",
            ticker=ticker,
            underlying=ticker,
            kind="equity",
            kind_raw="equity",
        ):
            added += 1
    return added


def _gt_side(token: Any) -> tuple[str, str, str]:
    if not isinstance(token, dict):
        return "", "", ""
    return (
        str(token.get("address") or ""),
        str(token.get("symbol") or ""),
        str(token.get("name") or ""),
    )


def pairs_from_search(data: Any) -> list[dict]:
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict):
        pairs = data.get("pairs")
        if isinstance(pairs, list):
            return [row for row in pairs if isinstance(row, dict)]
    return []


def discover_bstocks_from_pairs(
    pairs: list[dict],
    book: Book,
    beacon_of: Callable[[str], str | None],
) -> int:
    """Admit a DexScreener hit only when its beacon matches NVDAB.

    Search is full of meme tickers that end in B. The beacon is the check.
    Fakes and leveraged products still fail Book.add.
    """
    added = 0
    seen: set[str] = set()
    for pair in pairs:
        chain = str(pair.get("chainId") or "").strip().lower()
        if chain and chain not in BNB_CHAINS and chain not in {"bsc", "56"}:
            continue
        for side in (pair.get("baseToken"), pair.get("quoteToken")):
            address, symbol, name = _gt_side(side)
            key = address.lower()
            if not is_bep20(address) or key in seen or key in book._seen:
                continue
            seen.add(key)
            if symbol.upper() in FAKE_BSTOCK_SYMBOLS:
                continue
            if not symbol.upper().endswith("B"):
                continue
            beacon = beacon_of(address)
            if not beacon or beacon.lower() != BSTOCK_BEACON:
                continue
            if book.add(
                symbol=symbol,
                name=name or symbol,
                address=address,
                issuer="bstocks",
                source="bstocks-beacon",
                ticker=symbol,
                kind_raw="stock",
            ):
                added += 1
    return added


def live_beacon(address: str) -> str | None:
    """EIP-1967 beacon of a BEP-20, or None when the slot is empty or the RPC fails."""
    if not is_bep20(address):
        return None
    payload = json.dumps(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getStorageAt",
            "params": [address, BSTOCK_BEACON_SLOT, "latest"],
        }
    ).encode()
    req = urllib.request.Request(
        "https://bsc-dataseed.binance.org/",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; BnbVolumeSnapshot/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = json.loads(resp.read().decode())
    except Exception:
        return None
    word = str(body.get("result") or "")
    if not word.startswith("0x") or len(word) < 42:
        return None
    beacon = "0x" + word[-40:]
    if int(beacon, 16) == 0:
        return None
    return beacon.lower()


# A prior-day print above this stays in the universe even when live discovery misses it.
VANISHED_MINT_VOLUME_USD = 100_000.0
INSTRUMENT_TO_KIND = {"equity": "equity", "etf": "etf", "private": "preipo", "preipo": "preipo"}


def snapshot_history_path() -> Path:
    raw = (os.environ.get("BNB_VOLUME_SNAPSHOT_DIR") or "").strip()
    root = Path(raw).expanduser() if raw else Path(__file__).resolve().parents[1] / "data" / "volume-snapshots"
    return root / "bnb.json"


def load_snapshot_records(path: Path | None = None) -> tuple[list[dict], str | None]:
    """Stored bnb.json rows. A missing file warns and returns nothing. It does not blank the day."""
    file = path or snapshot_history_path()
    try:
        payload = json.loads(file.read_text())
    except FileNotFoundError:
        return [], f"snapshot history missing {file}; live universe kept"
    except (OSError, json.JSONDecodeError) as exc:
        return [], f"snapshot history unreadable ({exc}); live universe kept"
    records = payload.get("records") if isinstance(payload, dict) else None
    if not isinstance(records, list):
        return [], f"snapshot history has no records ({file}); live universe kept"
    return [row for row in records if isinstance(row, dict)], None


def _latest_snapshot_record(records: list[dict]) -> dict | None:
    dated = [row for row in records if isinstance(row, dict) and isinstance(row.get("date"), str)]
    if not dated:
        return None
    return max(dated, key=lambda row: str(row.get("date")))


def mints_from_snapshot_records(records: list[dict]) -> list[dict]:
    """One row per address ever stored in assets[]. The latest day keeps issuer and lane."""
    latest: dict[str, tuple[str, dict]] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        day = str(record.get("date") or "")
        for asset in record.get("assets") or []:
            if not isinstance(asset, dict):
                continue
            address = str(asset.get("address") or "")
            if not is_bep20(address):
                continue
            prev = latest.get(address.lower())
            if prev is not None and prev[0] > day:
                continue
            latest[address.lower()] = (day, asset)
    found: list[dict] = []
    for _key, (_day, asset) in latest.items():
        instrument = str(asset.get("instrumentKind") or "equity").lower()
        found.append(
            {
                "symbol": str(asset.get("symbol") or ""),
                "name": str(asset.get("symbol") or ""),
                "address": str(asset.get("address") or ""),
                "issuer": str(asset.get("issuer") or "unknown"),
                "ticker": str(asset.get("symbol") or ""),
                "kind": INSTRUMENT_TO_KIND.get(instrument, "equity"),
            }
        )
    return found


def add_snapshot_mints(book: Book, records: list[dict]) -> int:
    """Union mints already seen in bnb.json. Live listings and the seed stay first."""
    added = 0
    for mint in mints_from_snapshot_records(records):
        if book.add(
            symbol=mint["symbol"],
            name=mint["name"],
            address=mint["address"],
            issuer=mint["issuer"],
            source="snapshot-seen",
            ticker=mint["ticker"],
            kind=mint["kind"],
            kind_raw=mint["kind"],
            trust_lane=True,
        ):
            added += 1
    return added


def vanished_mint_warnings(records: list[dict], live_addresses: set[str], kept_addresses: set[str]) -> list[str]:
    """Warn when a prior-day mint above $100k is absent from live discovery.

    The mint stays when snapshot history still has it. The warning does not drop it
    and does not empty the universe.
    """
    prior = _latest_snapshot_record(records)
    if prior is None:
        return []
    warnings: list[str] = []
    day = prior.get("date")
    for asset in prior.get("assets") or []:
        if not isinstance(asset, dict):
            continue
        address = str(asset.get("address") or "")
        if not is_bep20(address) or address.lower() in live_addresses:
            continue
        volume = asset.get("volume24hUsd")
        if isinstance(volume, bool) or not isinstance(volume, (int, float)):
            continue
        if float(volume) <= VANISHED_MINT_VOLUME_USD:
            continue
        symbol = asset.get("symbol") or address
        if address.lower() in kept_addresses:
            warnings.append(
                f"vanished mint {symbol} {address} prior-day {day} volume {volume} "
                f"> {int(VANISHED_MINT_VOLUME_USD)}; kept from snapshot history"
            )
        else:
            warnings.append(
                f"vanished mint {symbol} {address} prior-day {day} volume {volume} "
                f"> {int(VANISHED_MINT_VOLUME_USD)}; live universe kept"
            )
    return warnings


def add_fourmeme(book: Book) -> int:
    """Public-equity 4Stock mints. The seed list is the whole registry."""
    added = 0
    for symbol, name, address, ticker in FOURMEME_4STOCKS:
        if book.add(
            symbol=symbol,
            name=name,
            address=address,
            issuer="fourmeme",
            source="fourmeme",
            ticker=ticker,
            underlying=ticker,
            kind="equity",
            kind_raw="equity",
        ):
            added += 1
    return added


def rows_from_stocksonchain(data: Any) -> tuple[list[dict], list[str]]:
    book = Book()
    stocks = _stocks(data)
    warnings: list[str] = []
    if stocks is None:
        warnings.append("stocksonchain: unexpected payload (no stocks list)")
        return [], warnings
    add_stocksonchain(data, book)
    if not book.rows:
        warnings.append("stocksonchain: zero BNB equity/pre-IPO/ETF listings")
    return book.rows, warnings


def live_fetch(url: str, retries: int = 4) -> Any:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json,text/html;q=0.9,*/*;q=0.8",
    }
    if "api.gm.ondo.finance" in url:
        key = (os.environ.get("ONDO_GM_API_KEY") or os.environ.get("ONDO_API_KEY") or "").strip()
        if key:
            headers["x-api-key"] = key
    last: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8", "replace")
                ctype = (resp.headers.get("content-type") or "").lower()
                if "json" in ctype or body.lstrip().startswith(("{", "[")):
                    return json.loads(body)
                return body
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403, 404}:
                raise HttpStatus(url, exc.code) from exc
            last = exc
            time.sleep(0.6 * (attempt + 1))
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def _record_failure(name: str, url: str, exc: Exception, statuses: dict[str, Any], warnings: list[str]) -> None:
    if isinstance(exc, HttpStatus):
        statuses[name] = {"url": url, "status": exc.code}
        warnings.append(f"{name}: HTTP {exc.code} {url}")
        return
    statuses[name] = {"url": url, "status": "error", "error": str(exc)}
    warnings.append(f"{name} failed: {exc}")


def load_universe(
    fetch: Fetch | None = None,
    beacon_of: Callable[[str], str | None] | None = None,
    *,
    snapshot_records: list[dict] | None = None,
) -> tuple[list[dict], list[str], dict[str, Any]]:
    """Union every BNB registry. A 403 on one source does not blank the day.

    The universe is the seed, plus live discovery, plus every mint ever stored
    in bnb.json assets[] (issuer and lane kept from that row). Beacon discovery
    runs on the live path. A caller that injects `fetch` and does not pass
    `beacon_of` skips the RPC so tests stay offline. The seed still lands.
    Injected fetch does not read the snapshot file unless `snapshot_records`
    is passed. A mint with more than $100k of prior-day volume that live
    sources miss is warned and kept from history.
    """
    getter = fetch or live_fetch
    if beacon_of is None and fetch is None:
        beacon_of = live_beacon
    book = Book()
    warnings: list[str] = []
    statuses: dict[str, Any] = {}

    def ingest(name: str, url: str, parser: Callable[[Any, Book], None]) -> None:
        try:
            payload = getter(url)
        except Exception as exc:  # noqa: BLE001
            _record_failure(name, url, exc, statuses, warnings)
            return
        before = len(book.rows)
        parser(payload, book)
        statuses[name] = {"url": url, "status": "ok", "added": len(book.rows) - before}

    ingest("stocksonchain", STOCKSONCHAIN, add_stocksonchain)
    ingest("ondo-gm", ONDO_GM_METADATA, add_ondo_metadata)
    ingest("xstocks-tokenlist", XSTOCKS_TOKENLIST, add_cowswap_tokenlist)
    ingest("jumper-bstocks", JUMPER_BSTOCKS, add_jumper_bstocks)
    before = len(book.rows)
    add_bstocks_seed(book)
    statuses["bstocks-seed"] = {
        "status": "ok",
        "added": len(book.rows) - before,
        "note": "Jumper misses listings; seed includes every bStocks mint in bnb.json assets[] on 2026-10-08 through 2026-10-10, including BNCB",
    }

    if beacon_of is not None:
        discovered = 0
        search_errors = 0
        for query in BSTOCK_SEARCH_QUERIES:
            url = DEX_SEARCH.format(q=urllib.parse.quote(query))
            try:
                payload = getter(url)
            except Exception as exc:  # noqa: BLE001
                search_errors += 1
                _record_failure("bstocks-beacon", url, exc, statuses, warnings)
                continue
            before = len(book.rows)
            discover_bstocks_from_pairs(pairs_from_search(payload), book, beacon_of)
            discovered += len(book.rows) - before
        statuses["bstocks-beacon"] = {
            "url": DEX_SEARCH.format(q="bStocks"),
            "beacon": BSTOCK_BEACON,
            "reference": BSTOCK_REFERENCE,
            "status": "ok" if search_errors == 0 else "partial",
            "added": discovered,
        }

    colb_text = ""
    colb_error: Exception | None = None
    for url in (COLB_CONTRACTS, COLB_CONTRACTS_HTML):
        try:
            payload = getter(url)
            colb_text = payload if isinstance(payload, str) else ""
            statuses["colb"] = {"url": url, "status": "ok"}
            colb_error = None
            break
        except Exception as exc:  # noqa: BLE001
            colb_error = exc
            _record_failure("colb", url, exc, statuses, warnings)
    before = len(book.rows)
    add_colb_docs(colb_text, book)
    colb_added = len(book.rows) - before
    if colb_error is None:
        statuses["colb"]["added"] = colb_added
    elif colb_added:
        warnings.append("colb docs unavailable; used the documented BNB pre-IPO addresses")
        statuses["colb"]["added"] = colb_added

    try:
        payload = getter(BSTOCKS_SITE)
        if isinstance(payload, str) and "0x" in payload and "bStock" in payload:
            before = len(book.rows)
            add_jumper_bstocks(payload, book)
            statuses["bstocks-finance"] = {"url": BSTOCKS_SITE, "status": "ok", "added": len(book.rows) - before}
        else:
            statuses["bstocks-finance"] = {"url": BSTOCKS_SITE, "status": "ok", "added": 0, "note": "no contract table"}
    except Exception as exc:  # noqa: BLE001
        _record_failure("bstocks-finance", BSTOCKS_SITE, exc, statuses, warnings)

    xstocks_added = 0
    xstocks_error: Exception | None = None
    for page in range(40):
        url = f"{XSTOCKS_ASSETS}?network=BinanceSmartChain&page={page}&pageSize=100"
        try:
            payload = getter(url)
        except Exception as exc:  # noqa: BLE001
            xstocks_error = exc
            break
        before = len(book.rows)
        add_xstocks_nodes(payload, book)
        xstocks_added += len(book.rows) - before
        page_info = payload.get("page") if isinstance(payload, dict) else None
        if not isinstance(page_info, dict) or not page_info.get("hasNextPage"):
            break
    if xstocks_error is not None and xstocks_added == 0:
        _record_failure("xstocks", XSTOCKS_ASSETS, xstocks_error, statuses, warnings)
    else:
        statuses["xstocks"] = {"url": XSTOCKS_ASSETS, "status": "ok", "added": xstocks_added}
        if xstocks_error is not None:
            warnings.append(f"xstocks page failed after partial ingest: {xstocks_error}")

    try:
        payload = getter(PAIMON_TRADE)
    except Exception as exc:  # noqa: BLE001
        _record_failure("paimon", PAIMON_TRADE, exc, statuses, warnings)
        payload = ""
    before = len(book.rows)
    add_paimon(payload if isinstance(payload, str) else "", book)
    if "paimon" not in statuses or statuses["paimon"].get("status") == "ok":
        statuses["paimon"] = {
            "url": PAIMON_TRADE,
            "docs": PAIMON_DOCS,
            "status": "ok",
            "added": len(book.rows) - before,
        }
    elif book.added_by_source.get("paimon"):
        statuses["paimon"]["added"] = book.added_by_source.get("paimon", 0)
        warnings.append("paimon trade page failed; documented pSPCX was still included")

    before = len(book.rows)
    add_fourmeme(book)
    statuses["fourmeme"] = {
        "url": FOURMEME_DOCS,
        "status": "ok",
        "added": len(book.rows) - before,
        "note": "static 4Stock seed; docs do not publish contracts",
    }

    live_addresses = {str(row.get("address") or "").lower() for row in book.rows}
    history = snapshot_records
    if history is None and fetch is None:
        history, history_warning = load_snapshot_records()
        if history_warning:
            warnings.append(history_warning)
    elif history is None:
        history = []
    before = len(book.rows)
    add_snapshot_mints(book, history)
    statuses["snapshot-seen"] = {
        "status": "ok",
        "added": len(book.rows) - before,
        "note": "union of every mint stored in bnb.json assets[]; issuer and lane kept",
    }
    kept_addresses = {str(row.get("address") or "").lower() for row in book.rows}
    warnings.extend(vanished_mint_warnings(history, live_addresses, kept_addresses))

    if book.rows:
        info = ", ".join(f"{slug}={count}" for slug, count in sorted(count_issuers(book.rows).items()))
        warnings.append(f"universe issuers: {info}")
    else:
        warnings.append("universe: zero BNB equity/pre-IPO/ETF listings")
    return book.rows, warnings, {"registries": statuses, "skipped": book.skipped, "addedBySource": book.added_by_source}
