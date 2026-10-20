/**
 * Static "where it runs" reference for equity perps.
 * Captured from the Oct 8 2026 venue map. Oracle notes that were not
 * confirmed in venue docs stay marked unverified. This is not snapshot data.
 */

export interface PerpPlace {
  venue: string;
  chain: string;
  operator: string;
  jurisdiction: string;
  oracle: string;
  /** Set for venues that belong on the onchain-by-chain chart. */
  onchainChain?: string;
}

export interface Hip3Builder {
  dex: string;
  name: string;
  deployer: string;
  live: boolean;
}

export const HIP3_BUILDERS: readonly Hip3Builder[] = [
  { dex: "xyz", name: "XYZ (trade[XYZ])", deployer: "0x88806a71d74ad0a510b350545c9ae490912f0888", live: true },
  { dex: "io", name: "EntropyIO", deployer: "0x320c8988e3d1b5198f335802d7bfd2728a8fcac6", live: true },
  { dex: "para", name: "Paragon", deployer: "0x8888888c43cbb7e1c4132542e46831bffd866ed3", live: true },
  { dex: "mkts", name: "Markets by Kinetiq", deployer: "0x71f0019cc7fa79e4f42587fb7b9a817d8d2429ec", live: true },
  { dex: "flx", name: "Felix Exchange", deployer: "0x2fab5525…6352", live: false },
  { dex: "vntl", name: "Ventuals", deployer: "0x88888881…beda", live: false },
  { dex: "cash", name: "dreamcash", deployer: "0xffa8198c…ef7", live: false },
  { dex: "km", name: "Kinetiq (old)", deployer: "0x71f0019c…29ec", live: false },
  { dex: "hyna", name: "HyENA", deployer: "0x53e65510…0637", live: false },
  { dex: "abcd", name: "ABCDEx", deployer: "0x372c7f69…857c", live: false },
];

/** Snapshot venue name → place row. HIP-3 dexes share the Hyperliquid L1 row. */
const SNAPSHOT_PLACE: Record<string, PerpPlace> = {};

export const PERP_PLACES: readonly PerpPlace[] = [
  {
    venue: "Binance",
    chain: "Centralized exchange (USD-M futures)",
    operator: "Binance",
    jurisdiction: "CG: Cayman Islands",
    oracle: "Binance index (TradFi components unverified)",
  },
  {
    venue: "Bybit",
    chain: "Centralized exchange",
    operator: "Bybit",
    jurisdiction: "CG: Seychelles (Dubai HQ commonly reported; unverified)",
    oracle: "Bybit index (unverified)",
  },
  {
    venue: "OKX",
    chain: "Centralized exchange (instCategory=3)",
    operator: "OKX",
    jurisdiction: "CG: United States (global entity Seychelles, unverified)",
    oracle: "OKX index (unverified)",
  },
  {
    venue: "Bitget",
    chain: "Centralized exchange (isRwa=YES)",
    operator: "Bitget",
    jurisdiction: "CG: Seychelles",
    oracle: "Bitget index (unverified)",
  },
  {
    venue: "MEXC",
    chain: "Centralized exchange (conceptPlate Stock)",
    operator: "MEXC",
    jurisdiction: "CG: Seychelles",
    oracle: "MEXC fair/index price (unverified)",
  },
  {
    venue: "Gate",
    chain: "Centralized exchange (contract_type stocks/indices)",
    operator: "Gate",
    jurisdiction: "CG: Panama",
    oracle: "Gate index (unverified)",
  },
  {
    venue: "BingX",
    chain: "Centralized exchange (NCSK/NCSI symbols)",
    operator: "BingX",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "BingX index (unverified)",
  },
  {
    venue: "KuCoin",
    chain: "Centralized exchange (assetClass STOCK)",
    operator: "KuCoin",
    jurisdiction: "CG: Seychelles",
    oracle: "KuCoin index (unverified)",
  },
  {
    venue: "Kraken Futures",
    chain: "Centralized exchange",
    operator: "Kraken (Payward)",
    jurisdiction: "CG: United States",
    oracle: "Kraken index (unverified)",
  },
  {
    venue: "Toobit",
    chain: "Centralized exchange",
    operator: "Toobit",
    jurisdiction: "CG: Cayman Islands",
    oracle: "unverified",
  },
  {
    venue: "XT.COM",
    chain: "Centralized exchange (labels STOCK/INDEX)",
    operator: "XT.COM",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
  },
  {
    venue: "Bitunix",
    chain: "Centralized exchange",
    operator: "Bitunix",
    jurisdiction: "CG: Saint Vincent and the Grenadines",
    oracle: "unverified",
  },
  {
    venue: "WhiteBIT",
    chain: "Centralized exchange",
    operator: "WhiteBIT",
    jurisdiction: "CG: Lithuania",
    oracle: "WhiteBIT index (stock price future contract)",
  },
  {
    venue: "Phemex",
    chain: "Centralized exchange (perpProductSubType TradFi)",
    operator: "Phemex",
    jurisdiction: "CG: Samoa",
    oracle: "Phemex .XXXUSDT index (components unverified)",
  },
  {
    venue: "BTSE",
    chain: "Centralized exchange (*PFC symbols)",
    operator: "BTSE",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
  },
  {
    venue: "Deribit",
    chain: "Centralized exchange (USDC linear perps)",
    operator: "Deribit (Coinbase-owned; unverified)",
    jurisdiction: "CG: Netherlands",
    oracle: "Deribit index (unverified)",
  },
  {
    venue: "HTX",
    chain: "Centralized exchange (tradfi_labels Stocks/Indices)",
    operator: "HTX",
    jurisdiction: "CG: Seychelles",
    oracle: "HTX index (unverified)",
  },
  {
    venue: "Crypto.com",
    chain: "Centralized exchange",
    operator: "Crypto.com",
    jurisdiction: "CG: Singapore",
    oracle: "unverified",
  },
  {
    venue: "LBank",
    chain: "Centralized exchange",
    operator: "LBank",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
  },
  {
    venue: "Tapbit",
    chain: "Centralized exchange",
    operator: "Tapbit",
    jurisdiction: "CG: United States",
    oracle: "unverified",
  },
  {
    venue: "CoinW",
    chain: "Centralized exchange",
    operator: "CoinW",
    jurisdiction: "CG: none listed",
    oracle: "unverified",
  },
  {
    venue: "Ourbit",
    chain: "Centralized exchange",
    operator: "Ourbit",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
  },
  {
    venue: "OrangeX",
    chain: "Centralized exchange",
    operator: "OrangeX",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
  },
  {
    venue: "BitKan",
    chain: "Centralized exchange",
    operator: "BitKan",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
  },
  {
    venue: "AlphaX",
    chain: "Centralized exchange",
    operator: "AlphaX",
    jurisdiction: "CG: Australia",
    oracle: "unverified",
  },
  {
    venue: "Zoomex",
    chain: "Centralized exchange",
    operator: "Zoomex",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
  },
  {
    venue: "Deepcoin",
    chain: "Centralized exchange",
    operator: "Deepcoin",
    jurisdiction: "CG: Singapore",
    oracle: "unverified",
  },
  {
    venue: "BVOX",
    chain: "Centralized exchange",
    operator: "BVOX",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
  },
  {
    venue: "KCEX",
    chain: "Centralized exchange",
    operator: "KCEX",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
  },
  {
    venue: "Hotcoin",
    chain: "Centralized exchange",
    operator: "Hotcoin",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
  },
  {
    venue: "Bitrue",
    chain: "Centralized exchange",
    operator: "Bitrue",
    jurisdiction: "CG: Costa Rica",
    oracle: "unverified",
  },
  {
    venue: "BYDFi",
    chain: "Centralized exchange",
    operator: "BYDFi",
    jurisdiction: "CG: Singapore",
    oracle: "unverified",
  },
  {
    venue: "BigONE",
    chain: "Centralized exchange",
    operator: "BigONE",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
  },
  {
    venue: "Hyperliquid HIP-3",
    chain: "Hyperliquid L1 (HyperCore). Count each builder dex once, not the frontend.",
    operator: "HIP-3 deployers (trade[XYZ], EntropyIO, Paragon, Kinetiq, and delisted books)",
    jurisdiction: "Hyperliquid: CG Cayman Islands; deployer entities unverified",
    oracle: "Per deployer. trade[XYZ]: external venues plus EWMA when the book is closed (docs.trade.xyz).",
    onchainChain: "Hyperliquid L1",
  },
  {
    venue: "Variational Omni",
    chain: "Arbitrum (RFQ; OLP is the sole counterparty)",
    operator: "Variational",
    jurisdiction: "CG: Panama",
    oracle: "Variational Oracle; equity index fixed off-hours (docs.variational.io)",
    onchainChain: "Arbitrum",
  },
  {
    venue: "Lighter on Robinhood Chain",
    chain: "Robinhood Chain (separate Lighter books, USDG collateral)",
    operator: "Lighter (on Robinhood Chain)",
    jurisdiction: "CG: United States",
    oracle: "Unverified for perps; Robinhood Chain stock tokens use Chainlink",
    onchainChain: "Robinhood Chain",
  },
  {
    venue: "Aster",
    chain: "Aster (BNB Chain origin; USD1-settled RWA perps)",
    operator: "Aster",
    jurisdiction: "CG: Seychelles",
    oracle: "Median of external exchange feeds across validators (unverified primary)",
    onchainChain: "Aster",
  },
  {
    venue: "Lighter",
    chain: "Lighter ZK rollup on Ethereum",
    operator: "Lighter",
    jurisdiction: "CG: none listed",
    oracle: "Chainlink Data Streams for RWA/equities, plus Stork/Pyth inputs",
    onchainChain: "Lighter",
  },
  {
    venue: "Ondo Perps",
    chain: "Hybrid exchange (Ondo); settlement chain unverified",
    operator: "Ondo Finance",
    jurisdiction: "CG: Panama",
    oracle: "Pyth, Stork, and institutional feeds; internal oracle on weekends (docs.ondoperps.xyz)",
    onchainChain: "Ondo",
  },
  {
    venue: "Extended",
    chain: "Starknet",
    operator: "Extended",
    jurisdiction: "CG: none listed",
    oracle: "Stork (NYSE/Nasdaq mid in hours, Blue Ocean ATS overnight)",
    onchainChain: "Starknet",
  },
  {
    venue: "Ostium",
    chain: "Arbitrum (pool-based)",
    operator: "Ostium Labs",
    jurisdiction: "unverified",
    oracle: "Ostium pull RWA oracle on Stork; Chainlink Data Streams for crypto",
    onchainChain: "Arbitrum",
  },
  {
    venue: "Veranta",
    chain: "Base (pool-based). Renamed from Avantis on 2026-09-14.",
    operator: "Veranta",
    jurisdiction: "unverified",
    oracle: "Pyth",
    onchainChain: "Base",
  },
  {
    venue: "GRVT",
    chain: "GRVT L2 (ZKsync-based validium; unverified)",
    operator: "GRVT",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
    onchainChain: "GRVT",
  },
  {
    venue: "ApeX Omni",
    chain: "ApeX Omni (zk L2 / omnichain; unverified)",
    operator: "ApeX",
    jurisdiction: "CG: Saint Vincent and the Grenadines",
    oracle: "unverified",
    onchainChain: "ApeX",
  },
  {
    venue: "Nado",
    chain: "Ink (Kraken-incubated OP Stack L2)",
    operator: "Nado",
    jurisdiction: "CG: Panama",
    oracle: "unverified",
    onchainChain: "Ink",
  },
  {
    venue: "Pacifica",
    chain: "Solana (off-chain matching; unverified)",
    operator: "Pacifica",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "API oracle field; source unverified",
    onchainChain: "Solana",
  },
  {
    venue: "Orderly",
    chain: "Orderly L2 (OP Stack). One shared book; broker frontends are not counted again.",
    operator: "Orderly Network",
    jurisdiction: "CG: Bahamas",
    oracle: "unverified",
    onchainChain: "Orderly",
  },
  {
    venue: "Paradex",
    chain: "Paradex appchain on the Starknet stack",
    operator: "Paradex",
    jurisdiction: "CG: Singapore",
    oracle: "price_feed_id empty for equities; source unverified",
    onchainChain: "Paradex",
  },
  {
    venue: "Arcus",
    chain: "Robinhood Chain (perps in beta/waitlist per Arcus docs)",
    operator: "Arcus",
    jurisdiction: "CG: Cayman Islands",
    oracle: "unverified",
    onchainChain: "Robinhood Chain",
  },
  {
    venue: "QFEX",
    chain: "Off-chain CLOB plus stablecoin deposit rails",
    operator: "QFEX",
    jurisdiction: "CG: Panama; Crunchbase: New York",
    oracle: "unverified",
    onchainChain: "QFEX",
  },
  {
    venue: "RISEx",
    chain: "RISE chain (Ethereum L2; unverified)",
    operator: "RISE",
    jurisdiction: "CG: Singapore",
    oracle: "unverified",
    onchainChain: "RISE",
  },
  {
    venue: "edgeX",
    chain: "edgeX L2 (StarkEx-based; unverified)",
    operator: "edgeX",
    jurisdiction: "CG: Singapore",
    oracle: "unverified",
    onchainChain: "edgeX",
  },
  {
    venue: "Polymarket Perps",
    chain: "Hybrid: off-chain matching; deposits settle on Polygon",
    operator: "Polymarket (international; US users excluded)",
    jurisdiction: "CG: none listed",
    oracle: "Mark tracks a multi-venue price; index source unverified",
    onchainChain: "Polymarket",
  },
  {
    venue: "Decibel",
    chain: "Aptos",
    operator: "Decibel",
    jurisdiction: "CG: Cayman Islands",
    oracle: "unverified",
    onchainChain: "Aptos",
  },
  {
    venue: "Dipcoin",
    chain: "Sui",
    operator: "DipCoin",
    jurisdiction: "CG: Seychelles",
    oracle: "unverified",
    onchainChain: "Sui",
  },
  {
    venue: "GMX V2 (Solana)",
    chain: "Solana (GMX-Solana / GMTrade)",
    operator: "GMX contributors",
    jurisdiction: "n/a (DAO)",
    oracle: "Chainlink Data Streams (unverified for this deployment)",
    onchainChain: "Solana",
  },
  {
    venue: "TurboFlow",
    chain: "unverified",
    operator: "TurboFlow",
    jurisdiction: "CG: British Virgin Islands",
    oracle: "unverified",
    onchainChain: "TurboFlow",
  },
  {
    venue: "WEEX",
    chain: "Centralized exchange",
    operator: "WEEX",
    jurisdiction: "CG: Singapore",
    oracle: "unverified",
  },
  {
    venue: "BloFin",
    chain: "Centralized exchange",
    operator: "BloFin",
    jurisdiction: "CG: Marshall Islands",
    oracle: "unverified",
  },
  {
    venue: "Coinbase International",
    chain: "Centralized exchange",
    operator: "Coinbase",
    jurisdiction: "CG: United States (Bermuda licensing unverified)",
    oracle: "Coinbase index (unverified)",
  },
  {
    venue: "Vest",
    chain: "Vest (zk). Deposits on Base and Arbitrum.",
    operator: "Vest Markets",
    jurisdiction: "unverified",
    oracle: "unverified",
    onchainChain: "Vest",
  },
  {
    venue: "Helix",
    chain: "Injective",
    operator: "Helix",
    jurisdiction: "unverified",
    oracle: "Pyth Pro on the derivative market (unverified for equities)",
    onchainChain: "Injective",
  },
  {
    venue: "Bitstamp",
    chain: "Centralized exchange",
    operator: "Bitstamp",
    jurisdiction: "unverified",
    oracle: "unverified",
  },
  {
    venue: "StandX",
    chain: "StandX",
    operator: "StandX",
    jurisdiction: "unverified",
    oracle: "unverified",
    onchainChain: "StandX",
  },
  {
    venue: "Bitfinex",
    chain: "Centralized exchange",
    operator: "Bitfinex",
    jurisdiction: "unverified",
    oracle: "unverified",
  },
  {
    venue: "GMX V2 (Arbitrum)",
    chain: "Arbitrum (GMX V2 pool). Separate from GMX V2 (Solana).",
    operator: "GMX contributors",
    jurisdiction: "n/a (DAO)",
    oracle: "Chainlink Data Streams (unverified for this deployment)",
    onchainChain: "Arbitrum",
  },
  {
    venue: "Drift",
    chain: "Solana. Protocol paused since the 2026-04-01 hack.",
    operator: "Drift",
    jurisdiction: "unverified",
    oracle: "unverified",
    onchainChain: "Solana",
  },
];

for (const place of PERP_PLACES) SNAPSHOT_PLACE[place.venue] = place;
const verantaPlace = SNAPSHOT_PLACE.Veranta;
if (verantaPlace) SNAPSHOT_PLACE.Avantis = verantaPlace;

export function perpPlace(venue: string): PerpPlace | null {
  if (venue.startsWith("Hyperliquid HIP-3")) return SNAPSHOT_PLACE["Hyperliquid HIP-3"] ?? null;
  return SNAPSHOT_PLACE[venue] ?? null;
}

export function hip3Dex(venue: string): string | null {
  const match = /^Hyperliquid HIP-3 \(([^)]+)\)$/.exec(venue);
  return match?.[1] ?? null;
}
