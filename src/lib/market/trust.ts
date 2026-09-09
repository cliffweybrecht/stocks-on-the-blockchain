export const PRODUCT_DISCLAIMER =
  "Read-only market data. This is not a trading venue, wallet, or order router. Nothing here is executable Robinhood trading, arbitrage, or a profitability claim.";

export const DISPLAYED_LIQUIDITY_NOTE =
  "Displayed liquidity is provider-reported pool liquidity. It is not executable size and does not mean that amount can be bought or sold without material price impact.";

export const PRICE_MARKS_NOTE =
  "Robinhood reference and DEX marks come from separate sources and may be observed at different times. The premium/discount figure is interpretive arithmetic on those marks — not a trade signal.";

export const MOCK_SOURCE_NOTE =
  "Seed adapter is showing deterministic demo data so the multi-chain volume → stock → asset path works without a live Terminal.";

export const TERMINAL_SOURCE_NOTE =
  "Live Terminal is a single-chain read-only HTTP source (Robinhood Chain). Other chains appear only when additional adapters are configured.";

export const SOLANA_SOURCE_LABEL = "DexScreener (Solana tokenized stocks)";

export const SOLANA_SOURCE_NOTE =
  "Solana volume is DexScreener pair data for tokenized public equities discovered from the live xStocks public registry, the public Ondo GM mint list, DexScreener search, and public GeckoTerminal search, then classified fail-closed and aggregated by mint across Solana pools. Coverage is as discoverable from those live sources + the classifier, not a full chain index. Most classified mints have no DexScreener-indexed pools (confirmed after lookup) — that is unknown volume, not zero. Null volume is never coerced to zero. ETF/index products stay in a separate lane. Private-market / PreStocks 24h is labeled on the Solana card and added to the Daily Volume headline (null omitted, not zero); it is not mixed into public-equity ranking or the Gecko chart series. Keyed issuer APIs (Ondo Stocks, Jupiter tokens/v2 stocks tag, tokens.xyz) are not used.";

export const COMPOSITE_SOURCE_NOTE =
  "The home list merges independently fetched adapters. A failed adapter is omitted or marked unavailable; other adapters are not invented to fill the gap.";

export const INTERPRETIVE_LABEL = "Interpretive";
export const FACT_LABEL = "Reported";
