"""BNB Chain equity / pre-IPO / ETF universe for the daily volume snapshot.

Stocksonchain only lists Ondo and xStocks on BNB. This module unions that
registry with the other public BNB listings the desk has to cover:

- Ondo Global Markets metadata, filtered to networkChainId bsc-56
- xStocks public assets on BinanceSmartChain, plus the Backed CowSwap list
- bStocks BEP-20s from the Jumper RWA catalog (bstocks.finance 403s)
- Colb Finance pre-IPO tokens in the BNB section of the Colb docs
- Paimon pre-IPO SPV tokens (not the Paimon Prime vault)

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
import urllib.request
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
PRIVATE_TICKERS = {"SPCX", "SHEIN", "OPENAI", "ANTHROPIC"}
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
PRIVATE_NAME = re.compile(r"\b(?:spacex|openai|anthropic|shein|revolut|anduril)\b", re.I)
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

    if _verifiable_private(kind_raw, ticker, name, underlying, issuer):
        return "preipo", ""
    brand = WRAPPER_BRAND.match(name or "")
    if brand and issuer_slug(issuer) != brand.group(1).lower():
        return None, "copycat"
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
    ) -> bool:
        if not is_bep20(address):
            self._skip("not-bep20")
            return False
        key = address.lower()
        if key in {PAIMON_PRIME, BSC_USDT}:
            self._skip("denied-address")
            return False
        if key in self._seen:
            self._skip("duplicate")
            return False
        raw_kind = kind_raw or kind or ""
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


def load_universe(fetch: Fetch | None = None) -> tuple[list[dict], list[str], dict[str, Any]]:
    """Union every BNB registry. A 403 on one source does not blank the day."""
    getter = fetch or live_fetch
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

    if book.rows:
        info = ", ".join(f"{slug}={count}" for slug, count in sorted(count_issuers(book.rows).items()))
        warnings.append(f"universe issuers: {info}")
    else:
        warnings.append("universe: zero BNB equity/pre-IPO/ETF listings")
    return book.rows, warnings, {"registries": statuses, "skipped": book.skipped, "addedBySource": book.added_by_source}
