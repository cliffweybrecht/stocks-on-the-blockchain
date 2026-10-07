#!/usr/bin/env python3
"""Daily Base tokenized-stock volume snapshot (DexScreener truth).

Writes data/volume-snapshots/base.json.

Desk scope is Base mainnet only (chainId 8453). Every public equity, pre-IPO,
and ETF from any issuer is in the lane totals: Coinbase B20, Dinari, Ondo
when a Base address is confirmed, Anchored aStocks, Backed, ST0x, Centrifuge
share tokens, and any later issuer the registries or DexScreener name.
Robinhood Chain is a different network and is never included. ETF classification
wins over the pre-IPO lane when a product matches both (Solana private-leg order).

Lanes stay separate. SPCXc is pre-IPO. A listed mint with no DexScreener
pools stays null, not $0. A lane with no reported h24 stays null. A day is
written when at least one lane has h24. All-null days are not written. No
GeckoTerminal backfill and no invented history.

Each indexed pool also stores DexScreener liquidity.usd. Missing liquidity is
null, not $0, and never blanks the day. Displayed liquidity is the sum of
reported pool liquidity for that mint (Solana snapshot schema).

Day key: America/New_York calendar date (12:00:00 AM–11:59:59 PM Eastern).
`t` is unix seconds for that Eastern midnight. At 11:59 PM Eastern, UTC is
already the next day; the key is the Eastern date that is closing.
BASE_SNAPSHOT_DATE or SNAPSHOT_DATE (YYYY-MM-DD) forces the key only.

Run:
  python3 scripts/snapshot-base-volume.py
  python3 scripts/snapshot-base-volume.py --self-test
  BASE_SNAPSHOT_DATE=2026-09-24 python3 scripts/snapshot-base-volume.py
  BASE_VOLUME_SNAPSHOT_DIR=/path/to/data/volume-snapshots python3 scripts/snapshot-base-volume.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")
UA = {"User-Agent": "Mozilla/5.0 (compatible; BaseVolumeSnapshot/1.0)", "Accept": "application/json"}
CHAIN_ID = 8453
CHAIN_SLUG = "base"
BASE_CHAIN_NAMES = {"base", "8453", "eip155:8453", "base-8453"}

COINBASE_API = "https://api.coinbase.com/v1/tokenized-stocks"
BASE_DOCS = "https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base"
BASE_DOCS_MD = (
    "https://docs.base.org/base-chain/asset-issuance/tokenized-stocks-on-base.md",
    "https://docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks.md",
)
STOCKSONCHAIN = "https://stocksonchain.io/api/tokens.json"
ONDO_ADDRESSES = "https://api.gm.ondo.finance/v1/assets/all/addresses"
ONDO_ASSETS = "https://api.gm.ondo.finance/v1/assets"
DINARI_STOCKS = "https://api-enterprise.sbt.dinari.com/api/v2/market_data/stocks/?limit=100"
DEX_BATCH = "https://api.dexscreener.com/tokens/v1/base/{addrs}"
DEX_SEARCH = "https://api.dexscreener.com/latest/dex/search?q={q}"
ANCHORED_DOCS = "https://docs.anchored.finance/getting-started/anchored-tokens.md"
BASE_RPCS = ("https://base.publicnode.com", "https://mainnet.base.org")

# Canonical Coinbase B20 contracts. This seed matches the public List
# Tokenized Stocks API on 2026-09-28 (Eastern day 2026-09-27 close). The live
# API and docs table are still fetched so a newly issued equity, pre-IPO, or
# ETF is not missed when this seed is stale. COINc, CRCLc, and INTCc are not
# in that live list and are not seeded. BIRDc is Nasdaq-listed Smartbird
# (formerly Allbirds), so it stays equity. SPCXc is pre-IPO (SpaceX).
B20_EQUITY = {
    "AAPLc": "0xb200000000000000000000C2e324d24d7eEcd1fb",
    "AMZNc": "0xb200000000000000000000d9192b6B456483C2E8",
    "AVGOc": "0xB200000000000000000000Fc737aeA6196aB5a4c",
    "BIRDc": "0xb200000000000000000000535fE96f18204BFD96",
    "DJTc": "0xb200000000000000000000428E3a3eebBb20692B",
    "GMEc": "0xb2000000000000000000007790ed6E48e06eD935",
    "GOOGLc": "0xb2000000000000000000002D0BA3164cc74f58B7",
    "HTZc": "0xb2000000000000000000002601C5C94F435da168",
    "LLYc": "0xB200000000000000000000f1a0F91e34892E4718",
    "METAc": "0xb2000000000000000000008bC8786B856E61707C",
    "MSFTc": "0xB200000000000000000000Ab99cFa739E253872B",
    "MSTRc": "0xb2000000000000000000004884b426556b92883d",
    "MUc": "0xb200000000000000000000Fd2f87532B90095211",
    "NFLXc": "0xb20000000000000000000058B8c947e44011dFE6",
    "NVDAc": "0xb20000000000000000000078ee7ce2fE4908108C",
    "PLTRc": "0xb2000000000000000000007d16372840dF4dAbbe",
    "RDDTc": "0xb20000000000000000000066242d4067724cB7A1",
    "SNDKc": "0xb200000000000000000000397293Cb8cda9a10c5",
    "TSLAc": "0xb2000000000000000000001e800a7f5189430cD0",
}
B20_PREIPO = {
    "SPCXc": "0xb2000000000000000000007b9fcbd005511aCBd5",
}
# Official ST0x Base token list (chainId 8453 only). Robinhood Chain is a
# different file in that repo and is never read.
ST0X_BASE_LIST = (
    "https://raw.githubusercontent.com/ST0x-Technology/st0x.registry/main/token-lists/base.json"
)
CENTRIFUGE_DOCS = "https://docs.centrifuge.io/developer/protocol/deployments/"
# Share tokens, not the USDC vaults. Used when the docs page cannot be fetched.
CENTRIFUGE_ETF_SEED = {
    "SPXA": "0x09b61343097c1f9b159a3ae7151298efd10f0db2",
    "deSPXA": "0x9c5C365e764829876243d0b289733B9D2b729685",
}
# BaseScan-verified Backed equities. xStocks publishes no Base deployments.
# Wrappers (wb*) are the non-rebasing DeFi leg of the same share. Bond-like
# Backed tickers (bC3M, bHIGH, bZPR1, bCSBGC3) stay out until a name confirms
# equity, pre-IPO, or ETF.
BACKED_BASE_EQUITY = {
    "bNVDA": "0xA34C5e0AbE843E10461E2C9586Ea03E55Dbcc495",
    "bCOIN": "0xbbcb0356bB9e6B3Faa5CbF9E5F36185d53403Ac9",
    "bTSLA": "0x14A5f2872396802C3Cc8942A39Ab3E4118EE5038",
    "bMSTR": "0xaC28C9178ACc8BA4A11A29E013a3A2627086e422",
    "wbNVDA": "0x7e8101a1c322d394b3961498c7d40d2dfa94c392",
    "wbCOIN": "0xDEc933e2392AD908263e70A386fbF34e703Ffe8F",
    "wbTSLA": "0x1f82284C1658Ad71C576f7230E6C2DEE7901c1FA",
}
BACKED_BASE_NAMES = {
    "bNVDA": "Backed NVIDIA",
    "bCOIN": "Backed Coinbase Global",
    "bTSLA": "Backed Tesla",
    "bMSTR": "Backed MicroStrategy",
    "wbNVDA": "Wrapped Backed NVIDIA",
    "wbCOIN": "Wrapped Backed Coinbase Global",
    "wbTSLA": "Wrapped Backed Tesla",
}
XSTOCKS_BASE = "https://api.xstocks.fi/api/v2/public/assets?network=Base&page={page}&pageSize=100"
# Official Backed product registry. Base rows here are the b* contracts.
# xStocks (NVDAx and the rest) publish no Base deployment in this registry.
BACKED_API = "https://api.backed.fi/api/v1/token"
# Filled by the Backed API and the verified b*/wb* seed. DexScreener name
# matches are not a second deployment.
BACKED_OFFICIAL_BASE: set[str] = set()
BACKED_OFFICIAL_SYMBOLS: set[str] = set()
# Filled only by the Ondo address API when it names chain 8453. A DexScreener
# name is not confirmation that Ondo issued the mint on Base.
ONDO_OFFICIAL_BASE: set[str] = set()
# Filled by the Anchored tokenized-stock table. A ticker that merely contains
# "aStock" (ArcStocks / ASTOCK) is not an Anchored mint.
ANCHORED_OFFICIAL_BASE: set[str] = set()
# Filled by the Coinbase tokenized-stocks API, the Base docs table, and the
# B20 seed. A 0xb200 vanity prefix is not enough: unofficial tokens copy it.
COINBASE_OFFICIAL_BASE: set[str] = set()
DEX_LOOKALIKES: list[str] = []

PREIPO_SYMBOLS = {"SPCX", "SPCXC"}
DOCS_ROW_RE = re.compile(
    r"\|\s*([A-Za-z][A-Za-z0-9.]{0,15})\s*\|\s*`(0x[a-fA-F0-9]{40})`"
)
SKIP_DOC_TICKERS = {"ticker", "onchain", "registry", "contract", "address"}


def fetch_bytes(url: str, retries: int = 6, headers: dict[str, str] | None = None) -> bytes:
    last: Exception | None = None
    hdrs = dict(UA)
    if headers:
        hdrs.update(headers)
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except Exception as e:  # noqa: BLE001
            last = e
            msg = str(e)
            if "429" in msg:
                time.sleep(2.5 * (i + 1))
            else:
                time.sleep(0.6 * (i + 1))
    raise RuntimeError(f"fetch failed {url}: {last}")


def fetch_json(url: str, retries: int = 6, headers: dict[str, str] | None = None) -> Any:
    return json.loads(fetch_bytes(url, retries=retries, headers=headers).decode())


def fetch_text(url: str, retries: int = 4) -> str:
    return fetch_bytes(url, retries=retries, headers={"Accept": "text/plain, text/markdown, */*"}).decode()


def chunks(items: list[str], n: int):
    for i in range(0, len(items), n):
        yield items[i : i + n]


def is_base_chain(value: Any) -> bool:
    text = str(value or "").strip().lower().replace("_", "-")
    if "sepolia" in text or text in {"84532", "eip155:84532", "base-sepolia"}:
        return False
    return text in BASE_CHAIN_NAMES


def normalize_symbol(symbol: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (symbol or "").upper())


def issuer_slug(raw: str) -> str:
    text = re.sub(r"[\s_]+", "-", (raw or "").strip().lower())
    aliases = {
        "coinbase": "coinbase",
        "coinbase-b20": "coinbase",
        "dinari": "dinari",
        "dshare": "dinari",
        "dshares": "dinari",
        "ondo": "ondo",
        "ondo-gm": "ondo",
        "ondo-global-markets": "ondo",
        "st0x": "st0x",
        "centrifuge": "centrifuge",
        "backed": "backed",
        "backed-finance": "backed",
        "backed-xstocks": "backed",
        "xstocks": "backed",
        "xstock": "backed",
    }
    if "robinhood" in text:
        return "robinhood"
    return aliases.get(text, text or "unknown")


def issuer_excluded(slug: str) -> bool:
    return slug == "robinhood" or slug.startswith("robinhood-")


def is_preipo_text(symbol: str, name: str) -> bool:
    sym = normalize_symbol(symbol)
    if sym in PREIPO_SYMBOLS or sym.endswith("SPCX"):
        return True
    text = f"{symbol} {name}".lower()
    if "pre-ipo" in text or "pre ipo" in text or "preipo" in text:
        return True
    return "spacex" in text or "space exploration technologies" in text


def is_fixed_income_or_commodity(symbol: str, name: str) -> bool:
    """Treasury, bond, and metal products are not equity / pre-IPO / equity ETF."""
    text = f"{symbol} {name}".lower()
    needles = (
        "gold trust",
        "gold etf",
        "gold tokenized",
        "tokenized gold",
        "physical gold",
        "silver shares",
        "silver etf",
        "physical silver",
        "platinum shares",
        "platinum etf",
        "physical platinum",
        "palladium",
        "treasury",
        "t-bill",
        "t bill",
        "govies",
        "government bond",
        "ultrashort bond",
        "bond etf",
        "income opportunity",
        "limited duration income",
        "high yield",
        "money market",
        "silver trust",
        "oil fund",
        "oil enhanced",
        "wheat fund",
        "sukuk",
        "box etf",
    )
    if any(needle in text for needle in needles):
        return True
    # "United Stated Oil Tokenized Fund" is a commodity even when "oil" and
    # "fund" are not adjacent. Listed equities are not named that way.
    if re.search(r"\boil\b", text) and re.search(r"\bfund\b", text):
        return True
    # Whole word. "Clorox" is the equity CLX, not a CLO.
    return re.search(r"\bclo\b", text) is not None


def is_etf_text(_symbol: str, name: str) -> bool:
    """ETF / ETN / ETP from the product name. The ticker alone is not enough.

    Eaton's ticker is ETN and is a common share. Matching the symbol would
    file that equity in the ETF lane. Index funds and UltraPro products are
    ETFs even when the name omits the word ETF.
    """
    text = (name or "").upper()
    if re.search(r"\bETF\b", text) or re.search(r"\bETN\b", text) or re.search(r"\bETP\b", text):
        return True
    if "INDEX FUND" in text or "ULTRAPRO" in text:
        return True
    return False


def classify_kind(kind_raw: str, symbol: str, company: str) -> str | None:
    """Map a registry kind into equity / etf / preipo. Unknown kinds fail closed.

    ETF is decided before pre-IPO, matching the Solana classifier: a product
    whose name is an ETF stays in the ETF lane even when the name also mentions
    a private company (a short SpaceX ETF is not the pre-IPO share).
    """
    kind = (kind_raw or "").strip().lower().replace("_", "-")
    # The product name wins over a registry kind. Eaton's ticker is ETN and the
    # name is ordinary shares, so it stays equity. VXX is filed as stock in
    # some registries and the name is an ETN, so it stays in the ETF lane.
    if is_etf_text(symbol, company):
        return "etf"
    if is_preipo_text(symbol, company) or kind in {"private", "preipo", "pre-ipo"}:
        return "preipo"
    if kind in {"stock", "equity", "share", "shares"}:
        return "equity"
    if kind not in {"etf", "index"}:
        return None
    upper = (company or "").upper()
    # Registry sometimes files operating companies as etf. REIT/BDC names that
    # are listed equities ("Trust, Inc.", lending funds) stay equity. Product
    # trusts and funds (QQQ, GLD, IBIT, oil/wheat) stay in the ETF lane.
    if "TRUST, INC" in upper or "LENDING FUND" in upper or "DIRECT LENDING" in upper:
        return "equity"
    if any(needle in upper for needle in ("TRUST", "FUND", "ETP", "INDEX")):
        return "etf"
    return "equity"


# Anchored underlyings that are commodities or treasury/bond funds, not equity ETFs.
ANCHORED_COMMODITY_UNDERLYINGS = {"BIL", "BNO", "GLD", "SLV", "TBT", "TLT", "USO"}
# Equity-index and single-stock ETF tickers whose on-chain name often omits "ETF".
ANCHORED_ETF_UNDERLYINGS = {
    "AIQ",
    "ALLW",
    "ARKQ",
    "BOTZ",
    "CONI",
    "EWY",
    "FLKR",
    "GDX",
    "MRNX",
    "NVD",
    "QQQ",
    "QTUM",
    "SDS",
    "SKDD",
    "SMH",
    "SOXL",
    "SPCG",
    "SQQQ",
    "TQQQ",
    "TSLZ",
    "URA",
    "XLK",
}
ANCHORED_EXCLUDE_NAME = re.compile(
    r"gold shares|silver trust|oil fund|brent oil|\bt-bill\b|treasury",
    re.I,
)
ANCHORED_ETF_NAME = re.compile(
    r"\bETF\b|\bETP\b|index fund|ultrapro|ultrashort|"
    r"\bSPDR\b|\biShares\b|\bInvesco QQQ\b|\bGlobal X\b|"
    r"\bVanEck\b|\bDirexion\b|\bProShares\b|\bGraniteShares\b|\bDefiance\b|"
    r"\bTradr\b|\bT-Rex\b|select sector|\bFTSE\b|S&P\s*500|\b2[xX]\b|\b3[xX]\b",
    re.I,
)
ANCHORED_ROW_RE = re.compile(
    r"<td>\s*(a[A-Za-z0-9]+)\s*</td>\s*<td>\s*(0x[a-fA-F0-9]{40})\s*</td>",
    re.I,
)
ERC20_NAME_SELECTOR = "0x06fdde03"


def anchored_underlying(symbol: str) -> str:
    raw = (symbol or "").strip()
    if len(raw) > 1 and raw[0] in {"a", "A"}:
        return normalize_symbol(raw[1:])
    return normalize_symbol(raw)


def classify_anchored(symbol: str, name: str) -> str | None:
    """Anchored aStocks. Commodity and treasury products are omitted.

    ETF is classified before pre-IPO. aSPCG is a short SpaceX ETF. aSPCX is
    the pre-IPO share. aETN is Eaton common stock, not an ETN.
    """
    underlying = anchored_underlying(symbol)
    if underlying in ANCHORED_COMMODITY_UNDERLYINGS or is_fixed_income_or_commodity(symbol, name):
        return None
    if name and ANCHORED_EXCLUDE_NAME.search(name):
        return None
    if (
        is_etf_text(symbol, name)
        or underlying in ANCHORED_ETF_UNDERLYINGS
        or (name and ANCHORED_ETF_NAME.search(name))
    ):
        return "etf"
    if is_preipo_text(symbol, name) or underlying == "SPCX":
        return "preipo"
    return "equity"


def listings_from_anchored_docs(markdown: str) -> list[tuple[str, str]]:
    """Tokenized-stock table only. Ethereum-only fund shares are below that heading."""
    text = markdown or ""
    start = text.lower().find("tokenized stocks")
    end = text.lower().find("tokenized funds")
    section = text[start:end] if start >= 0 and end > start else text
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for symbol, address in ANCHORED_ROW_RE.findall(section):
        key = address.lower()
        if key in seen:
            continue
        seen.add(key)
        found.append((symbol, address))
    return found


def _decode_abi_string(raw: str | None) -> str | None:
    if not raw or not isinstance(raw, str) or not raw.startswith("0x"):
        return None
    h = raw[2:]
    if len(h) < 128:
        return None
    try:
        strlen = int(h[64:128], 16)
    except ValueError:
        return None
    if strlen <= 0 or strlen > 300:
        return None
    try:
        return bytes.fromhex(h[128 : 128 + strlen * 2]).decode("utf-8")
    except ValueError:
        return None


def erc20_names(addresses: list[str]) -> dict[str, str]:
    """Best-effort Base name() reads. A failed RPC leaves names empty."""
    import urllib.error
    from concurrent.futures import ThreadPoolExecutor

    names: dict[str, str] = {}
    if not addresses:
        return names

    def read_one(rpc: str, addr: str) -> tuple[str, str | None]:
        payload = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "eth_call",
                "params": [{"to": addr, "data": ERC20_NAME_SELECTOR}, "latest"],
            }
        ).encode()
        req = urllib.request.Request(
            rpc,
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": UA["User-Agent"]},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                out = json.loads(resp.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return addr, None
        return addr, _decode_abi_string(out.get("result") if isinstance(out, dict) else None)

    pending = list(addresses)
    for rpc in BASE_RPCS:
        if not pending:
            break
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = pool.map(lambda addr, rpc=rpc: read_one(rpc, addr), pending)
        still: list[str] = []
        for addr, name in results:
            if name:
                names[addr.lower()] = name
            else:
                still.append(addr)
        pending = still
    return names


def classify_named(symbol: str, name: str, kind_hint: str = "") -> str | None:
    """Classify a Coinbase/Ondo/Dinari record that may not carry a kind."""
    mapped = classify_kind(kind_hint, symbol, name)
    if mapped is not None:
        return mapped
    if is_preipo_text(symbol, name):
        return "preipo"
    if is_etf_text(symbol, name):
        return "etf"
    if kind_hint:
        return None
    return "equity"


def _row(symbol: str, name: str, address: str, kind: str, issuer: str) -> dict | None:
    if not isinstance(address, str):
        return None
    address = address.strip()
    if not address.startswith("0x") or len(address) != 42:
        return None
    try:
        int(address[2:], 16)
    except ValueError:
        return None
    slug = issuer_slug(issuer)
    if issuer_excluded(slug):
        return None
    if kind not in {"equity", "preipo", "etf"}:
        return None
    return {
        "symbol": symbol or address[:8],
        "name": name or symbol or address,
        "address": address,
        "kind": kind,
        "issuer": slug,
    }


def tokens_from_docs_markdown(markdown: str) -> list[dict]:
    rows: list[dict] = []
    for ticker, address in DOCS_ROW_RE.findall(markdown or ""):
        if ticker.lower() in SKIP_DOC_TICKERS or "registry" in ticker.lower():
            continue
        kind = classify_named(ticker, ticker)
        row = _row(ticker, f"Coinbase {ticker}", address, kind or "equity", "coinbase")
        if row:
            rows.append(row)
    return rows


def listings_from_coinbase_api(data: Any) -> list[dict]:
    rows: list[dict] = []
    tokens = data.get("tokens") if isinstance(data, dict) else data
    if not isinstance(tokens, list):
        return rows
    for token in tokens:
        if not isinstance(token, dict):
            continue
        symbol = str(token.get("symbol") or "")
        name = str(token.get("name") or symbol)
        kind_hint = str(token.get("kind") or token.get("asset_type") or token.get("assetType") or "")
        kind = classify_named(symbol, name, kind_hint)
        if kind is None:
            continue
        row = _row(symbol, name, str(token.get("contract_address") or token.get("address") or ""), kind, "coinbase")
        if row:
            rows.append(row)
    return rows


def _stocksonchain_listing_rows(stock: dict) -> list[dict]:
    rows: list[dict] = []
    kind_raw = str(stock.get("kind") or stock.get("type") or "")
    company = str(stock.get("company") or stock.get("name") or "")
    ticker = str(stock.get("ticker") or stock.get("symbol") or "")
    listings = stock.get("listings")
    if not isinstance(listings, list):
        listings = []
    # Legacy flat token objects (chain / deployments on the stock itself).
    if not listings and (stock.get("address") or stock.get("contractAddress") or stock.get("deployments")):
        listings = [stock]
    for listing in listings:
        if not isinstance(listing, dict):
            continue
        chain = listing.get("chain") or listing.get("network") or listing.get("chainId")
        address = listing.get("address") or listing.get("contractAddress")
        if not is_base_chain(chain):
            deps = listing.get("deployments") or listing.get("chains") or []
            if isinstance(deps, list):
                for dep in deps:
                    if isinstance(dep, dict) and is_base_chain(dep.get("chainId") or dep.get("chain")):
                        chain = dep.get("chainId") or dep.get("chain")
                        address = dep.get("address") or dep.get("contractAddress") or address
                        break
                    if isinstance(dep, str) and is_base_chain(dep):
                        chain = dep
                        break
            if not is_base_chain(chain):
                continue
        symbol = str(listing.get("onchainSymbol") or listing.get("symbol") or ticker or "")
        issuer = str(listing.get("issuer") or stock.get("issuer") or "")
        kind = classify_kind(kind_raw, symbol or ticker, company)
        if kind is None:
            continue
        row = _row(symbol or ticker, company or symbol or ticker, str(address or ""), kind, issuer)
        if row:
            rows.append(row)
    return rows


def listings_from_stocksonchain(data: Any) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    skipped: list[str] = []
    stocks: Any = None
    if isinstance(data, dict):
        stocks = data.get("stocks")
        if not isinstance(stocks, list):
            stocks = data.get("tokens")
    elif isinstance(data, list):
        stocks = data
    if not isinstance(stocks, list):
        return rows, skipped
    for stock in stocks:
        if not isinstance(stock, dict):
            continue
        symbol = str(stock.get("ticker") or stock.get("symbol") or "")
        company = str(stock.get("company") or stock.get("name") or "")
        if is_fixed_income_or_commodity(symbol, company):
            # Still only counts when a Base listing exists, so other chains do not spam the note.
            if _stocksonchain_listing_rows(stock):
                skipped.append(symbol or company)
            continue
        rows.extend(_stocksonchain_listing_rows(stock))
    return rows, skipped


def _ondo_asset_meta(data: Any) -> dict[str, dict]:
    meta: dict[str, dict] = {}
    items: Any = data
    if isinstance(data, dict):
        items = data.get("assets") or data.get("data") or data.get("items") or []
    if not isinstance(items, list):
        return meta
    for asset in items:
        if not isinstance(asset, dict):
            continue
        symbol = str(asset.get("symbol") or "")
        if not symbol:
            continue
        meta[symbol.upper()] = asset
    return meta


def _ondo_kind(symbol: str, asset: dict | None) -> str | None:
    asset = asset or {}
    name = str(asset.get("name") or asset.get("description") or asset.get("ticker") or symbol)
    hint = str(
        asset.get("assetType")
        or asset.get("asset_type")
        or asset.get("assetClass")
        or asset.get("category")
        or asset.get("kind")
        or asset.get("type")
        or ""
    )
    # Ondo GM is the stock/ETF API. Treasuries published on a different product
    # stay out when the payload says so. With no type, a GM Base address is equity
    # unless the name/symbol is an ETF or pre-IPO.
    lowered = hint.lower()
    if any(word in lowered for word in ("treasur", "money market", "cash", "credit", "bond")):
        return None
    return classify_named(symbol, name, hint if hint else "")


def listings_from_ondo(addresses: Any, assets: Any = None) -> list[dict]:
    rows: list[dict] = []
    meta = _ondo_asset_meta(assets) if assets is not None else {}
    items = addresses
    if isinstance(addresses, dict):
        items = addresses.get("assets") or addresses.get("data") or addresses.get("items") or []
    if not isinstance(items, list):
        return rows
    for item in items:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "")
        asset = meta.get(symbol.upper())
        kind = _ondo_kind(symbol, asset)
        if kind is None:
            continue
        name = str((asset or {}).get("name") or symbol)
        addr_rows = item.get("addresses") or item.get("networks") or []
        if isinstance(item.get("address"), str) and is_base_chain(item.get("networkChainId") or item.get("chain")):
            addr_rows = [item]
        if not isinstance(addr_rows, list):
            continue
        for addr in addr_rows:
            if not isinstance(addr, dict):
                continue
            network = addr.get("networkChainId") or addr.get("chainId") or addr.get("chain") or addr.get("network")
            if not is_base_chain(network):
                continue
            row = _row(symbol, name, str(addr.get("address") or ""), kind, "ondo")
            if row:
                ONDO_OFFICIAL_BASE.add(row["address"].lower())
                rows.append(row)
    return rows


def _caip10_base_address(token: str) -> str | None:
    text = (token or "").strip()
    # eip155:8453:0xabc...
    parts = text.split(":")
    if len(parts) >= 3 and parts[0].lower() == "eip155" and parts[1] == "8453":
        address = parts[2]
        if address.startswith("0x") and len(address) == 42:
            return address
    return None


def listings_from_dinari_page(data: Any) -> tuple[list[dict], str | None]:
    rows: list[dict] = []
    items: Any = data
    next_cursor: str | None = None
    if isinstance(data, dict):
        items = (
            data.get("results")
            or data.get("items")
            or data.get("data")
            or data.get("stocks")
            or []
        )
        cursor = data.get("next") or data.get("next_page") or data.get("next_cursor")
        if isinstance(cursor, str) and cursor.strip():
            next_cursor = cursor.strip()
    if not isinstance(items, list):
        return rows, next_cursor
    for stock in items:
        if not isinstance(stock, dict):
            continue
        symbol = str(stock.get("symbol") or "")
        name = str(stock.get("name") or stock.get("display_name") or symbol)
        hint = str(stock.get("kind") or stock.get("asset_type") or stock.get("type") or "")
        if is_fixed_income_or_commodity(symbol, name):
            continue
        kind = classify_named(symbol, name, hint)
        if kind is None:
            continue
        tokens = stock.get("tokens") or stock.get("token_addresses") or []
        if isinstance(tokens, str):
            tokens = [tokens]
        if not isinstance(tokens, list):
            continue
        for token in tokens:
            address = _caip10_base_address(str(token))
            if not address:
                continue
            row = _row(symbol, name, address, kind, "dinari")
            if row:
                rows.append(row)
    return rows, next_cursor


def listings_from_st0x(data: Any) -> tuple[list[dict], list[str]]:
    """Wrapped ST0x Base tokens. Unwrapped receipts are the same product.

    Commodity and treasury tokens are skipped. chainId must be Base.
    """
    rows: list[dict] = []
    skipped: list[str] = []
    tokens = data.get("tokens") if isinstance(data, dict) else data
    if not isinstance(tokens, list):
        return rows, skipped
    for token in tokens:
        if not isinstance(token, dict):
            continue
        chain = token.get("chainId")
        if chain not in (CHAIN_ID, str(CHAIN_ID)):
            continue
        symbol = str(token.get("symbol") or "")
        name = str(token.get("name") or symbol)
        if is_fixed_income_or_commodity(symbol, name):
            skipped.append(symbol or name)
            continue
        kind = classify_named(symbol, name)
        if kind is None:
            skipped.append(symbol or name)
            continue
        row = _row(symbol, name, str(token.get("address") or ""), kind, "st0x")
        if row:
            rows.append(row)
        else:
            skipped.append(symbol or name)
    return rows, skipped


def centrifuge_equity_kind(symbol: str) -> str | None:
    """Centrifuge equity-index share tokens only. Credit and treasury stay out."""
    sym = normalize_symbol(symbol)
    if not sym:
        return None
    if any(token in sym for token in ("TRSY", "JAAA", "CRDX", "HYB")):
        return None
    if "SPX" in sym or "QQQ" in sym or "IWM" in sym:
        return "etf"
    return None


_HTML_TAG_RE = re.compile(r"<[^>]+>")


def _html_text(fragment: str) -> str:
    text = _HTML_TAG_RE.sub(" ", fragment or "")
    text = text.replace("\u200b", "").replace("\u200c", "").replace("\u200d", "").replace("\ufeff", "")
    return re.sub(r"\s+", " ", text).strip()


def listings_from_centrifuge_html(html: str) -> tuple[list[dict], list[str]]:
    """Parse the deployments page token tables. Vault addresses are not tokens."""
    rows: list[dict] = []
    unknown: list[str] = []
    lower = html.lower()
    start = lower.find('id="tokens"')
    end = lower.find('id="vaults"', start if start >= 0 else 0)
    section = html[start:end] if start >= 0 and end > start else html
    parts = re.split(r"<h4[^>]*>", section, flags=re.I)
    for part in parts[1:]:
        match = re.match(r"(.*?)</h4>(.*)", part, flags=re.I | re.S)
        if not match:
            continue
        symbol = _html_text(match.group(1))
        table = re.search(r"<table>(.*?)</table>", match.group(2), flags=re.I | re.S)
        if not table:
            continue
        address = None
        for tr in re.findall(r"<tr>(.*?)</tr>", table.group(1), flags=re.I | re.S):
            cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.I | re.S)
            if len(cells) < 2:
                continue
            addr_match = re.search(r"0x[a-fA-F0-9]{40}", cells[1])
            if _html_text(cells[0]).lower() == "base" and addr_match:
                address = addr_match.group(0)
                break
        if not address:
            continue
        kind = centrifuge_equity_kind(symbol)
        if kind is None:
            unknown.append(symbol)
            continue
        row = _row(symbol, f"Centrifuge {symbol}", address, kind, "centrifuge")
        if row:
            rows.append(row)
    return rows, unknown


def classify_backed(symbol: str, name: str, underlying: str = "") -> str | None:
    """Backed b* products. Bonds and T-bills stay out. CSPX is the S&P 500 ETF.

    ETF is decided before a default equity classification. bCSPX's on-chain
    name is "Core S&P 500" and does not contain the word ETF.
    """
    text = f"{symbol} {name} {underlying}"
    if is_fixed_income_or_commodity(symbol, text):
        return None
    upper_name = (name or "").upper()
    sym = normalize_symbol(symbol)
    if (
        is_etf_text(symbol, name)
        or sym in {"BCSPX", "CSPX"}
        or "S&P 500" in upper_name
        or "CORE S&P" in upper_name
    ):
        return "etf"
    if is_preipo_text(symbol, name):
        return "preipo"
    return "equity"


def listings_from_backed_api(data: Any) -> tuple[list[dict], list[str]]:
    """Official Backed registry rows deployed on Base. Lookalike addresses are not rows."""
    rows: list[dict] = []
    skipped: list[str] = []
    nodes = data.get("nodes") if isinstance(data, dict) else None
    if not isinstance(nodes, list):
        return rows, skipped
    for node in nodes:
        if not isinstance(node, dict):
            continue
        symbol = str(node.get("symbol") or "")
        name = str(node.get("name") or symbol)
        underlying = str(node.get("underlyingSymbol") or "")
        kind = classify_backed(symbol, name, underlying)
        deployments = node.get("deployments")
        if not isinstance(deployments, list):
            continue
        for dep in deployments:
            if not isinstance(dep, dict) or str(dep.get("network") or "") != "Base":
                continue
            address = str(dep.get("address") or "")
            if address.startswith("0x") and len(address) == 42:
                BACKED_OFFICIAL_BASE.add(address.lower())
                if symbol:
                    BACKED_OFFICIAL_SYMBOLS.add(normalize_symbol(symbol))
            if kind is None:
                if symbol:
                    skipped.append(symbol)
                continue
            row = _row(symbol, name, address, kind, "backed")
            if row:
                rows.append(row)
    return rows, skipped


def listings_from_xstocks_base(data: Any) -> list[dict]:
    rows: list[dict] = []
    nodes = data.get("nodes") if isinstance(data, dict) else None
    if not isinstance(nodes, list):
        return rows
    for node in nodes:
        if not isinstance(node, dict):
            continue
        symbol = str(node.get("symbol") or "")
        name = str(node.get("name") or symbol)
        underlying = node.get("underlying") if isinstance(node.get("underlying"), dict) else {}
        hint = str(underlying.get("type") or node.get("underlyingType") or "")
        if is_fixed_income_or_commodity(symbol, name):
            continue
        kind = classify_named(symbol, name, hint)
        if kind is None:
            continue
        deployments = node.get("deployments")
        if not isinstance(deployments, list):
            continue
        for dep in deployments:
            if not isinstance(dep, dict):
                continue
            if str(dep.get("network") or "") != "Base":
                continue
            row = _row(symbol, name, str(dep.get("address") or ""), kind, "backed")
            if row:
                rows.append(row)
    return rows


class Universe:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self._by_addr: dict[str, dict] = {}
        self.added_by: dict[str, int] = {}
        self.consulted: list[str] = []
        self.errors: list[str] = []

    def mark(self, source: str) -> None:
        if source not in self.consulted:
            self.consulted.append(source)

    def add(self, row: dict | None, source: str) -> None:
        self.mark(source)
        if row is None:
            return
        key = row["address"].lower()
        existing = self._by_addr.get(key)
        if existing is None:
            self._by_addr[key] = row
            self.rows.append(row)
            self.added_by[source] = self.added_by.get(source, 0) + 1
            return
        # ETF wins over equity and pre-IPO when either source classified the mint as an ETF.
        if row["kind"] == "etf":
            existing["kind"] = "etf"
        elif existing["kind"] != "etf" and (row["kind"] == "preipo" or existing["kind"] == "preipo"):
            existing["kind"] = "preipo"
        if existing["name"].startswith("Coinbase ") and row.get("name"):
            existing["name"] = row["name"]
        if existing["issuer"] in {"", "unknown"} and row.get("issuer"):
            existing["issuer"] = row["issuer"]
        if row.get("symbol") and existing["symbol"].startswith("0x"):
            existing["symbol"] = row["symbol"]

    def warn(self, message: str) -> None:
        self.errors.append(message)
        print(f"warn {message}", file=sys.stderr)


def _remember_coinbase(address: str) -> None:
    if isinstance(address, str) and address.startswith("0x") and len(address) == 42:
        COINBASE_OFFICIAL_BASE.add(address.lower())


def load_seed(universe: Universe) -> None:
    for symbol, address in B20_EQUITY.items():
        _remember_coinbase(address)
        universe.add(_row(symbol, f"Coinbase {symbol}", address, "equity", "coinbase"), "seed")
    for symbol, address in B20_PREIPO.items():
        _remember_coinbase(address)
        universe.add(_row(symbol, f"Coinbase {symbol}", address, "preipo", "coinbase"), "seed")


def load_coinbase_api(universe: Universe) -> None:
    try:
        data = fetch_json(COINBASE_API)
    except Exception as e:  # noqa: BLE001
        universe.warn(f"coinbase tokenized-stocks: {e}")
        return
    universe.mark("coinbase-api")
    rows = listings_from_coinbase_api(data)
    for row in rows:
        _remember_coinbase(row["address"])
        universe.add(row, "coinbase-api")
    print(f"snapshot:base coinbase-api tokens={len(rows)}", flush=True)


def load_base_docs(universe: Universe) -> None:
    last_error: Exception | None = None
    for url in BASE_DOCS_MD:
        try:
            markdown = fetch_text(url)
        except Exception as e:  # noqa: BLE001
            last_error = e
            continue
        rows = tokens_from_docs_markdown(markdown)
        if not rows:
            continue
        universe.mark("base-docs")
        for row in rows:
            _remember_coinbase(row["address"])
            universe.add(row, "base-docs")
        print(f"snapshot:base base-docs tokens={len(rows)} url={url}", flush=True)
        return
    universe.warn(f"base docs contract table: {last_error}")


def load_stocksonchain(desk: Universe) -> None:
    """Every Base equity, pre-IPO, and ETF issuer. Robinhood Chain stays out."""
    try:
        data = fetch_json(STOCKSONCHAIN)
    except Exception as e:  # noqa: BLE001
        desk.warn(f"stocksonchain universe: {e}")
        return
    desk.mark("stocksonchain")
    rows, skipped = listings_from_stocksonchain(data)
    if skipped:
        desk.warn(
            "stocksonchain Base tokens omitted (commodity/treasury/bond/credit, not equity/preipo/etf): "
            + ", ".join(sorted(set(skipped)))
        )
    by_issuer: dict[str, int] = {}
    for row in rows:
        if issuer_excluded(row["issuer"]):
            continue
        before = len(desk.rows)
        desk.add(row, "stocksonchain")
        if len(desk.rows) != before:
            by_issuer[row["issuer"]] = by_issuer.get(row["issuer"], 0) + 1
    print(
        f"snapshot:base stocksonchain base listings={len(rows)} included={by_issuer}",
        flush=True,
    )


def load_ondo(universe: Universe) -> None:
    headers: dict[str, str] = {}
    api_key = (os.environ.get("ONDO_API_KEY") or "").strip()
    if api_key:
        headers["x-api-key"] = api_key
    try:
        addresses = fetch_json(ONDO_ADDRESSES, headers=headers or None)
    except Exception as e:  # noqa: BLE001
        # Ondo GM currently publishes ethereum, BNB, and Solana. Base addresses
        # are included only when this call succeeds and names chain 8453.
        # A 401/403 without ONDO_API_KEY is a skipped source, not an empty lane.
        universe.warn(f"ondo addresses (Base included when listed): {e}")
        return
    universe.mark("ondo")
    assets = None
    try:
        assets = fetch_json(ONDO_ASSETS, headers=headers or None)
    except Exception as e:  # noqa: BLE001
        universe.warn(f"ondo asset metadata: {e}")
    rows = listings_from_ondo(addresses, assets)
    for row in rows:
        universe.add(row, "ondo")
    print(f"snapshot:base ondo base tokens={len(rows)}", flush=True)


def load_dinari(universe: Universe) -> None:
    key_id = (os.environ.get("DINARI_API_KEY_ID") or "").strip()
    secret = (os.environ.get("DINARI_API_SECRET_KEY") or "").strip()
    if not key_id or not secret:
        print(
            "snapshot:base dinari-api skipped (no DINARI_API_KEY_ID); stocksonchain still supplies Base dShares",
            flush=True,
        )
        return
    headers = {"X-API-Key-Id": key_id, "X-API-Secret-Key": secret}
    url: str | None = DINARI_STOCKS
    seen_cursors: set[str] = set()
    pages = 0
    added = 0
    while url and pages < 40:
        pages += 1
        try:
            data = fetch_json(url, headers=headers)
        except Exception as e:  # noqa: BLE001
            universe.warn(f"dinari stocks: {e}")
            return
        universe.mark("dinari-api")
        rows, cursor = listings_from_dinari_page(data)
        for row in rows:
            before = len(universe.rows)
            universe.add(row, "dinari-api")
            if len(universe.rows) != before:
                added += 1
        if not cursor or cursor in seen_cursors:
            break
        seen_cursors.add(cursor)
        if cursor.startswith("http://") or cursor.startswith("https://"):
            url = cursor
        else:
            url = f"https://api-enterprise.sbt.dinari.com/api/v2/market_data/stocks/?limit=100&next={cursor}"
    print(f"snapshot:base dinari-api new base tokens={added} pages={pages}", flush=True)


def load_st0x(universe: Universe) -> None:
    try:
        data = fetch_json(ST0X_BASE_LIST)
    except Exception as e:  # noqa: BLE001
        universe.warn(f"st0x base token list: {e}")
        return
    rows, skipped = listings_from_st0x(data)
    for row in rows:
        universe.add(row, "st0x")
    print(
        f"snapshot:base st0x tokens={len(rows)} skipped_commodity_or_credit={len(skipped)}",
        flush=True,
    )


def load_centrifuge(universe: Universe) -> None:
    rows: list[dict] = []
    unknown: list[str] = []
    try:
        html = fetch_text(CENTRIFUGE_DOCS)
        rows, unknown = listings_from_centrifuge_html(html)
    except Exception as e:  # noqa: BLE001
        universe.warn(f"centrifuge deployments page: {e}")
    if not rows:
        for symbol, address in CENTRIFUGE_ETF_SEED.items():
            rows.append(_row(symbol, f"Centrifuge {symbol}", address, "etf", "centrifuge"))
        universe.warn("centrifuge: used seeded SPXA and deSPXA share tokens")
    for row in rows:
        if row:
            universe.add(row, "centrifuge")
    if unknown:
        universe.warn(
            "centrifuge Base tokens omitted (not equity/preipo/etf): " + ", ".join(unknown)
        )
    print(f"snapshot:base centrifuge tokens={sum(1 for row in rows if row)}", flush=True)


def load_backed(universe: Universe) -> None:
    """Official Backed Base deployments, xStocks pages, and verified wb* wrappers."""
    added = 0
    api_rows = 0
    try:
        data = fetch_json(BACKED_API)
    except Exception as e:  # noqa: BLE001
        universe.warn(f"backed api: {e}")
        data = None
    if data is not None:
        universe.mark("backed-api")
        rows, skipped = listings_from_backed_api(data)
        api_rows = len(rows)
        for row in rows:
            before = len(universe.rows)
            universe.add(row, "backed-api")
            if len(universe.rows) != before:
                added += 1
        if skipped:
            universe.warn(
                "backed Base tokens omitted (treasury/bond/credit, not equity/preipo/etf): "
                + ", ".join(sorted(set(skipped)))
            )
    pages = 0
    url_page = 1
    xstocks_added = 0
    while url_page <= 20:
        pages += 1
        try:
            page_data = fetch_json(XSTOCKS_BASE.format(page=url_page))
        except Exception as e:  # noqa: BLE001
            universe.warn(f"xstocks base registry: {e}")
            break
        universe.mark("xstocks")
        rows = listings_from_xstocks_base(page_data)
        for row in rows:
            before = len(universe.rows)
            universe.add(row, "xstocks")
            if len(universe.rows) != before:
                xstocks_added += 1
                added += 1
        page = page_data.get("page") if isinstance(page_data, dict) else None
        has_next = isinstance(page, dict) and page.get("hasNextPage") is True
        if not has_next:
            break
        url_page += 1
    verified = 0
    for symbol, address in BACKED_BASE_EQUITY.items():
        # wb* wrappers are the non-rebasing leg. Official b* addresses also
        # come from the Backed API; seeding them covers an API miss.
        kind = classify_backed(symbol, BACKED_BASE_NAMES.get(symbol, symbol))
        if kind is None:
            continue
        row = _row(symbol, BACKED_BASE_NAMES.get(symbol, symbol), address, kind, "backed")
        before = len(universe.rows)
        universe.add(row, "backed-verified")
        if len(universe.rows) != before:
            verified += 1
            added += 1
        BACKED_OFFICIAL_BASE.add(address.lower())
        BACKED_OFFICIAL_SYMBOLS.add(normalize_symbol(symbol))
    if api_rows == 0 and xstocks_added == 0:
        universe.warn(
            "backed: live registries listed no new Base assets; included BaseScan-verified "
            "bNVDA, bCOIN, bTSLA, bMSTR and the wb wrappers"
        )
    print(
        f"snapshot:base backed/xstocks new tokens={added} api={api_rows} "
        f"xstocks={xstocks_added} verified_extra={verified} pages={pages}",
        flush=True,
    )


def load_anchored(universe: Universe) -> None:
    """Official Anchored tokenized-stock table. Same address on Base as on Ethereum."""
    try:
        markdown = fetch_text(ANCHORED_DOCS)
    except Exception as e:  # noqa: BLE001
        universe.warn(f"anchored docs: {e}")
        return
    listed = listings_from_anchored_docs(markdown)
    if not listed:
        universe.warn("anchored docs: tokenized-stock table was empty")
        return
    universe.mark("anchored-docs")
    names = erc20_names([address for _symbol, address in listed])
    if len(names) < len(listed):
        universe.warn(
            f"anchored: on-chain name() missing for {len(listed) - len(names)} tokens; "
            "ticker rules still classify ETF, pre-IPO, and commodity/treasury"
        )
    added = 0
    skipped: list[str] = []
    for symbol, address in listed:
        ANCHORED_OFFICIAL_BASE.add(address.lower())
        name = names.get(address.lower()) or f"Anchored {symbol}"
        kind = classify_anchored(symbol, name)
        if kind is None:
            skipped.append(symbol)
            continue
        before = len(universe.rows)
        universe.add(_row(symbol, name, address, kind, "anchored"), "anchored-docs")
        if len(universe.rows) != before:
            added += 1
    if skipped:
        universe.warn(
            "anchored Base tokens omitted (commodity/treasury, not equity/preipo/etf): "
            + ", ".join(skipped)
        )
    print(f"snapshot:base anchored tokens={added} omitted={len(skipped)}", flush=True)


_GENERIC_CATEGORY_RE = re.compile(
    r"^(?:tokenized stocks?|xstocks?|ondotokenizedstock|tokenized equity|prestocks)$",
    re.I,
)


def _note_lookalike(issuer: str, symbol: str, address: str) -> None:
    label = f"{symbol or address} ({issuer})"
    if label not in DEX_LOOKALIKES:
        DEX_LOOKALIKES.append(label)


def _dex_word(blob: str, word: str) -> bool:
    """Whole-word match. 'Adshares' is not a dShare, and 'xStocks' is not one stock."""
    return re.search(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", blob) is not None


def _generic_category(symbol: str, name: str) -> bool:
    for text in (symbol, name):
        if _GENERIC_CATEGORY_RE.match((text or "").strip()):
            return True
    return False


def _dex_search_row(token: dict) -> dict | None:
    """Admit a DexScreener base/quote token only with a verifiable issuer signal."""
    if not isinstance(token, dict):
        return None
    symbol = str(token.get("symbol") or "")
    name = str(token.get("name") or "")
    address = str(token.get("address") or "")
    if _generic_category(symbol, name):
        return None
    blob = f"{symbol} {name}".lower()
    issuer = ""
    if _dex_word(blob, "st0x"):
        issuer = "st0x"
    elif _dex_word(blob, "astock") or _dex_word(blob, "anchored"):
        issuer = "anchored"
    elif _dex_word(blob, "xstock") or _dex_word(blob, "backed"):
        issuer = "backed"
    elif _dex_word(blob, "ondo") and _dex_word(blob, "tokenized"):
        # Ondo GM tickers use the "on" suffix (TSLAon). A Base name that only
        # says "Ondo" is not the registry. The mint counts only when the Ondo
        # address API listed this contract on chain 8453.
        if not normalize_symbol(symbol).endswith("ON") or len(normalize_symbol(symbol)) <= 2:
            return None
        issuer = "ondo"
    elif _dex_word(blob, "dshare") or _dex_word(blob, "dshares") or _dex_word(blob, "dinari"):
        issuer = "dinari"
    elif address.lower().startswith("0xb200000000000000000000"):
        issuer = "coinbase"
    else:
        return None
    if is_fixed_income_or_commodity(symbol, name):
        return None
    if issuer == "st0x" and normalize_symbol(symbol) == "ST0X" and "wrapped" not in name.lower():
        # The ST0x protocol token pairs against wrapped shares. It is not a stock.
        _note_lookalike("st0x", symbol, address)
        return None
    if issuer == "backed" and BACKED_OFFICIAL_BASE and address.lower() not in BACKED_OFFICIAL_BASE:
        # The Backed API plus the verified b*/wb* seed are the Base list.
        # A pool whose name merely contains "Backed" is not another product.
        _note_lookalike("backed", symbol, address)
        return None
    if issuer == "ondo" and address.lower() not in ONDO_OFFICIAL_BASE:
        _note_lookalike("ondo", symbol, address)
        return None
    if issuer == "coinbase" and COINBASE_OFFICIAL_BASE and address.lower() not in COINBASE_OFFICIAL_BASE:
        # The public tokenized-stocks API is the Coinbase list. A b200 prefix
        # alone is a lookalike (TCS, oil funds) and is not a new equity.
        _note_lookalike("coinbase", symbol, address)
        return None
    if issuer == "anchored" and ANCHORED_OFFICIAL_BASE and address.lower() not in ANCHORED_OFFICIAL_BASE:
        # The Anchored docs table is the Base list. "ASTOCK" / ArcStocks matches
        # the aStock word and is not another Anchored product.
        _note_lookalike("anchored", symbol, address)
        return None
    if issuer == "anchored":
        kind = classify_anchored(symbol, name)
    elif issuer == "backed":
        kind = classify_backed(symbol, name)
    else:
        kind = classify_named(symbol, name)
    if kind is None:
        return None
    return _row(symbol, name, address, kind, issuer)


def load_dexscreener_search(universe: Universe) -> None:
    """Catch Base listings that registries have not published yet. Search is capped."""
    queries = ("ST0x", "aStock", "xStock", "Ondo Tokenized", "dShare", "Backed", "tokenized stock")
    added = 0
    for query in queries:
        try:
            data = fetch_json(DEX_SEARCH.format(q=urllib.parse.quote(query)))
        except Exception as e:  # noqa: BLE001
            universe.warn(f"dexscreener search {query}: {e}")
            continue
        universe.mark("dexscreener-search")
        pairs = data if isinstance(data, list) else (data.get("pairs") if isinstance(data, dict) else []) or []
        for pair in pairs:
            if str(pair.get("chainId") or "") != CHAIN_SLUG:
                continue
            for side in ("baseToken", "quoteToken"):
                row = _dex_search_row(pair.get(side) or {})
                if row is None:
                    continue
                before = len(universe.rows)
                universe.add(row, "dexscreener-search")
                if len(universe.rows) != before:
                    added += 1
        time.sleep(0.25)
    if DEX_LOOKALIKES:
        universe.warn(
            "dexscreener lookalikes omitted (not an official Base listing): "
            + ", ".join(DEX_LOOKALIKES)
        )
        DEX_LOOKALIKES.clear()
    print(f"snapshot:base dexscreener-search new tokens={added}", flush=True)


def load_universe() -> Universe:
    desk = Universe()
    load_seed(desk)
    load_coinbase_api(desk)
    load_base_docs(desk)
    load_stocksonchain(desk)
    load_st0x(desk)
    load_centrifuge(desk)
    load_backed(desk)
    # Ondo addresses are added only when the API names chain 8453. A 403 or an
    # empty Base list leaves Ondo out. stocksonchain above already included any
    # Ondo row it confirmed on Base.
    load_ondo(desk)
    load_dinari(desk)
    load_anchored(desk)
    load_dexscreener_search(desk)
    return desk


def _non_negative(raw: Any) -> float | None:
    """DexScreener number. Missing stays None. A reported 0 stays 0. Negatives are missing."""
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value < 0 or value != value:  # NaN
        return None
    return value


def _round_usd(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 2)


def sum_nullable(values: list[float | None]) -> float | None:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return round(sum(present), 2)


INSTRUMENT_KIND = {"equity": "equity", "etf": "etf", "preipo": "private"}


def hydrate_volumes(
    rows: list[dict],
) -> tuple[dict[str, float | None], dict[str, int], dict[str, list[dict]], int, int, set[str]]:
    """Unique-pool h24 sum plus per-pool liquidity.usd.

    A failed batch leaves those mints unchecked (volume and liquidity stay null).
    That does not blank mints whose batches succeeded.
    """
    by_addr = {r["address"].lower(): r for r in rows}
    vols: dict[str, float | None] = {a: None for a in by_addr}
    pool_counts: dict[str, int] = {a: 0 for a in by_addr}
    pool_details: dict[str, list[dict]] = {a: [] for a in by_addr}
    seen_pairs: dict[str, set[str]] = {a: set() for a in by_addr}
    checked: set[str] = set()
    batches_ok = 0
    batches_fail = 0

    for batch in chunks(list(by_addr.keys()), 30):
        addrs = ",".join(by_addr[a]["address"] for a in batch)
        url = DEX_BATCH.format(addrs=addrs)
        try:
            data = fetch_json(url)
            batches_ok += 1
        except Exception as e:  # noqa: BLE001
            batches_fail += 1
            print(f"warn batch failed: {e}", file=sys.stderr)
            time.sleep(1)
            continue
        checked.update(batch)
        pairs = data if isinstance(data, list) else (data.get("pairs") if isinstance(data, dict) else []) or []
        for pair in pairs:
            cid = pair.get("chainId")
            if cid and cid != CHAIN_SLUG:
                continue
            pair_address = str(pair.get("pairAddress") or "")
            pair_key = pair_address.lower()
            base = ((pair.get("baseToken") or {}).get("address") or "").lower()
            quote = ((pair.get("quoteToken") or {}).get("address") or "").lower()
            vol = _non_negative((pair.get("volume") or {}).get("h24"))
            liq = _non_negative((pair.get("liquidity") or {}).get("usd"))
            dex_id = str(pair.get("dexId") or "").strip() or "unknown"
            for addr in (base, quote):
                if addr not in by_addr:
                    continue
                if pair_key and pair_key in seen_pairs[addr]:
                    continue
                if pair_key:
                    seen_pairs[addr].add(pair_key)
                pool_counts[addr] += 1
                pool_details[addr].append(
                    {
                        "pairAddress": pair_address,
                        "dexId": dex_id,
                        "volume24hUsd": _round_usd(vol),
                        "liquidityUsd": _round_usd(liq),
                    }
                )
                if vol is None:
                    continue
                vols[addr] = (vols[addr] or 0.0) + vol
        time.sleep(0.35)

    unchecked = set(by_addr) - checked
    return vols, pool_counts, pool_details, batches_ok, batches_fail, unchecked


def snapshot_date_override() -> str | None:
    """BASE_SNAPSHOT_DATE wins over SNAPSHOT_DATE. Blank values are ignored."""
    for key in ("BASE_SNAPSHOT_DATE", "SNAPSHOT_DATE"):
        value = (os.environ.get(key) or "").strip()
        if value:
            return value
    for arg in sys.argv[1:]:
        if arg.startswith("--date="):
            value = arg.split("=", 1)[1].strip()
            if value:
                return value
    return None


def snapshot_day_key(now: datetime, override: str | None = None) -> tuple[str, int]:
    """Eastern calendar date, plus unix time for that America/New_York midnight.

    The close runs at 11:59 PM Eastern, when UTC is already the next calendar
    day. The record date is New York's calendar date. A YYYY-MM-DD override
    forces that key only; it does not invent volume.
    """
    if override is not None and override.strip():
        text = override.strip()
        parts = text.split("-")
        if len(parts) != 3 or list(map(len, parts)) != [4, 2, 2] or not all(part.isdigit() for part in parts):
            raise ValueError(f"snapshot day override must be YYYY-MM-DD, got {override!r}")
        try:
            day = date(int(parts[0]), int(parts[1]), int(parts[2]))
        except ValueError as exc:
            raise ValueError(f"snapshot day override must be a real YYYY-MM-DD date, got {override!r}") from exc
    else:
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        day = now.astimezone(EASTERN).date()
    midnight = datetime(day.year, day.month, day.day, tzinfo=EASTERN)
    return day.isoformat(), int(midnight.timestamp())


def lane_totals(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_counts: dict[str, int],
    kind: str,
    issuer: str | None = None,
) -> tuple[float | None, int, int, int]:
    total = 0.0
    any_vol = False
    mints = 0
    pools = 0
    with_vol = 0
    for row in rows:
        if row["kind"] != kind:
            continue
        if issuer is not None and row["issuer"] != issuer:
            continue
        mints += 1
        addr = row["address"].lower()
        pools += pool_counts.get(addr, 0)
        vol = vols.get(addr)
        if vol is None:
            continue
        any_vol = True
        with_vol += 1
        total += vol
    return (round(total, 2) if any_vol else None), mints, pools, with_vol


def issuer_breakdown(rows: list[dict], vols: dict[str, float | None], pool_counts: dict[str, int]) -> list[dict]:
    issuers = sorted({row["issuer"] for row in rows})
    report: list[dict] = []
    for issuer in issuers:
        eq_vol, eq_mints, _eq_pools, eq_with = lane_totals(rows, vols, pool_counts, "equity", issuer)
        etf_vol, etf_mints, _etf_pools, etf_with = lane_totals(rows, vols, pool_counts, "etf", issuer)
        pre_vol, pre_mints, _pre_pools, pre_with = lane_totals(rows, vols, pool_counts, "preipo", issuer)
        report.append(
            {
                "issuer": issuer,
                "publicEquity24hUsd": eq_vol,
                "private24hUsd": pre_vol,
                "etfIndex24hUsd": etf_vol,
                "publicMintCount": eq_mints,
                "preipoMintCount": pre_mints,
                "etfMintCount": etf_mints,
                "withVolumeEquityCount": eq_with,
                "withVolumeCount": eq_with + etf_with + pre_with,
            }
        )
    return report


def symbols_for(rows: list[dict], kind: str, issuer: str | None = None) -> list[str]:
    found = [
        row["symbol"]
        for row in rows
        if row["kind"] == kind and (issuer is None or row["issuer"] == issuer)
    ]
    return sorted(found, key=str.upper)


def assets_for(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_details: dict[str, list[dict]],
) -> list[dict]:
    """Mints with a pool, a reported h24, or reported liquidity. Others are omitted.

    instrumentKind matches the Solana snapshot: pre-IPO is "private".
    displayedLiquidityUsd is the sum of pool liquidity.usd. All-missing stays null.
    """
    found: list[dict] = []
    for row in rows:
        addr = row["address"].lower()
        pools = list(pool_details.get(addr) or [])
        vol = vols.get(addr)
        displayed = sum_nullable([pool.get("liquidityUsd") for pool in pools])
        if not pools and vol is None and displayed is None:
            continue
        found.append(
            {
                "address": row["address"],
                "symbol": row["symbol"],
                "issuer": row["issuer"],
                "instrumentKind": INSTRUMENT_KIND.get(row["kind"], "equity"),
                "volume24hUsd": _round_usd(vol),
                "displayedLiquidityUsd": displayed,
                "pools": pools,
            }
        )
    found.sort(key=lambda item: (item["symbol"].upper(), item["address"].lower()))
    return found


def symbols_with_volume(rows: list[dict], vols: dict[str, float | None]) -> list[dict]:
    """Non-null DexScreener h24 only. Null/absent is not a $0 hit."""
    found: list[dict] = []
    for row in rows:
        vol = vols.get(row["address"].lower())
        if vol is None:
            continue
        found.append(
            {
                "symbol": row["symbol"],
                "issuer": row["issuer"],
                "kind": row["kind"],
                "address": row["address"],
                "volume24hUsd": round(vol, 2),
            }
        )
    found.sort(key=lambda item: (-item["volume24hUsd"], item["issuer"], item["symbol"].upper()))
    return found


def should_write(record: dict) -> bool:
    return record["combined24hUsd"] is not None


def build_record(
    rows: list[dict],
    vols: dict[str, float | None],
    pool_counts: dict[str, int],
    date: str,
    t: int,
    generated_at: str,
    discovered_from: list[str],
    unchecked: set[str] | None = None,
    notes: list[str] | None = None,
    day_key_source: str = "America/New_York",
    pool_details: dict[str, list[dict]] | None = None,
) -> dict:
    eq_vol, eq_mints, eq_pools, eq_with = lane_totals(rows, vols, pool_counts, "equity")
    etf_vol, etf_mints, etf_pools, _etf_with = lane_totals(rows, vols, pool_counts, "etf")
    pre_vol, pre_mints, pre_pools, _pre_with = lane_totals(rows, vols, pool_counts, "preipo")
    legs = [v for v in (eq_vol, etf_vol, pre_vol) if v is not None]
    missed = unchecked or set()
    return {
        "date": date,
        "t": t,
        "publicEquity24hUsd": eq_vol,
        "private24hUsd": pre_vol,
        "etfIndex24hUsd": etf_vol,
        "combined24hUsd": round(sum(legs), 2) if legs else None,
        "publicMintCount": eq_mints,
        "publicPoolCount": eq_pools,
        "etfMintCount": etf_mints,
        "etfPoolCount": etf_pools,
        "preipoMintCount": pre_mints,
        "preipoPoolCount": pre_pools,
        "withVolumeEquityCount": eq_with,
        "uncheckedMintCount": sum(1 for row in rows if row["address"].lower() in missed),
        "generatedAt": generated_at,
        "dayKeySource": day_key_source,
        "issuers": issuer_breakdown(rows, vols, pool_counts),
        "symbolsWithVolume": symbols_with_volume(rows, vols),
        "assets": assets_for(rows, vols, pool_details or {}),
        "notes": notes or [],
        "sources": {
            "universe": "All Base (chainId 8453) public equity, pre-IPO, and ETF issuers",
            "universeCoinbase": COINBASE_API,
            "universeDocs": BASE_DOCS,
            "universeStocksonchain": STOCKSONCHAIN,
            "universeOndo": ONDO_ADDRESSES,
            "universeDinari": DINARI_STOCKS,
            "universeSt0x": ST0X_BASE_LIST,
            "universeCentrifuge": CENTRIFUGE_DOCS,
            "universeXstocks": "https://api.xstocks.fi/api/v2/public/assets?network=Base",
            "universeBacked": BACKED_API,
            "universeAnchored": ANCHORED_DOCS,
            "universeDexScreenerSearch": DEX_SEARCH.format(q="ST0x"),
            "volume": "DexScreener tokens/v1/base volume.h24 unique-pool sum",
            "liquidity": (
                "DexScreener liquidity.usd per unique pool; displayedLiquidityUsd is the "
                "sum of reported pool liquidity. Missing liquidity.usd is null, not $0"
            ),
            "chainId": CHAIN_ID,
            "chainSlug": CHAIN_SLUG,
            "discoveredFrom": discovered_from,
        },
        "method": (
            "Desk totals are every Base issuer in equity, preipo, and etf; "
            "Ondo is included only when a Base address is confirmed; "
            "Dinari is in the universe when listed and a mint with no DexScreener pools stays null; "
            "Dinari commodity, treasury, bond, and credit products are omitted from the equity and ETF lanes; "
            "ST0x wrapped Base tokens are included (commodity and treasury products omitted); "
            "Centrifuge S&P 500 share tokens are included and credit/treasury tokens are not; "
            "Anchored aStocks on Base are included (commodity and treasury/bond funds omitted); "
            "ETF is classified before pre-IPO; "
            "Robinhood Chain excluded; SPCXc and other SpaceX shares stay preipo; "
            "missing DexScreener h24 stays null (not $0); "
            "missing liquidity.usd stays null and does not blank the day; "
            "no Gecko backfill; "
            "date is the America/New_York calendar day"
        ),
    }


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        print("snapshot:base self-test ok", flush=True)
        return 0

    out_dir = Path(os.environ.get("BASE_VOLUME_SNAPSHOT_DIR") or "").expanduser()
    if not out_dir.parts:
        out_dir = Path(__file__).resolve().parents[1] / "data" / "volume-snapshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "base.json"

    now = datetime.now(timezone.utc)
    override = snapshot_date_override()
    date, t = snapshot_day_key(now, override)
    source = "override" if override else "America/New_York"
    print(f"snapshot:base starting date={date} ({source})", flush=True)

    desk = load_universe()
    rows = desk.rows
    if not rows:
        print("snapshot:base failed: empty Base universe", file=sys.stderr)
        return 1

    issuer_counts: dict[str, int] = {}
    for row in rows:
        issuer_counts[row["issuer"]] = issuer_counts.get(row["issuer"], 0) + 1
    print(
        f"snapshot:base desk mints={len(rows)} issuers={issuer_counts} added={desk.added_by}",
        flush=True,
    )

    vols, pool_counts, pool_details, batches_ok, batches_fail, unchecked = hydrate_volumes(rows)
    if batches_ok == 0:
        print("snapshot:base failed: DexScreener returned no batches", file=sys.stderr)
        return 1

    record = build_record(
        rows,
        vols,
        pool_counts,
        date,
        t,
        now.isoformat().replace("+00:00", "Z"),
        desk.consulted,
        unchecked=unchecked,
        notes=desk.errors,
        day_key_source=source,
        pool_details=pool_details,
    )
    if not should_write(record):
        print(
            "snapshot:base failed: DexScreener 24h is all-null (null omitted, not $0) — snapshot not written.",
            file=sys.stderr,
        )
        return 1

    payload: dict[str, Any] = {"version": 1, "records": []}
    if out_file.exists():
        try:
            existing = json.loads(out_file.read_text())
            if isinstance(existing, dict) and isinstance(existing.get("records"), list):
                payload = existing
        except json.JSONDecodeError:
            payload = {"version": 1, "records": []}

    records = [r for r in payload["records"] if isinstance(r, dict) and r.get("date") != date]
    records.append(record)
    records.sort(key=lambda r: r.get("date") or "")
    payload = {"version": 1, "records": records}
    out_file.write_text(json.dumps(payload, indent=2) + "\n")

    def fmt(v: float | None) -> str:
        return "null" if v is None else f"{v:.2f}"

    print(
        f"snapshot:base wrote {date} combined={fmt(record['combined24hUsd'])} "
        f"equity={fmt(record['publicEquity24hUsd'])} etf={fmt(record['etfIndex24hUsd'])} "
        f"preipo={fmt(record['private24hUsd'])} "
        f"equityMints={record['publicMintCount']} etfMints={record['etfMintCount']} "
        f"preipoMints={record['preipoMintCount']} withVol={record['withVolumeEquityCount']} "
        f"unchecked={record['uncheckedMintCount']} "
        f"batchesOk={batches_ok} batchesFail={batches_fail} -> {out_file}",
        flush=True,
    )
    for issuer_row in record["issuers"]:
        print(
            "snapshot:base issuer "
            f"{issuer_row['issuer']} "
            f"equity={issuer_row['publicMintCount']}/{fmt(issuer_row['publicEquity24hUsd'])} "
            f"preipo={issuer_row['preipoMintCount']}/{fmt(issuer_row['private24hUsd'])} "
            f"etf={issuer_row['etfMintCount']}/{fmt(issuer_row['etfIndex24hUsd'])}",
            flush=True,
        )
    for kind in ("equity", "preipo", "etf"):
        print(f"snapshot:base tickers {kind} {','.join(symbols_for(rows, kind))}", flush=True)
    for hit in record["symbolsWithVolume"]:
        print(
            "snapshot:base volume "
            f"{hit['issuer']} {hit['symbol']} {hit['kind']} "
            f"{hit['address']} {fmt(hit['volume24hUsd'])}",
            flush=True,
        )
    if record["uncheckedMintCount"]:
        print(
            "snapshot:base INCOMPLETE — DexScreener missed some mints; "
            "those volumes stay null (not $0) and are omitted from the lane sum",
            flush=True,
        )
    return 0


def self_test() -> None:
    assert is_base_chain("base") and is_base_chain("8453") and is_base_chain("eip155:8453")
    assert not is_base_chain("base-sepolia")
    assert not is_base_chain("robinhood-chain")
    assert not is_base_chain("solana")
    assert issuer_excluded(issuer_slug("Robinhood"))
    assert classify_kind("private", "SPCX", "SpaceX") == "preipo"
    assert classify_kind("stock", "SPCXc", "SpaceX") == "preipo"
    assert classify_kind("etf", "ARM", "Arm Holdings plc American Depositary Shares") == "equity"
    assert classify_kind("etf", "ARKK", "ARK Innovation ETF") == "etf"
    assert classify_kind("etf", "ETN", "Eaton Corporation, plc Ordinary Shares") == "equity"
    assert classify_kind("stock", "ETN", "Eaton Corporation, plc Ordinary Shares") == "equity"
    assert classify_named("VXX", "iPath Series B S&P 500 VIX Short-Term Futures ETN") == "etf"
    assert classify_kind("stock", "VXX", "iPath Series B S&P 500 VIX Short-Term Futures ETN") == "etf"
    assert classify_kind("etf", "BXSL", "Blackstone Secured Lending Fund") == "equity"
    assert classify_kind("treasury", "OUSG", "Ondo Short-Term US Treasuries") is None
    assert classify_named("QQQon", "Invesco QQQ ETF") == "etf"
    assert classify_named("AAPLon", "Apple") == "equity"
    # ETF before private: a short SpaceX ETF is not the pre-IPO share.
    assert classify_kind("private", "SPCG", "Tradr 2X Short SpaceX Daily ETF") == "etf"
    assert classify_anchored("aSPCG", "Tradr 2X Short SpaceX Daily ETF aStock") == "etf"
    assert classify_anchored("aSPCX", "SpaceX aStock") == "preipo"
    assert classify_anchored("aETN", "Eaton aStock") == "equity"
    assert classify_anchored("aAAPL", "Apple aStock") == "equity"
    assert classify_anchored("aQQQ", "Invesco QQQ aStock") == "etf"
    assert classify_anchored("aGLD", "SPDR Gold Shares aStock") is None
    assert classify_anchored("aSDS", "ProShares UltraShort S&P500 aStock") == "etf"
    assert classify_backed("bERNA", "Backed ERNA $ Ultrashort Bond", "ERNA.L") is None
    assert classify_anchored("aSLV", "iShares Silver Trust aStock") is None
    assert classify_anchored("aBIL", "SPDR Bloomberg 1-3M T-Bill aStock") is None
    assert classify_anchored("aTLT", "iShares 20+ Year Treasury Bond aStock") is None
    assert classify_anchored("aUSO", "US Oil Fund aStock") is None
    assert classify_anchored("aGDX", "VanEck Gold Miners ETF aStock") == "etf"
    # ArcStocks uses the ticker ASTOCK. It is not an Anchored mint unless the docs list it.
    ANCHORED_OFFICIAL_BASE.add("0x17683e492d0c8910f7c0157d04af31cb7a23ad71")
    assert (
        _dex_search_row(
            {
                "symbol": "ASTOCK",
                "name": "ArcStocks",
                "address": "0x1aCc5F52aba25F5815f15661847b8Ce62e857777",
            }
        )
        is None
    )
    official_astock = _dex_search_row(
        {
            "symbol": "aAAPL",
            "name": "Apple aStock",
            "address": "0x17683e492d0C8910F7c0157D04af31Cb7A23Ad71",
        }
    )
    assert official_astock is not None and official_astock["issuer"] == "anchored" and official_astock["kind"] == "equity"
    ANCHORED_OFFICIAL_BASE.clear()
    DEX_LOOKALIKES.clear()
    anchored_html = """
    ### Tokenized stocks
    <table><tr><td>aAAPL</td><td>0x17683e492d0C8910F7c0157D04af31Cb7A23Ad71</td></tr>
    <tr><td>aSPCX</td><td>0x12473790e09D415ABAc7441401F7AbeC64Fa959C</td></tr></table>
    ### Tokenized funds
    <table><tr><td>aDHF</td><td>0x0ca21052CF746bCAC4807DbbE0A15269CC83EA3C</td></tr></table>
    """
    assert listings_from_anchored_docs(anchored_html) == [
        ("aAAPL", "0x17683e492d0C8910F7c0157D04af31Cb7A23Ad71"),
        ("aSPCX", "0x12473790e09D415ABAc7441401F7AbeC64Fa959C"),
    ]
    meme = _dex_search_row({"symbol": "SPIKE", "name": "Brian's Iguana", "address": "0x" + "11" * 20})
    assert meme is None
    # "Adshares" contains the letters dshare and is not a Dinari dShare.
    assert _dex_search_row({"symbol": "ADS", "name": "Adshares", "address": "0x" + "ab" * 20}) is None
    assert (
        _dex_search_row(
            {
                "symbol": "XSTOCKS",
                "name": "Tokenized Stocks",
                "address": "0xB20000000000000000000028EA0d130403923c01",
            }
        )
        is None
    )
    # Official API addresses count. A b200 vanity prefix that is not on that list does not.
    COINBASE_OFFICIAL_BASE.add("0xb200000000000000000000c2e324d24d7eecd1fb")
    assert (
        _dex_search_row(
            {
                "symbol": "TCS",
                "name": "Tokenized Coinbase Stocks",
                "address": "0xb2000000000000000000004F7a2547C64dC95F01",
            }
        )
        is None
    )
    apple = _dex_search_row(
        {
            "symbol": "AAPLc",
            "name": "Apple Inc.",
            "address": "0xb200000000000000000000C2e324d24d7eEcd1fb",
        }
    )
    assert apple is not None and apple["issuer"] == "coinbase" and apple["kind"] == "equity"
    COINBASE_OFFICIAL_BASE.clear()
    DEX_LOOKALIKES.clear()
    assert (
        _dex_search_row(
            {
                "symbol": "GLDX",
                "name": "Gold tokenized ETF (xStock)",
                "address": "0x" + "cd" * 20,
            }
        )
        is None
    )
    assert (
        _dex_search_row(
            {
                "symbol": "ondotokenizedstock",
                "name": "ondotokenizedstock",
                "address": "0x" + "ef" * 20,
            }
        )
        is None
    )
    dshare = _dex_search_row({"symbol": "TSLAd", "name": "Tesla dShare", "address": "0x" + "12" * 20})
    assert dshare is not None and dshare["issuer"] == "dinari" and dshare["kind"] == "equity"
    st0x_hit = _dex_search_row(
        {
            "symbol": "wtNVDA",
            "name": "Wrapped NVIDIA Corporation ST0x",
            "address": "0x" + "22" * 20,
        }
    )
    assert st0x_hit is not None and st0x_hit["issuer"] == "st0x" and st0x_hit["kind"] == "equity"
    # Protocol token, not a wrapped share. Search hits it because the name is "ST0x".
    assert (
        _dex_search_row(
            {
                "symbol": "ST0X",
                "name": "ST0x",
                "address": "0x209a8638afc752da46236286883e7706280d5222",
            }
        )
        is None
    )

    markdown = """
| Ticker | Contract address |
| AAPLc | `0xb200000000000000000000C2e324d24d7eEcd1fb` |
| SPCXc | `0xb2000000000000000000007b9fcbd005511aCBd5` |
| Onchain Registry | `0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD` |
"""
    docs_rows = tokens_from_docs_markdown(markdown)
    assert [row["symbol"] for row in docs_rows] == ["AAPLc", "SPCXc"]
    assert docs_rows[1]["kind"] == "preipo"

    chain_rows, chain_skipped = listings_from_stocksonchain(
        {
            "stocks": [
                {
                    "ticker": "AAPL",
                    "company": "Apple",
                    "kind": "stock",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "coinbase",
                            "address": "0x" + "aa" * 20,
                            "onchainSymbol": "AAPLc",
                        },
                        {
                            "chain": "robinhood-chain",
                            "issuer": "robinhood",
                            "address": "0x" + "bb" * 20,
                            "onchainSymbol": "AAPL",
                        },
                    ],
                },
                {
                    "ticker": "SPCX",
                    "company": "SpaceX",
                    "kind": "private",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "dinari",
                            "address": "0x" + "cc" * 20,
                            "onchainSymbol": "SPCX",
                        }
                    ],
                },
                {
                    "ticker": "ARKK",
                    "company": "ARK Innovation ETF",
                    "kind": "etf",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "dinari",
                            "address": "0x" + "dd" * 20,
                            "onchainSymbol": "ARKK",
                        }
                    ],
                },
                {
                    "ticker": "NEW",
                    "company": "Future Issuer Co",
                    "kind": "stock",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "future-issuer",
                            "address": "0x" + "ee" * 20,
                            "onchainSymbol": "NEW",
                        }
                    ],
                },
                {
                    "ticker": "OUSG",
                    "company": "Short-Term US Treasuries",
                    "kind": "treasury",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "ondo",
                            "address": "0x" + "ff" * 20,
                            "onchainSymbol": "OUSG",
                        }
                    ],
                },
            ]
        }
    )
    got = {(row["symbol"], row["kind"], row["issuer"]) for row in chain_rows}
    assert got == {
        ("AAPLc", "equity", "coinbase"),
        ("SPCX", "preipo", "dinari"),
        ("ARKK", "etf", "dinari"),
        ("NEW", "equity", "future-issuer"),
    }, got
    assert chain_skipped == []
    gld_rows, gld_skipped = listings_from_stocksonchain(
        {
            "stocks": [
                {
                    "ticker": "GLD",
                    "company": "SPDR Gold Trust",
                    "kind": "etf",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "dinari",
                            "address": "0x" + "ab" * 20,
                            "onchainSymbol": "GLD",
                        }
                    ],
                },
                {
                    "ticker": "SLV",
                    "company": "iShares Silver Trust",
                    "kind": "etf",
                    "listings": [
                        {
                            "chain": "base",
                            "issuer": "dinari",
                            "address": "0x" + "ac" * 20,
                            "onchainSymbol": "SLV",
                        }
                    ],
                },
            ]
        }
    )
    assert gld_rows == []
    assert set(gld_skipped) == {"GLD", "SLV"}
    assert is_fixed_income_or_commodity("USO", "United States Oil Fund, LP")
    assert is_fixed_income_or_commodity("JAAA", "Janus Henderson AAA CLO ETF")
    assert is_fixed_income_or_commodity("WEAT", "Teucrium Wheat Fund")
    assert not is_fixed_income_or_commodity("GDX", "VanEck Gold Miners ETF")
    assert not is_fixed_income_or_commodity("COPX", "Global X Copper Miners ETF")
    assert not is_fixed_income_or_commodity("CLX", "Clorox Company")

    ondo_rows = listings_from_ondo(
        [
            {
                "symbol": "AAPLon",
                "addresses": [
                    {"networkChainId": "ethereum-1", "address": "0x" + "11" * 20},
                    {"networkChainId": "base-8453", "address": "0x" + "22" * 20},
                ],
            },
            {
                "symbol": "QQQon",
                "addresses": [{"networkChainId": "base-8453", "address": "0x" + "33" * 20}],
            },
        ],
        [
            {"symbol": "AAPLon", "name": "Apple", "assetType": "equity"},
            {"symbol": "QQQon", "name": "Invesco QQQ ETF", "assetType": "etf"},
        ],
    )
    assert {(row["symbol"], row["kind"]) for row in ondo_rows} == {("AAPLon", "equity"), ("QQQon", "etf")}

    dinari_rows, cursor = listings_from_dinari_page(
        {
            "results": [
                {
                    "symbol": "TSLA",
                    "name": "Tesla",
                    "tokens": ["eip155:1:0x" + "44" * 20, "eip155:8453:0x" + "55" * 20],
                }
            ],
            "next": "cursor-2",
        }
    )
    assert cursor == "cursor-2"
    assert len(dinari_rows) == 1 and dinari_rows[0]["issuer"] == "dinari"
    assert dinari_rows[0]["address"].lower() == "0x" + "55" * 20

    desk = Universe()
    load_seed(desk)
    for row in chain_rows:
        if not issuer_excluded(row["issuer"]):
            desk.add(row, "stocksonchain")
    assert any(row["issuer"] == "dinari" and row["symbol"] == "SPCX" for row in desk.rows)
    assert any(row["issuer"] == "future-issuer" and row["symbol"] == "NEW" for row in desk.rows)
    assert not any(row["issuer"] == "robinhood" for row in desk.rows)

    vols = {row["address"].lower(): None for row in desk.rows}
    equity = next(row for row in desk.rows if row["symbol"] == "AAPLc")
    private = next(row for row in desk.rows if row["symbol"] == "SPCX" and row["issuer"] == "dinari")
    etf = next(row for row in desk.rows if row["symbol"] == "ARKK")
    future = next(row for row in desk.rows if row["symbol"] == "NEW")
    vols[equity["address"].lower()] = 10
    vols[private["address"].lower()] = 0
    vols[etf["address"].lower()] = 4
    vols[future["address"].lower()] = 3
    pools = {addr: 0 for addr in vols}
    record = build_record(desk.rows, vols, pools, "2026-09-24", 1, "2026-09-24T04:00:00Z", ["seed"])
    assert record["publicEquity24hUsd"] == 13
    assert record["private24hUsd"] == 0
    assert record["etfIndex24hUsd"] == 4
    assert record["combined24hUsd"] == 17
    assert {row["issuer"] for row in record["issuers"]} == {"coinbase", "dinari", "future-issuer"}
    assert any(hit["symbol"] == "NEW" and hit["volume24hUsd"] == 3 for hit in record["symbolsWithVolume"])
    assert any(hit["symbol"] == "SPCX" and hit["volume24hUsd"] == 0 for hit in record["symbolsWithVolume"])
    assert should_write(record)

    quiet_vols = {addr: None for addr in vols}
    quiet_vols[equity["address"].lower()] = 10
    quiet = build_record(desk.rows, quiet_vols, pools, "2026-09-24", 1, "t", ["seed"])
    assert quiet["publicEquity24hUsd"] == 10
    assert quiet["private24hUsd"] is None
    assert quiet["etfIndex24hUsd"] is None
    assert quiet["combined24hUsd"] == 10
    assert should_write(quiet)

    empty = build_record(desk.rows, {addr: None for addr in vols}, pools, "2026-09-24", 1, "t", [])
    assert empty["combined24hUsd"] is None
    assert should_write(empty) is False

    assert is_preipo_text("wtSPCX", "Wrapped Space Exploration Technologies Corp. ST0x")
    assert is_preipo_text("SPCXc", "Space Exploration Technologies Corp.")
    assert classify_named("BIRDc", "Smartbird, Inc.") == "equity"
    assert classify_named("wtSPYM", "Wrapped SPDR Portfolio S&P 500 ETF ST0x") == "etf"
    assert classify_named("wtVWO", "Wrapped Vanguard Emerging Markets Stock Index Fund ST0x") == "etf"
    assert classify_named("wtTQQQ", "Wrapped ProShares UltraPro QQQ ST0x") == "etf"
    assert is_fixed_income_or_commodity("wtIAU", "Wrapped iShares Gold Trust ST0x")
    assert is_fixed_income_or_commodity("wtSGOV", "Wrapped iShares 0-3 Month Treasury Bond ETF ST0x")
    assert is_fixed_income_or_commodity("bZPR1", "Backed $ ZPR1 1-3 Month T-Bill")
    assert is_fixed_income_or_commodity("bC3M", "Backed GOVIES 0-6 months EURO investment grade")
    assert is_fixed_income_or_commodity("bERNA", "Backed ERNA $ Ultrashort Bond")
    assert is_fixed_income_or_commodity("bCSBGC3", "Backed CSBGC3 CHF Swiss Domestic Government Bond 0-3yr")
    assert is_fixed_income_or_commodity("USOTF", "United Stated Oil Tokenized Fund")
    assert classify_backed("bNVDA", "Backed NVIDIA Corp", "NVDA") == "equity"
    assert classify_backed("bCSPX", "Backed CSPX Core S&P 500", "CSPX.L") == "etf"
    assert classify_backed("bZPR1", "Backed $ ZPR1 1-3 Month T-Bill", "ZPR1.DE") is None
    assert classify_backed("bIB01", "Backed IB01 $ Treasury Bond 0-1yr", "IB01.L") is None
    backed_rows, backed_skipped = listings_from_backed_api(
        {
            "nodes": [
                {
                    "symbol": "bGME",
                    "name": "Backed GameStop Corp",
                    "underlyingSymbol": "GME",
                    "deployments": [
                        {"network": "Ethereum", "address": "0x" + "11" * 20},
                        {"network": "Base", "address": "0x" + "72" * 20},
                    ],
                },
                {
                    "symbol": "bCSPX",
                    "name": "Backed CSPX Core S&P 500",
                    "underlyingSymbol": "CSPX.L",
                    "deployments": [{"network": "Base", "address": "0x" + "c3" * 20}],
                },
                {
                    "symbol": "bZPR1",
                    "name": "Backed $ ZPR1 1-3 Month T-Bill",
                    "underlyingSymbol": "ZPR1.DE",
                    "deployments": [{"network": "Base", "address": "0x" + "ad" * 20}],
                },
            ]
        }
    )
    assert {(row["symbol"], row["kind"]) for row in backed_rows} == {("bGME", "equity"), ("bCSPX", "etf")}
    assert backed_skipped == ["bZPR1"]
    assert ("0x" + "72" * 20) in BACKED_OFFICIAL_BASE
    lookalike = _dex_search_row(
        {
            "symbol": "bNVDA",
            "name": "Backed NVIDIA (bNVDA)",
            "address": "0x" + "6f" * 20,
        }
    )
    assert lookalike is None
    assert (
        _dex_search_row(
            {
                "symbol": "BACKED",
                "name": "BACKED",
                "address": "0x6572a3990794552A83D01Fa8579C391e64161E06",
            }
        )
        is None
    )
    # Official Ondo tickers use the on suffix. A Base "Ondo COIN" name is not the registry.
    assert (
        _dex_search_row(
            {
                "symbol": "COIN",
                "name": "Ondo COIN tokenized stock",
                "address": "0x" + "90" * 20,
            }
        )
        is None
    )
    # A *on name is not a Base Ondo mint until the address API lists it.
    assert (
        _dex_search_row(
            {
                "symbol": "TSLAon",
                "name": "Tesla Ondo Tokenized",
                "address": "0x" + "91" * 20,
            }
        )
        is None
    )
    assert (
        _dex_search_row(
            {
                "symbol": "NVDAON",
                "name": "NVDAon (Ondo -Tokenized)",
                "address": "0xD285fe867825F0c8347B9b1205506A710E99268B",
            }
        )
        is None
    )
    ONDO_OFFICIAL_BASE.add("0x" + "91" * 20)
    ondo_hit = _dex_search_row(
        {
            "symbol": "TSLAon",
            "name": "Tesla Ondo Tokenized",
            "address": "0x" + "91" * 20,
        }
    )
    assert ondo_hit is not None and ondo_hit["issuer"] == "ondo" and ondo_hit["kind"] == "equity"
    ONDO_OFFICIAL_BASE.discard("0x" + "91" * 20)
    assert (
        _dex_search_row(
            {
                "symbol": "SNAP",
                "name": "Snap Tokenized Stock (Robinhood)",
                "address": "0x" + "13" * 20,
            }
        )
        is None
    )
    # Missing liquidity does not blank a day that has reported h24. Reported 0 stays 0.
    liq_rows = [
        _row("AAPLc", "Apple", "0x" + "aa" * 20, "equity", "coinbase"),
        _row("QQQ", "Invesco QQQ ETF", "0x" + "bb" * 20, "etf", "st0x"),
    ]
    liq_vols = {"0x" + "aa" * 20: 12.5, "0x" + "bb" * 20: 0.0}
    liq_pools = {
        "0x" + "aa" * 20: [
            {
                "pairAddress": "0x" + "p1" * 10,
                "dexId": "uniswap",
                "volume24hUsd": 12.5,
                "liquidityUsd": None,
            }
        ],
        "0x" + "bb" * 20: [
            {
                "pairAddress": "0x" + "p2" * 10,
                "dexId": "aerodrome",
                "volume24hUsd": 0.0,
                "liquidityUsd": 0.0,
            }
        ],
    }
    liq_record = build_record(
        [row for row in liq_rows if row],
        liq_vols,
        {"0x" + "aa" * 20: 1, "0x" + "bb" * 20: 1},
        "2026-09-27",
        1790481600,
        "2026-09-28T04:00:00Z",
        ["seed"],
        pool_details=liq_pools,
    )
    assert liq_record["combined24hUsd"] == 12.5
    assert should_write(liq_record)
    by_sym = {asset["symbol"]: asset for asset in liq_record["assets"]}
    assert by_sym["AAPLc"]["displayedLiquidityUsd"] is None
    assert by_sym["AAPLc"]["volume24hUsd"] == 12.5
    assert by_sym["AAPLc"]["pools"][0]["liquidityUsd"] is None
    assert by_sym["QQQ"]["displayedLiquidityUsd"] == 0
    assert by_sym["QQQ"]["volume24hUsd"] == 0
    assert by_sym["QQQ"]["instrumentKind"] == "etf"
    assert centrifuge_equity_kind("deSPXA") == "etf"
    assert centrifuge_equity_kind("JTRSY") is None
    assert centrifuge_equity_kind("JAAA") is None
    assert centrifuge_equity_kind("ACRDX") is None

    st0x_rows, st0x_skipped = listings_from_st0x(
        {
            "tokens": [
                {
                    "chainId": 8453,
                    "address": "0x" + "ab" * 20,
                    "symbol": "wtNVDA",
                    "name": "Wrapped NVIDIA Corporation ST0x",
                },
                {
                    "chainId": 8453,
                    "address": "0x" + "ac" * 20,
                    "symbol": "wtSPCX",
                    "name": "Wrapped Space Exploration Technologies Corp. ST0x",
                },
                {
                    "chainId": 8453,
                    "address": "0x" + "ad" * 20,
                    "symbol": "wtIAU",
                    "name": "Wrapped iShares Gold Trust ST0x",
                },
                {
                    "chainId": 1,
                    "address": "0x" + "ae" * 20,
                    "symbol": "wtAAPL",
                    "name": "Wrapped Apple Inc. ST0x",
                },
            ]
        }
    )
    assert {(row["symbol"], row["kind"], row["issuer"]) for row in st0x_rows} == {
        ("wtNVDA", "equity", "st0x"),
        ("wtSPCX", "preipo", "st0x"),
    }
    assert st0x_skipped == ["wtIAU"]

    cfg_html = """
    <h2 id="tokens">Tokens</h2>
    <h4 id="jtrsy">JTRSY</h4>
    <table><tr><td>Base</td><td><code>0x1111111111111111111111111111111111111111</code></td></tr></table>
    <h4 id="spxa">SPXA\u200b</h4>
    <table><tr><td>Base</td><td><code>0x09b61343097c1f9b159a3ae7151298efd10f0db2</code></td></tr></table>
    <h2 id="vaults">Vaults</h2>
    <h4 id="spxa-vault">SPXA</h4>
    <table><tr><td>Base</td><td><code>0x2222222222222222222222222222222222222222</code></td></tr></table>
    """
    cfg_rows, cfg_unknown = listings_from_centrifuge_html(cfg_html)
    assert [(row["symbol"], row["address"].lower()) for row in cfg_rows] == [
        ("SPXA", "0x09b61343097c1f9b159a3ae7151298efd10f0db2")
    ]
    assert cfg_unknown == ["JTRSY"]

    xstock_rows = listings_from_xstocks_base(
        {
            "nodes": [
                {
                    "symbol": "NVDAx",
                    "name": "NVIDIA xStock",
                    "underlying": {"type": "Equity"},
                    "deployments": [
                        {"network": "Solana", "address": "mint"},
                        {"network": "Base", "address": "0x" + "bf" * 20},
                    ],
                }
            ],
            "page": {"hasNextPage": False},
        }
    )
    assert len(xstock_rows) == 1 and xstock_rows[0]["issuer"] == "backed"
    assert xstock_rows[0]["kind"] == "equity"

    # 03:59 UTC on 2026-09-25 is still 11:59 PM Eastern on 2026-09-24 (EDT).
    close, midnight = snapshot_day_key(datetime(2026, 9, 25, 3, 59, tzinfo=timezone.utc))
    assert close == "2026-09-24"
    assert midnight == int(datetime(2026, 9, 24, 4, 0, tzinfo=timezone.utc).timestamp())
    forced, forced_t = snapshot_day_key(datetime(2026, 9, 25, 4, 6, tzinfo=timezone.utc), "2026-09-24")
    assert forced == "2026-09-24"
    assert forced_t == midnight


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as e:  # noqa: BLE001
        print(f"snapshot:base failed: {e}", file=sys.stderr)
        raise SystemExit(1)
