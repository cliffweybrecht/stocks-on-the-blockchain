import type { PerpsTier, PerpsVolumeWindow } from "./perps-snapshot";

/**
 * Venue source catalog for the equity-perp writer.
 * perps-parse.ts reads these strings when it builds a snapshot row.
 * The methodology page renders the same list.
 */

export const PERPS_PRICE_BAND_MIN = 0.8;
export const PERPS_PRICE_BAND_MAX = 1.25;

export const COINGECKO_DERIVATIVES_SOURCE =
  "GET https://api.coingecko.com/api/v3/derivatives?include_tickers=unexpired";

export const HIP3_WINDOW_NOTE =
  "Rolling 24h notional (dayNtlVlm). Hourly candles are base size, not USD, so this is not an ET-day sum.";

export const HIP3_DEX_LIST_SOURCE = 'POST https://api.hyperliquid.xyz/info {"type":"perpDexs"}';

export function hip3DexSource(dex: string): string {
  return `POST https://api.hyperliquid.xyz/info {"type":"metaAndAssetCtxs","dex":"${dex}"}`;
}

/** CoinGecko market names that are never added as their own snapshot row. */
export const PERPS_COINGECKO_NAMED_SKIP: ReadonlySet<string> = new Set(["Hyperliquid (Futures)"]);

/**
 * CoinGecko markets that already have a direct book, or that are held out.
 * A row here is not added beside the direct fetch.
 */
export const DIRECT_CG_MARKETS: ReadonlySet<string> = new Set([
  "Hyperliquid (Futures)",
  "Bitget Futures",
  "OKX (Futures)",
  "Gate (Futures)",
  "MEXC (Futures)",
  "Aster (Futures)",
  "Lighter",
  "Robinhood Chain Lighter (Futures)",
  "Ondo Perps",
  "Extended",
  "Variational Omni",
  "KuCoin Futures",
  "Kraken (Futures)",
  "BingX (Futures)",
  "dYdX Chain",
  "Gate DEX",
  "Toobit Futures",
  "XT.COM (Derivatives)",
  "Bitunix Futures",
  "LBank (Futures)",
  "WhiteBIT (Futures)",
  "Phemex (Futures)",
  "BTSE (Futures)",
  "Deribit (Futures)",
  "HTX (Futures)",
  "Crypto.com (Futures)",
  "GRVT",
  "ApeX Omni",
  "Nado",
  "Pacifica",
  "Orderly",
  "Paradex",
  "WEEX (Futures)",
]);

/** Direct venues whose CoinGecko open interest fills a blank, without a second volume row. */
export const CG_OI_MARKETS: Readonly<Record<string, string>> = {
  Aster: "Aster (Futures)",
  BingX: "BingX (Futures)",
  "XT.COM": "XT.COM (Derivatives)",
  Bitunix: "Bitunix Futures",
  Toobit: "Toobit Futures",
  LBank: "LBank (Futures)",
};

export interface PerpsCgSpec {
  market: string;
  venue: string;
  tier: PerpsTier;
  note: string;
}

export const CG_SPECS: readonly PerpsCgSpec[] = [
  { market: "Binance (Futures)", venue: "Binance", tier: "cex-coingecko", note: "Binance blocks this host. CoinGecko rolling 24h is the headline. The www.binance.com route is not used. A prior-UTC-day archive cross-check is stored beside the row and is not the headline." },
  { market: "Bybit (Futures)", venue: "Bybit", tier: "cex-coingecko", note: "Bybit blocks this host. CoinGecko rolling 24h is the headline. A prior-UTC-day public trade-archive cross-check is stored beside the row and is not the headline." },
  { market: "Tapbit (Futures)", venue: "Tapbit", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "CoinW (Futures)", venue: "CoinW", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "Ourbit (Futures)", venue: "Ourbit", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "OrangeX Futures", venue: "OrangeX", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "BitKan (Futures)", venue: "BitKan", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "AlphaX (Futures)", venue: "AlphaX", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "Zoomex (Futures)", venue: "Zoomex", tier: "long-tail", note: "CoinGecko only, unverified. Opt-in long-tail. Not in the default headline." },
  { market: "Arcus (Futures)", venue: "Arcus", tier: "onchain", note: "No public market API found. CoinGecko row for this onchain book." },
  { market: "QFEX", venue: "QFEX", tier: "onchain", note: "Direct market data needs auth. CoinGecko row for this hybrid book." },
  { market: "RISEx", venue: "RISEx", tier: "onchain", note: "No public market API found. CoinGecko row." },
  { market: "edgeX", venue: "edgeX", tier: "onchain", note: "Direct API was blocked. CoinGecko row." },
  { market: "Polymarket Perps", venue: "Polymarket Perps", tier: "onchain", note: "No public perps REST endpoint. CoinGecko row." },
  { market: "Decibel", venue: "Decibel", tier: "onchain", note: "Aptos gateway needs an API key. CoinGecko row." },
  { market: "Deepcoin (Derivatives)", venue: "Deepcoin", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "BVOX (Futures)", venue: "BVOX", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "KCEX (Futures)", venue: "KCEX", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "Hotcoin (Futures)", venue: "Hotcoin", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "Bitrue (Futures)", venue: "Bitrue", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "BYDFi (Futures)", venue: "BYDFi", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "BigONE Futures", venue: "BigONE", tier: "long-tail", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "Dipcoin (Futures)", venue: "Dipcoin", tier: "onchain", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "GMX Perpetuals V2 (Solana)", venue: "GMX V2 (Solana)", tier: "onchain", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
  { market: "TurboFlow", venue: "TurboFlow", tier: "onchain", note: "CoinGecko only. Kept out of the headline when the volume/OI screen fails." },
];

export interface PerpsDirectSpec {
  venue: string;
  tier: PerpsTier;
  volumeWindow: PerpsVolumeWindow;
  source: string;
  note: string;
}

export const PERPS_DIRECT_SPECS: readonly PerpsDirectSpec[] = [
  {
    venue: "Hyperliquid HIP-3",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: 'POST https://api.hyperliquid.xyz/info {"type":"metaAndAssetCtxs","dex":"<builder dex>"}',
    note: HIP3_WINDOW_NOTE,
  },
  {
    venue: "Bitget",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES (+ /contracts isRwa=YES)",
    note: "Rolling 24h USDT volume. Equity flag is Bitget isRwa=YES.",
  },
  {
    venue: "OKX",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source:
      "GET https://www.okx.com/api/v5/market/tickers?instType=SWAP (volCcy24h × last) + /public/instruments instCategory=3 + /public/open-interest",
    note: "Rolling 24h (volCcy24h × last). Equity flag is instCategory=3.",
  },
  {
    venue: "Gate",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.gateio.ws/api/v4/futures/usdt/tickers (+ /contracts contract_type)",
    note: "Rolling 24h quote volume. Equity flag is contract_type stocks or indices.",
  },
  {
    venue: "MEXC",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://contract.mexc.com/api/v1/contract/ticker (+ /contract/detail conceptPlate Stock)",
    note: "Rolling 24h. Equity flag is conceptPlate Stock. Zero-fee / points venue.",
  },
  {
    venue: "Aster",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://fapi.asterdex.com/fapi/v1/ticker/24hr (+ exchangeInfo underlyingSubType STOCK)",
    note: "Rolling 24h quote volume. Equity flag is underlyingSubType STOCK. Open interest is not on this endpoint.",
  },
  {
    venue: "KuCoin",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api-futures.kucoin.com/api/v1/contracts/active (assetClass=STOCK)",
    note: "Rolling 24h turnover. Equity flag is assetClass=STOCK.",
  },
  {
    venue: "Extended",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://api.starknet.extended.exchange/api/v1/info/markets (category RWA, subCategory Equity|ETF/Index)",
    note: "Rolling 24h (dailyVolume). Equity flag is RWA Equity or ETF/Index. Pre-IPO is excluded.",
  },
  {
    venue: "Lighter",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails",
    note: "Rolling 24h (daily_quote_token_volume). No asset-class flag; ticker plus price band. Zero-fee / points venue.",
  },
  {
    venue: "Lighter on Robinhood Chain",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://api.rh.lighter.xyz/api/v1/orderBookDetails",
    note: "Rolling 24h (daily_quote_token_volume). No asset-class flag; ticker plus price band. Zero-fee / points venue.",
  },
  {
    venue: "Ondo Perps",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://api.ondoperps.xyz/v1/perps/contracts",
    note: "Rolling 24h usdVolume. No asset-class flag; ticker plus price band.",
  },
  {
    venue: "Variational Omni",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats",
    note: "Rolling 24h. No asset-class flag; ticker plus price band. US500 is the SPY product. Zero-fee / points venue.",
  },
  {
    venue: "Kraken Futures",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://futures.kraken.com/derivatives/api/v3/tickers",
    note: "Rolling 24h (volumeQuote). No equity flag; ticker plus price band.",
  },
  {
    venue: "BingX",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://open-api.bingx.com/openApi/swap/v2/quote/ticker (NCSK*/NCSI* symbols)",
    note: "Rolling 24h. Equity symbols use the NCSK (stock) or NCSI (index) prefix. Open interest is not on this endpoint.",
  },
  {
    venue: "Toobit",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.toobit.com/quote/v1/contract/ticker/24hr",
    note: "Rolling 24h quote volume (qv) on *-SWAP-USDT. No equity tag; ticker plus price band. The ticker op field is not open interest.",
  },
  {
    venue: "XT.COM",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source:
      "GET https://fapi.xt.com/future/market/v1/public/q/tickers (v = quote vol) + /future/market/v3/public/symbol/list (labels STOCK/INDEX)",
    note: "Rolling 24h. Equity flag is label STOCK or INDEX. Open interest is not on this ticker.",
  },
  {
    venue: "Bitunix",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://fapi.bitunix.com/api/v1/futures/market/tickers",
    note: "Rolling 24h quoteVol. No equity tag; ticker plus price band. Open interest is not on this ticker.",
  },
  {
    venue: "WhiteBIT",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://whitebit.com/api/v4/public/futures",
    note: "Rolling 24h money_volume. No equity tag; ticker plus price band. Open interest is open_interest × index price.",
  },
  {
    venue: "Phemex",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.phemex.com/md/v3/ticker/24hr/all (turnoverRv) + /public/products-plus perpProductsV2 (TradFi/PreMarket)",
    note: "Rolling 24h. Equity flag is perpProductSubType TradFi or PreMarket. Commodities drop in classification. PreMarket is pre-IPO and stays out of the headline.",
  },
  {
    venue: "BTSE",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.btse.com/futures/api/v2.1/market_summary",
    note: "Rolling 24h. *PFC symbols, ticker plus price band. volume and openInterestUSD are USD.",
  },
  {
    venue: "Deribit",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=USDC&kind=future",
    note: "Rolling 24h volume_usd on *_USDC-PERPETUAL. Ticker plus price band. Open interest is contracts × mark.",
  },
  {
    venue: "HTX",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source:
      "GET https://api.hbdm.com/linear-swap-ex/market/detail/batch_merged?business_type=swap + /linear-swap-api/v1/swap_contract_info (tradfi_labels) + /swap_open_interest",
    note: "Rolling 24h trade_turnover. Equity flag is tradfi_labels Stocks or Indices. Open interest is the value field.",
  },
  {
    venue: "Crypto.com",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.crypto.com/exchange/v1/public/get-tickers",
    note: "Rolling 24h vv on *USD-PERP. No equity tag; ticker plus price band. Open interest is oi × mark.",
  },
  {
    venue: "LBank",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://lbkperp.lbank.com/cfd/openApi/v1/pub/marketData?productGroup=SwapU",
    note: "Rolling 24h turnover. No equity tag; ticker plus price band. Recorded even when the volume/OI screen excludes it.",
  },
  {
    venue: "GRVT",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "POST https://market-data.grvt.io/full/v1/all_instruments (asset_class EQUITY) + POST /full/v1/ticker per instrument",
    note: "Rolling 24h buy_volume_24h_q + sell_volume_24h_q. Equity flag is asset_class EQUITY. Open interest is base × mark.",
  },
  {
    venue: "ApeX Omni",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://omni.apex.exchange/api/v3/symbols (contractConfig.stockContract) + /api/v3/ticker?symbol=",
    note: "Rolling 24h turnover24h. Equity flag is the stockContract list. Open interest is openInterest × mark.",
  },
  {
    venue: "Nado",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://archive.prod.nado.xyz/v2/contracts",
    note: "Rolling 24h quote_volume. No equity tag; ticker plus price band. open_interest_usd is USD.",
  },
  {
    venue: "Pacifica",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://api.pacifica.fi/api/v1/info/prices",
    note: "Rolling 24h volume_24h in USD. No equity tag; ticker plus price band. Open interest is base × mark.",
  },
  {
    venue: "Orderly",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://api.orderly.org/v1/public/futures",
    note: "Rolling 24h 24h_amount. One shared book. Broker frontends are not added. Ticker plus price band.",
  },
  {
    venue: "Paradex",
    tier: "onchain",
    volumeWindow: "rolling-24h",
    source: "GET https://api.prod.paradex.trade/v1/markets/summary?market=ALL",
    note: "Rolling 24h volume_24h on *-USD-PERP. Ticker plus price band. Counted once, not per frontend.",
  },
  {
    venue: "Ostium",
    tier: "onchain",
    volumeWindow: "lifetime",
    source: "GET https://builder.prod.bedrock.ostium.io/v1/pairs?chainId=42161&first=1000 (volumeInUsd is cumulative)",
    note: "No 24h field. lifetimeVolumeUsd is cumulative volumeInUsd. Daily volume is the difference between consecutive Eastern snapshots.",
  },
  {
    venue: "Avantis",
    tier: "onchain",
    volumeWindow: "unavailable",
    source: "GET https://socket-api-pub.avantisfi.com/socket-api/v1/data",
    note: "No public 24h volume. Open interest is the equities group (groupIndex 6). Volume stays blank.",
  },
  {
    venue: "WEEX",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source:
      "GET https://api-contract.weex.com/capi/v3/market/ticker/24hr (+ /market/exchangeInfo, /market/openInterest?symbol=)",
    note: "Rolling 24h quoteVolume, kept when quoteVolume / volume is a price inside that bar. Otherwise volume × mark. Open interest is base size × mark. Equity flag is underlyingType Stocks, Indices, or Pre-IPO. The CoinGecko WEEX row is not added.",
  },
  {
    venue: "Coinbase International",
    tier: "cex-direct",
    volumeWindow: "rolling-24h",
    source: "GET https://api.international.coinbase.com/api/v1/instruments",
    note: "Paused equity, equity-ETF, and pre-IPO instruments are stored at $0 24h notional. They are not omitted. USD open interest stays blank because this feed's open interest is base size.",
  },
];

export interface PerpsHeldOut {
  venue: string;
  cgMarket: string;
  reason: string;
}

/** Venues on the place map that this writer still refuses to snapshot. Empty while WEEX and Coinbase International are fetched. */
export const PERPS_HELD_OUT: readonly PerpsHeldOut[] = [];

/** CoinGecko market name for a direct book. Used so the skip list is not described as unfetched. */
export const PERPS_DIRECT_CG_MARKET: Readonly<Record<string, string>> = {
  "Hyperliquid HIP-3": "Hyperliquid (Futures)",
  Bitget: "Bitget Futures",
  OKX: "OKX (Futures)",
  Gate: "Gate (Futures)",
  MEXC: "MEXC (Futures)",
  Aster: "Aster (Futures)",
  Lighter: "Lighter",
  "Lighter on Robinhood Chain": "Robinhood Chain Lighter (Futures)",
  "Ondo Perps": "Ondo Perps",
  Extended: "Extended",
  "Variational Omni": "Variational Omni",
  KuCoin: "KuCoin Futures",
  "Kraken Futures": "Kraken (Futures)",
  BingX: "BingX (Futures)",
  Toobit: "Toobit Futures",
  "XT.COM": "XT.COM (Derivatives)",
  Bitunix: "Bitunix Futures",
  LBank: "LBank (Futures)",
  WhiteBIT: "WhiteBIT (Futures)",
  Phemex: "Phemex (Futures)",
  BTSE: "BTSE (Futures)",
  Deribit: "Deribit (Futures)",
  HTX: "HTX (Futures)",
  "Crypto.com": "Crypto.com (Futures)",
  GRVT: "GRVT",
  "ApeX Omni": "ApeX Omni",
  Nado: "Nado",
  Pacifica: "Pacifica",
  Orderly: "Orderly",
  Paradex: "Paradex",
  WEEX: "WEEX (Futures)",
};

/** CoinGecko markets on the skip list that this writer does not fetch another way. */
export function coingeckoMarketsNotFetched(): string[] {
  const covered = new Set<string>([
    ...PERPS_COINGECKO_NAMED_SKIP,
    ...PERPS_HELD_OUT.map((row) => row.cgMarket),
    ...Object.values(PERPS_DIRECT_CG_MARKET),
    ...Object.values(CG_OI_MARKETS),
    ...CG_SPECS.map((spec) => spec.market),
  ]);
  return [...DIRECT_CG_MARKETS].filter((market) => !covered.has(market)).sort((a, b) => a.localeCompare(b));
}

const DIRECT_BY_VENUE = new Map(PERPS_DIRECT_SPECS.map((spec) => [spec.venue, spec]));

export function perpsDirectSpec(venue: string): PerpsDirectSpec {
  const spec = DIRECT_BY_VENUE.get(venue);
  if (!spec) throw new Error(`No equity-perp source spec for ${venue}.`);
  return spec;
}

export type PerpsFeedKind = "Direct API" | "CoinGecko";

export function perpsFeedKind(source: string): PerpsFeedKind {
  return /api\.coingecko\.com/i.test(source) ? "CoinGecko" : "Direct API";
}

export function coingeckoVenueSource(market: string): string {
  return `${COINGECKO_DERIVATIVES_SOURCE} (market=${market})`;
}

export interface PerpsCatalogRow {
  venue: string;
  tier: PerpsTier | null;
  feed: PerpsFeedKind | "Held out";
  volumeWindow: PerpsVolumeWindow | null;
  source: string;
  note: string;
  /** Direct venues whose blank open interest is filled from CoinGecko. */
  oiFromCoinGecko: boolean;
}

export function listPerpsSourceCatalog(): PerpsCatalogRow[] {
  const direct: PerpsCatalogRow[] = PERPS_DIRECT_SPECS.map((spec) => ({
    venue: spec.venue,
    tier: spec.tier,
    feed: "Direct API",
    volumeWindow: spec.volumeWindow,
    source: spec.source,
    note: spec.note,
    oiFromCoinGecko: spec.venue in CG_OI_MARKETS,
  }));
  const coingecko: PerpsCatalogRow[] = CG_SPECS.map((spec) => ({
    venue: spec.venue,
    tier: spec.tier,
    feed: "CoinGecko",
    volumeWindow: "rolling-24h",
    source: coingeckoVenueSource(spec.market),
    note: spec.note,
    oiFromCoinGecko: false,
  }));
  const held: PerpsCatalogRow[] = PERPS_HELD_OUT.map((row) => ({
    venue: row.venue,
    tier: null,
    feed: "Held out",
    volumeWindow: null,
    source: "Not fetched",
    note: row.reason,
    oiFromCoinGecko: false,
  }));
  const tierOrder: Record<string, number> = { onchain: 0, "cex-coingecko": 1, "cex-direct": 2, "long-tail": 3 };
  return [...direct, ...coingecko, ...held].sort((a, b) => {
    const ta = a.tier ? tierOrder[a.tier] ?? 9 : 9;
    const tb = b.tier ? tierOrder[b.tier] ?? 9 : 9;
    if (ta !== tb) return ta - tb;
    return a.venue.localeCompare(b.venue);
  });
}

/** Snapshot clock. The Eastern day key is still that America/New_York date. */
export const PERPS_SNAPSHOT_CLOCK = "11:59 PM America/New_York";

/** Official USD-M daily dumps. Not a geo-block workaround. */
export const PERPS_BINANCE_ARCHIVE_SOURCE =
  "https://data.binance.vision/data/futures/um/daily/klines/<SYM>/1d/<SYM>-1d-YYYY-MM-DD.zip and https://data.binance.vision/data/futures/um/daily/metrics/<SYM>/<SYM>-metrics-YYYY-MM-DD.zip";

/** Official public trade dumps. Sum of size × price. api.bybit.com is not used. */
export const PERPS_BYBIT_ARCHIVE_SOURCE = "https://public.bybit.com/trading/<SYM>/<SYM>YYYY-MM-DD.csv.gz";
