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
  "Solana volume is DexScreener pair data for tokenized public equities discovered from the live xStocks public registry, the public Ondo GM mint list, the public Tessera T-Token mint list, the public Sunrise token list, the public Securitize stocks catalog, DexScreener search, and public GeckoTerminal search, then classified fail-closed and aggregated by mint across Solana pools. GeckoTerminal is a candidate + hydrate hint only — its 24h is not mixed into the desk total. Tessera V prop-AMM has no per-mint public volume feed (DefiLlama protocol 24h has no pair/token split; TVL is not volume) and is not invented. Securitize PropAMM volume is not on DexScreener and is not invented. Coverage is as discoverable from those live sources + the classifier, not a full chain index. Most classified mints have no DexScreener-indexed pools (confirmed after lookup) — that is unknown volume, not zero. Null volume is never coerced to zero. ETF/index and private-market / PreStocks / Tessera T-Token 24h are labeled on the Solana card and added to the Daily Volume headline and DexScreener snapshot history (null omitted, not zero); they are not mixed into public-equity ranking. The ETF / index lane stays available for those names. Keyed issuer APIs (Ondo Stocks, Jupiter tokens/v2 stocks tag, tokens.xyz) are not used. Asset-page market cap is the DEX median price times the Solana mint's getTokenSupply UI amount (Token-2022 scaled UI included). FDV uses that same outstanding supply because an SPL mint has no separate unminted cap and this desk has no lockup feed. DexScreener pair marketCap and fdv are not used. Missing mint supply or price stays blank and is not filled from liquidity.";

export const COMPOSITE_SOURCE_NOTE =
  "The home list merges independently fetched adapters. A failed adapter is omitted or marked unavailable; other adapters are not invented to fill the gap.";

export const INTERPRETIVE_LABEL = "Interpretive";
export const FACT_LABEL = "Reported";
