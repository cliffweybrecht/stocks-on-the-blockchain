/**
 * Schema changes and fixes for the equity-perp desk. The methodology page
 * renders this list. Stored history is not rewritten when a rule changes;
 * the next capture applies it.
 */
export interface PerpsChangelogEntry {
  id: string;
  title: string;
  body: string;
}

export const PERPS_CHANGELOG: readonly PerpsChangelogEntry[] = [
  {
    id: "quality",
    title: "Venue quality",
    body: "Each venue is fresh when that capture returned a book, failed when the request errored and no earlier good row exists, and stale when it errored after a good row. Failed and stale volume stay blank. They are not stored as zero and they are not added to the headline. Last good is the earlier capture time. Rows from before the field existed are fresh when they have no error.",
  },
  {
    id: "books-names",
    title: "Per-venue books and the name set",
    body: "The top names store volume and open interest by venue. The day also stores every equity underlying, not only the capped ticker list. If an encoded day would pass 140KB, books are dropped first, then the name set. Older rows omit both.",
  },
  {
    id: "json",
    title: "JSON downloads",
    body: "daily.json, venues.json, and tickers.json mirror the CSVs. Empty cells are null. The payload names the schema and the attribution line.",
  },
  {
    id: "oi-screen",
    title: "Open-interest screen",
    body: "A venue is screened when every positive-volume market reported open interest. If only some did, and those markets are at least half the venue volume, the screen uses that covered subset. A thinner fill is treated as missing. Rows already stored keep their credible flag.",
  },
  {
    id: "aliases",
    title: "Index aliases",
    body: "DAX, GDAXI, and DE40 share one index label, as do FTSE and UKX, DJI and DJIA, and NIK and NKY. GOOGLX maps to GOOGL. DOW stays the stock. These aliases apply when a name is classified, not by rewriting stored groups.",
  },
  {
    id: "funding",
    title: "Funding interval",
    body: "Rates stay in the venue's native decimal. A third funding element, the interval in hours, is written only when that capture stored one: Gate funding_interval and Bitget fundInterval when the value is a clean quarter-hour from 15 minutes through 24 hours, and 1 hour on Hyperliquid because that API field is the hourly payment. Annualized percent is rate × (365 × 24 / hours) × 100. The 8h equivalent is rate × (8 / hours). Both are labeled derived. Older Hyperliquid rows use the documented 1h interval at read time and are not rewritten. Binance, Bybit, OKX, and CoinGecko are not given a venue-wide default; their native rate is shown and the interval stays unknown until a capture stores one. A spread is the gap in 8h equivalents, and only when at least two venues have a known interval.",
  },
  {
    id: "no-equity",
    title: "Empty onchain books",
    body: "A HIP-3 dex or other onchain venue that returns a book and has zero equity markets is stored with ne set. It stays out of the headline and out of the volume table. A later equity listing on that name is the same venue. A failed request is not marked this way. Centralized venues are left unchanged.",
  },
  {
    id: "names-classified",
    title: "SKHY, SKHYNIX, and the unclassified names",
    body: "Checked against venue metadata on 15 Oct 2026, applied on the next capture. SKHY is the Nasdaq ADR: TradeXYZ specifies 1 SK Hynix American depositary share, and 10 ADS equal 1 Korea Exchange common share. Marks that day were about $138. SKHYNIX, and the xyz symbol SKHX, are 1 common share of SK hynix (KRX 000660). Marks were about $940 to $948. They are different securities and stay separate stocks. MUU is Direxion Daily MU Bull 2X, MVLL is GraniteShares 2x Long MRVL, INTW is GraniteShares 2x Long INTC, and SKDD is GraniteShares 2x Short SK Hynix (−2× the ADS). Those four classify as leveraged ETFs. ZHIPU is Knowledge Atlas Technology (Z.AI), HKEX 2513, the H-share listed 8 Jan 2026. Hyperliquid tracks 1 H-share with HKD converted to USD. It stays a stock. ZHIPUHKD is a separate HKD quote and is not aliased. Stored days keep the category they were written with.",
  },
  {
    id: "listings",
    title: "Listings versus the capped list",
    body: "When both days store the full name set, listed and delisted come from that set. A name that leaves the capped ticker list but remains in the book is cap movement, not a delisting. A price-band miss can still remove a name from the book. When only the capped list exists, nothing is called a listing or a delisting. When only the newer day has the full set, a capped name absent from that set is gone, and a name that appears only on the new day is not counted as a new listing.",
  },
  {
    id: "checks",
    title: "Row sanity checks",
    body: "Each new row stores a short checks list against the previous day: headline and tier swings, a large venue swing, venue-count and market-count changes, a fresh venue whose volume or open interest vanished, CoinGecko's share of the headline, and Binance or Bybit CoinGecko versus the official archive. The text is a plain flag such as Binance +60% d/d: verify. Flags do not change the numbers. If the check throws, the day is saved without the list. Older rows omit it. An empty list means the watchdog ran clean.",
  },
  {
    id: "okx-interval",
    title: "OKX funding interval",
    body: "Equity swaps on OKX, instCategory 3, take fundingRate and the hours between fundingTime and nextFundingTime from one public funding-rate?instId=ANY call. Crypto swaps in that payload are ignored. The hours are kept only when they snap to a clean quarter-hour from 15 minutes through 24 hours. A timeout or any other error leaves OKX without a rate and without an interval, so it stays not annualized.",
  },
  {
    id: "lighter-rate",
    title: "Lighter funding rate",
    body: "Lighter's public funding-rates endpoint returns a rate for exchange lighter, plus rates for other venues. Only the lighter rows are stored, and only when the order book itself has no rate. The list has no interval. The hourly fundings history uses a different scale, so the stored rate is not annualized. Lighter on Robinhood Chain is a different host and is unchanged. If the request fails, Lighter stays as it was.",
  },
  {
    id: "zhipuhkd",
    title: "ZHIPUHKD left separate",
    body: "Checked on Gate on 15 Oct 2026. ZHIPU_USDT marked about $65. ZHIPUHKD_USDT marked about $509, roughly the HKD figure for the same H-share, and the contract is still USDT-settled. volume_24h_quote is turnover at that mark, not the USD share value. Aliasing ZHIPUHKD onto ZHIPU would mix the two scales, so the symbols stay separate.",
  },
  {
    id: "freshness",
    title: "As-of line",
    body: "The home Perps card and the /perps header state the capture time, the Eastern day, and whether that day is closed. Hyperliquid, direct APIs, and CoinGecko each show the latest fresh capture, or the last good time when that group is stale or failed.",
  },
  {
    id: "venues-2026-10-20",
    title: "Direct books, Veranta, Drift, and the unverified tier",
    body: "The 20 Oct 2026 pass adds direct equity books for Zoomex, Ourbit, Arcus, Vest, Polymarket Perps, BloFin, RISEx, edgeX on edgex-prod-v2, GMX V2 Solana, GMX V2 Arbitrum, Helix, Bitstamp, StandX, and Bitfinex, and tags Crypto.com from get-instruments. Zoomex uses turnover24h as quote USD. CoinGecko is about 0.30× that figure and is not applied. Vest keeps NDX and SPX as indices. Avantis was renamed Veranta on 14 Sep 2026. Veranta volume is the last complete UTC day, not a blend with the partial capture day, and it is counted once. Stored Avantis rows keep their old name. Drift is paused since the 1 Apr 2026 hack and is stored as no equity perps, with no request. LBank and Ourbit go through the volume/OI screen. CoinGecko-only names move to an unverified tier that stays out of the headline until the desk opts in. Deepcoin, BVOX, KCEX, Dipcoin, Hotcoin, Bitrue, BYDFi, BigONE, and TurboFlow stay excluded. gTrade is not counted. A failed request stays blank. Older rows are not rewritten.",
  },
];
