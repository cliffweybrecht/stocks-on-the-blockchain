import { bscBatchRotating, padAddress, readBeacons, readSymbols } from "./lending-bsc";
import { buildEquityAddressBook, bookHasChain, type EquityAddressBook, xstocksPageHasNext } from "./lending-addresses";
import {
  BSTOCK_BEACON,
  noteFromRow,
  parseAaveEquitiesHub,
  parseJupiterLend,
  parseKaminoReserveMetrics,
  parseListaBook,
  parseMorphoMarkets,
  parseVenusMarkets,
  tokenAmountUsd,
  type ListaCollateralQuote,
} from "./lending-parse";
import { asReportedNumber, tokenCountFromBaseUnits } from "./numbers";
import { lendingDayFromCapture, type LendingDaySnapshot, type LendingRow, type LendingSourceNote } from "./lending-snapshot";
import { chooseVenusEstimate, scanVenusBStockBorrow, VENUS_CHECKED_ESTIMATE, type VenusBorrowEstimate } from "./lending-venus-estimate";

const UA = "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)";

const KAMINO_MARKETS = "https://api.kamino.finance/v2/kamino-market?programId=KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const KAMINO_XSTOCKS = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const KAMINO_SENTORA = "8BNUWRSibVasaAmhYpBCFpGgMisGKfVAf9ho3Cmf6vjr";
const JUPITER_VAULTS = "https://lite-api.jup.ag/lend/v1/borrow/vaults";
const JUPITER_LIQUIDITY = "https://lite-api.jup.ag/lend/v1/liquidity/tokens";
const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";
const AAVE_GRAPHQL = "https://api.v4.aave.com/graphql";
const VENUS_MARKETS = "https://api.venus.io/markets/core-pool?chainId=56&limit=100";
const LISTA_OVERALL = "https://api.lista.org/api/moolah/overall";
const LISTA_ALL_MARKETS = "https://api.lista.org/api/moolah/allMarkets?chain=bsc";
const XSTOCKS_ASSETS = "https://api.xstocks.fi/api/v2/public/assets?pageSize=100&page=";
const STOCKSONCHAIN = "https://stocksonchain.io/api/tokens.json";
const RHJ_ASSETS = "https://api.robinhood.com/rhj/assets";
const COINBASE_STOCKS = "https://api.coinbase.com/v1/tokenized-stocks";
const ST0X_BASE = "https://raw.githubusercontent.com/ST0x-Technology/st0x.registry/main/token-lists/base.json";
const BACKED_ASSETS = "https://api.backed.fi/api/v1/token";
const ANCHORED_DOCS = "https://docs.anchored.finance/getting-started/anchored-tokens.md";

const MORPHO_CHAINS = [1, 8453, 4663, 999] as const;

const MORPHO_QUERY = `query LendingMarkets($chainId: Int!, $skip: Int!) {
  markets(first: 1000, skip: $skip, where: { chainId_in: [$chainId] }) {
    pageInfo { count countTotal }
    items {
      lltv
      loanAsset { address symbol }
      collateralAsset { address symbol decimals }
      state { collateralAssets collateralAssetsUsd borrowAssetsUsd supplyAssetsUsd borrowApy }
    }
  }
}`;

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/g, " ").trim();
    return message.slice(0, 180) || "request failed";
  }
  return "request failed";
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 45_000): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json",
      "user-agent": UA,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function getJsonRetry(url: string, init?: RequestInit): Promise<unknown> {
  try {
    return await getJson(url, init);
  } catch (error) {
    const message = errorMessage(error);
    if (!/\b(429|502|503)\b/.test(message) && !/timeout/i.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return getJson(url, init);
  }
}

async function settle(source: string, run: () => Promise<unknown>): Promise<{ source: string; data: unknown; error: string | null }> {
  try {
    return { source, data: await run(), error: null };
  } catch (error) {
    return { source, data: null, error: errorMessage(error) };
  }
}

function kaminoMetricsUrl(market: string): string {
  return `https://api.kamino.finance/kamino-market/${market}/reserves/metrics`;
}

function kaminoTargets(payload: unknown): { id: string; venue: string; market: string }[] {
  const known = [
    { id: "kamino-xstocks", venue: "Kamino xStocks", market: KAMINO_XSTOCKS },
    { id: "kamino-sentora", venue: "Kamino Sentora / Kraken", market: KAMINO_SENTORA },
  ];
  if (!Array.isArray(payload)) return known;
  const found: { id: string; venue: string; market: string }[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; lendingMarket?: unknown };
    const market = typeof row.lendingMarket === "string" ? row.lendingMarket : "";
    const name = typeof row.name === "string" ? row.name : "";
    if (!/xstock/i.test(name) || !market) continue;
    if (market === KAMINO_XSTOCKS || name === "xStocks Market") {
      found.push({ id: "kamino-xstocks", venue: "Kamino xStocks", market });
    } else if (market === KAMINO_SENTORA || /sentora|kraken/i.test(name)) {
      found.push({ id: "kamino-sentora", venue: "Kamino Sentora / Kraken", market });
    } else {
      found.push({ id: `kamino-${market.slice(0, 8).toLowerCase()}`, venue: `Kamino ${name}`, market });
    }
  }
  return found.length > 0 ? found : known;
}

async function fetchXStocksPages(): Promise<unknown[]> {
  const pages: unknown[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const payload = await getJsonRetry(`${XSTOCKS_ASSETS}${page}`);
    pages.push(payload);
    if (!xstocksPageHasNext(payload)) break;
  }
  return pages;
}

async function fetchMorphoChain(chainId: number): Promise<unknown[]> {
  const items: unknown[] = [];
  for (let skip = 0; skip < 8_000; skip += 1000) {
    const payload = await getJsonRetry(MORPHO_GRAPHQL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: MORPHO_QUERY, variables: { chainId, skip } }),
    });
    const markets = (payload as { data?: { markets?: { pageInfo?: { count?: number; countTotal?: number }; items?: unknown[] } } })
      .data?.markets;
    const page = markets?.items ?? [];
    items.push(...page);
    const total = markets?.pageInfo?.countTotal;
    if (page.length === 0 || (typeof total === "number" && items.length >= total)) break;
  }
  return items;
}

async function fetchAaveHubAssets(): Promise<unknown> {
  const hubsPayload = await getJsonRetry(AAVE_GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query { hubs(request: { query: { chainIds: [8453] } }) { id name chain { chainId } } }`,
    }),
  });
  const hubs = (hubsPayload as { data?: { hubs?: { id?: string; name?: string }[] } }).data?.hubs ?? [];
  const hub = hubs.find((item) => /coinbase stocks/i.test(item.name ?? ""));
  if (!hub?.id) throw new Error("Aave V4 Base Coinbase stocks hub was not listed.");
  const assetsPayload = await getJsonRetry(AAVE_GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query HubAssets($hubId: String!) {
        hubAssets(request: { query: { hubId: $hubId } }) {
          underlying { address info { symbol } }
          summary {
            supplied { amount { value } exchange { value } }
            borrowed { exchange { value } }
            borrowApy { normalized value }
            utilizationRate { normalized value }
          }
        }
      }`,
      variables: { hubId: hub.id },
    }),
  });
  const assets = (assetsPayload as { data?: { hubAssets?: unknown } }).data?.hubAssets;
  if (!Array.isArray(assets)) throw new Error("Aave hub assets were missing.");
  return assets;
}

async function fetchListaMarketDetail(id: string): Promise<{ borrowRate: number | null; loanPrice: number | null }> {
  const payload = await getJsonRetry(`https://api.lista.org/api/moolah/market/${id}`);
  const data = (payload as { data?: { borrowRate?: unknown; loanTokenPrice?: unknown } }).data;
  const borrowRate = typeof data?.borrowRate === "number" && Number.isFinite(data.borrowRate) ? data.borrowRate : null;
  const loanPrice = typeof data?.loanTokenPrice === "number" && Number.isFinite(data.loanTokenPrice) ? data.loanTokenPrice : null;
  return { borrowRate, loanPrice };
}

function failure(source: string, message: string): LendingSourceNote {
  return { source, message };
}

export async function captureLendingSnapshot(
  nowMs = Date.now(),
  options?: { previousVenusEstimate?: VenusBorrowEstimate | null },
): Promise<LendingDaySnapshot> {
  const venusEstimatePromise = settle("Venus estimate", () => scanVenusBStockBorrow(nowMs));
  const [
    kaminoList,
    jupiterVaults,
    jupiterLiquidity,
    venus,
    listaOverall,
    listaMarkets,
    aave,
    xstocks,
    stocksonchain,
    rhj,
    coinbase,
    st0x,
    backed,
    anchored,
    ...morphoChains
  ] = await Promise.all([
    settle("Kamino markets", () => getJsonRetry(KAMINO_MARKETS)),
    settle("Jupiter Lend", () => getJsonRetry(JUPITER_VAULTS)),
    settle("Jupiter liquidity", () => getJsonRetry(JUPITER_LIQUIDITY)),
    settle("Venus", () => getJsonRetry(VENUS_MARKETS, { headers: { "accept-version": "stable" } })),
    settle("Lista", () => getJsonRetry(LISTA_OVERALL)),
    settle("Lista markets", () => getJsonRetry(LISTA_ALL_MARKETS)),
    settle("Aave V4", () => fetchAaveHubAssets()),
    settle("xStocks registry", () => fetchXStocksPages()),
    settle("Stocks On Chain", () => getJsonRetry(STOCKSONCHAIN)),
    settle("Robinhood Chain registry", () => getJsonRetry(RHJ_ASSETS)),
    settle("Coinbase tokenized stocks", () => getJsonRetry(COINBASE_STOCKS)),
    settle("ST0x Base list", () => getJsonRetry(ST0X_BASE)),
    settle("Backed assets", () => getJsonRetry(BACKED_ASSETS)),
    settle("Anchored docs", () => getJson(ANCHORED_DOCS, { headers: { accept: "text/plain, text/markdown, */*" } }).then(async (value) => value)),
    ...MORPHO_CHAINS.map((chainId) => settle(`Morpho ${chainId}`, () => fetchMorphoChain(chainId))),
  ]);

  const anchoredText = await anchoredTextFrom(anchored);
  const book = buildEquityAddressBook({
    xstocksPages: Array.isArray(xstocks.data) ? xstocks.data : [],
    stocksonchain: stocksonchain.data,
    rhj: rhj.data,
    coinbase: coinbase.data,
    st0x: st0x.data,
    backed: backed.data,
    dinari: stocksonchain.data,
    anchoredMarkdown: anchoredText,
  });

  const failures: LendingSourceNote[] = [];
  for (const source of [xstocks, stocksonchain, rhj, coinbase]) {
    if (source.error) failures.push(failure(source.source, source.error));
  }
  if (book.solana.size === 0) {
    failures.push(failure("xStock mints", "No verified Solana xStock mints, so Kamino and Jupiter cannot be matched."));
  }

  const listaRowPromise = captureLista(listaOverall, listaMarkets);
  const venusEstimate = await venusEstimatePromise;
  const rows: LendingRow[] = [];
  rows.push(...(await captureKamino(kaminoList.data, book)));
  rows.push(captureJupiter(jupiterVaults, jupiterLiquidity, book));
  rows.push(captureAave(aave, book));
  for (const [index, chainId] of MORPHO_CHAINS.entries()) {
    const fetched = morphoChains[index];
    rows.push(captureMorpho(chainId, fetched, book));
  }
  rows.push(await captureVenus(venus, venusEstimate, options?.previousVenusEstimate ?? null));
  rows.push(await listaRowPromise);

  for (const row of rows) {
    const note = noteFromRow(row);
    if (note && row.collateralUsd === null && row.stableBorrowedUsd === null) failures.push(note);
    else if (row.error && (row.collateralUsd !== null || row.stableBorrowedUsd !== null)) {
      failures.push(failure(row.venue, row.error));
    }
  }

  return lendingDayFromCapture(nowMs, rows, dedupeFailures(failures));
}

async function anchoredTextFrom(result: { data: unknown; error: string | null }): Promise<string | null> {
  if (result.error || result.data == null) return null;
  if (typeof result.data === "string") return result.data;
  return null;
}

async function captureKamino(list: unknown, book: EquityAddressBook): Promise<LendingRow[]> {
  const targets = kaminoTargets(list);
  const metrics = await Promise.all(
    targets.map((target) => settle(target.venue, () => getJsonRetry(kaminoMetricsUrl(target.market)))),
  );
  return metrics.map((result, index) => {
    const target = targets[index];
    if (!target) {
      return parseKaminoReserveMetrics(null, {
        id: "kamino",
        venue: "Kamino",
        equityMints: book.solana,
        source: KAMINO_MARKETS,
      });
    }
    const source = kaminoMetricsUrl(target.market);
    if (result.error || book.solana.size === 0) {
      const row = parseKaminoReserveMetrics(null, { ...target, equityMints: book.solana, source });
      return { ...row, error: result.error ?? "Verified xStock mints were missing." };
    }
    return parseKaminoReserveMetrics(result.data, { ...target, equityMints: book.solana, source });
  });
}

function captureJupiter(
  vaults: { data: unknown; error: string | null },
  liquidity: { data: unknown; error: string | null },
  book: EquityAddressBook,
): LendingRow {
  if (vaults.error) {
    const row = parseJupiterLend({
      vaults: null,
      liquidityTokens: null,
      equityMints: book.solana,
      source: JUPITER_VAULTS,
    });
    return { ...row, error: vaults.error };
  }
  const row = parseJupiterLend({
    vaults: vaults.data,
    liquidityTokens: liquidity.error ? null : liquidity.data,
    equityMints: book.solana,
    source: JUPITER_VAULTS,
  });
  if (liquidity.error && row.utilization === null && row.collateralUsd !== null) {
    return { ...row, error: row.error ?? `Jupiter lend-side utilization did not load (${liquidity.error}).` };
  }
  return row;
}

function captureAave(result: { data: unknown; error: string | null }, book: EquityAddressBook): LendingRow {
  const source = AAVE_GRAPHQL;
  if (result.error) {
    const row = parseAaveEquitiesHub(null, { equityAddresses: book.evm.get(8453) ?? null, source });
    return { ...row, error: result.error };
  }
  const addresses = bookHasChain(book, 8453) ? (book.evm.get(8453) ?? null) : null;
  return parseAaveEquitiesHub(result.data, {
    equityAddresses: addresses,
    source,
  });
}

function captureMorpho(
  chainId: number,
  result: { data: unknown; error: string | null } | undefined,
  book: EquityAddressBook,
): LendingRow {
  const source = MORPHO_GRAPHQL;
  if (!result || result.error) {
    const row = parseMorphoMarkets(null, { chainId, book, source });
    return { ...row, error: result?.error ?? "Morpho markets did not load." };
  }
  return parseMorphoMarkets(result.data, { chainId, book, source });
}

async function captureVenus(
  result: { data: unknown; error: string | null },
  estimate: { data: unknown; error: string | null },
  previous: VenusBorrowEstimate | null,
): Promise<LendingRow> {
  const measured = estimate.data && typeof estimate.data === "object" && "usd" in estimate.data ? (estimate.data as VenusBorrowEstimate) : null;
  const live = measured && typeof measured.usd === "number" ? measured : null;
  const borrowEstimate = chooseVenusEstimate(live, previous, VENUS_CHECKED_ESTIMATE);
  if (result.error) {
    const row = parseVenusMarkets(null, VENUS_MARKETS, { estimate: borrowEstimate });
    return { ...row, error: result.error };
  }
  const listed = venusBstockAddresses(result.data);
  let equityAddresses: Set<string> | null = null;
  if (listed.size > 0) {
    try {
      const beacons = await readBeacons([...listed]);
      const confirmed = new Set<string>();
      let unread = false;
      for (const address of listed) {
        const beacon = beacons.get(address);
        if (!beacon) unread = true;
        else if (beacon === BSTOCK_BEACON) confirmed.add(address);
      }
      if (!unread) equityAddresses = confirmed;
    } catch {
      equityAddresses = null;
    }
  }
  return parseVenusMarkets(result.data, VENUS_MARKETS, {
    equityAddresses,
    estimate: borrowEstimate,
  });
}

function venusBstockAddresses(payload: unknown): Set<string> {
  const root = payload && typeof payload === "object" ? (payload as { result?: unknown }).result : null;
  const list = Array.isArray(payload) ? payload : Array.isArray(root) ? root : [];
  const addresses = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as { category?: unknown; underlyingAddress?: unknown };
    if (row.category !== "bstocks") continue;
    if (typeof row.underlyingAddress === "string") addresses.add(row.underlyingAddress.toLowerCase());
  }
  return addresses;
}

async function captureLista(
  overall: { data: unknown; error: string | null },
  markets: { data: unknown; error: string | null },
): Promise<LendingRow> {
  if (overall.error) {
    const row = parseListaBook({ overall: null, markets: markets.data, source: LISTA_OVERALL });
    return { ...row, error: overall.error };
  }
  if (markets.error || markets.data == null) {
    const row = parseListaBook({ overall: overall.data, markets: null, source: LISTA_ALL_MARKETS });
    return { ...row, error: markets.error ?? "Lista markets did not load." };
  }
  const list = Array.isArray(markets.data)
    ? markets.data
    : markets.data && typeof markets.data === "object" && Array.isArray((markets.data as { data?: unknown }).data)
      ? (markets.data as { data: unknown[] }).data
      : null;
  const zone5 = (list ?? []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as { zone?: unknown; chain?: unknown };
    return Number(row.zone) === 5 && String(row.chain ?? "").toLowerCase() === "bsc";
  });
  const collateral = [
    ...new Set(
      zone5
        .map((item) => {
          const token = (item as { collateralToken?: unknown }).collateralToken;
          return typeof token === "string" ? token.toLowerCase() : "";
        })
        .filter(Boolean),
    ),
  ];
  let rejected = new Set<string>();
  let symbols = new Map<string, string>();
  try {
    const beacons = await readBeacons(collateral);
    rejected = new Set(
      collateral.filter((address) => {
        const beacon = beacons.get(address);
        return beacon !== null && beacon !== undefined && beacon !== BSTOCK_BEACON;
      }),
    );
  } catch {
    rejected = new Set();
  }
  try {
    symbols = await readSymbols(collateral);
  } catch {
    symbols = new Map();
  }
  const loanMarkets = (list ?? []).filter((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as { zone?: unknown; loanToken?: unknown; totalBorrowAssets?: unknown; id?: unknown };
    if (Number(row.zone) === 5) return false;
    const loan = typeof row.loanToken === "string" ? row.loanToken.toLowerCase() : "";
    if (!collateral.includes(loan) || rejected.has(loan)) return false;
    const raw = Number(row.totalBorrowAssets);
    return Number.isFinite(raw) && raw > 0 && typeof row.id === "string";
  }) as { id: string; totalBorrowAssets?: unknown }[];
  const loanPrices = new Map<string, number>();
  const rates: { apy: number | null; weight: number | null }[] = [];
  const borrowMarkets = zone5.filter((item) => {
    const raw = Number((item as { totalBorrowAssets?: unknown }).totalBorrowAssets);
    return Number.isFinite(raw) && raw > 0;
  });
  const details = await mapPool([...new Set([...loanMarkets, ...borrowMarkets])], 12, async (item) => {
    const id = String((item as { id: string }).id);
    try {
      return { id, ...(await fetchListaMarketDetail(id)) };
    } catch {
      return { id, borrowRate: null, loanPrice: null };
    }
  });
  const detailById = new Map(details.map((detail) => [detail.id.toLowerCase(), detail]));
  for (const market of loanMarkets) {
    const detail = detailById.get(market.id.toLowerCase());
    if (detail?.loanPrice !== null && detail?.loanPrice !== undefined) loanPrices.set(market.id.toLowerCase(), detail.loanPrice);
  }
  let ratesComplete = true;
  for (const market of borrowMarkets) {
    const row = market as { id?: unknown; totalBorrowAssets?: unknown; collateralToken?: unknown };
    const id = typeof row.id === "string" ? row.id.toLowerCase() : "";
    const collateralToken = typeof row.collateralToken === "string" ? row.collateralToken.toLowerCase() : "";
    if (rejected.has(collateralToken)) continue;
    const detail = detailById.get(id);
    const weight = detail?.loanPrice != null ? tokenAmountUsd(row.totalBorrowAssets, detail.loanPrice) : null;
    if (weight === null || !(weight > 0) || detail?.borrowRate === null || detail?.borrowRate === undefined) {
      ratesComplete = false;
      continue;
    }
    rates.push({ apy: detail.borrowRate, weight });
  }
  const quoteTokens = collateral.filter((address) => !rejected.has(address));
  const marketByCollateral = new Map<string, string>();
  for (const item of zone5) {
    const row = item as { collateralToken?: unknown; id?: unknown };
    const token = typeof row.collateralToken === "string" ? row.collateralToken.toLowerCase() : "";
    const id = typeof row.id === "string" ? row.id : "";
    if (!token || !id || rejected.has(token) || marketByCollateral.has(token)) continue;
    marketByCollateral.set(token, id);
  }
  const quotes = await fetchListaCollateralQuotes(
    quoteTokens.map((address) => ({ address, marketId: marketByCollateral.get(address) ?? "" })),
  );
  return parseListaBook({
    overall: overall.data,
    markets: markets.data,
    rejectedCollateral: rejected,
    symbols,
    loanPrices,
    quotes,
    rates: ratesComplete ? rates : undefined,
    source: LISTA_OVERALL,
  });
}

const LISTA_MOOLAH = "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C";
const BALANCE_OF_SELECTOR = "0x70a08231";
const DECIMALS_SELECTOR = "0x313ce567";

function listaVaultPrice(payload: unknown): number | null {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  const list = data && typeof data === "object" ? (data as { list?: unknown }).list : null;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const price = asReportedNumber((item as { collateralPrice?: unknown }).collateralPrice);
    if (price !== null && price >= 0) return price;
  }
  return null;
}

/**
 * Token count is the collateral's balance inside Lista Moolah.
 * Dollars are that count times the vault collateral price. The headline total is not touched.
 */
async function fetchListaCollateralQuotes(
  tokens: readonly { address: string; marketId: string }[],
): Promise<Map<string, ListaCollateralQuote>> {
  const quotes = new Map<string, ListaCollateralQuote>();
  if (tokens.length === 0) return quotes;
  const prices = new Map<string, number | null>();
  await mapPool(tokens, 8, async (token) => {
    if (!token.marketId) {
      prices.set(token.address, null);
      return;
    }
    try {
      const payload = await getJsonRetry(`https://api.lista.org/api/moolah/market/vault/${token.marketId}`);
      prices.set(token.address, listaVaultPrice(payload));
    } catch {
      prices.set(token.address, null);
    }
  });
  let balances = new Map<string, number | null>();
  let balanceNote: string | null = null;
  try {
    balances = await readMoolahBalances(tokens.map((token) => token.address));
  } catch (error) {
    balanceNote = error instanceof Error ? error.message : "Lista collateral balance was not read.";
  }
  for (const token of tokens) {
    const price = prices.get(token.address) ?? null;
    const count = balances.get(token.address) ?? null;
    if (balanceNote && count === null) {
      quotes.set(token.address, { tokens: null, usd: null, note: "Lista collateral balance was not read." });
      continue;
    }
    if (count === null && price === null) {
      quotes.set(token.address, { tokens: null, usd: null, note: "Lista did not publish a price for this token." });
      continue;
    }
    if (price === null) {
      quotes.set(token.address, { tokens: count, usd: null, note: "Lista did not publish a price for this token." });
      continue;
    }
    const usd = count === null ? null : count * price;
    quotes.set(token.address, {
      tokens: count,
      usd: usd !== null && Number.isFinite(usd) && usd >= 0 ? usd : null,
      note: count === null ? "Lista collateral balance was not read." : null,
    });
  }
  return quotes;
}

async function readMoolahBalances(addresses: readonly string[]): Promise<Map<string, number | null>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const calls = unique.flatMap((address) => [
    { method: "eth_call", params: [{ to: address, data: BALANCE_OF_SELECTOR + padAddress(LISTA_MOOLAH) }, "latest"] },
    { method: "eth_call", params: [{ to: address, data: DECIMALS_SELECTOR }, "latest"] },
  ]);
  const results = await bscBatchRotating(calls);
  const map = new Map<string, number | null>();
  unique.forEach((address, index) => {
    const raw = wordOrNull(results[index * 2]);
    const decimalsWord = wordOrNull(results[index * 2 + 1]);
    if (raw === null || decimalsWord === null || decimalsWord > BigInt(36)) {
      map.set(address, null);
      return;
    }
    map.set(address, tokenCountFromBaseUnits(raw, Number(decimalsWord)));
  });
  return map;
}

function wordOrNull(hex: string | null | undefined): bigint | null {
  if (!hex || hex === "0x") return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

async function mapPool<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await run(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function dedupeFailures(notes: LendingSourceNote[]): LendingSourceNote[] {
  const seen = new Set<string>();
  const out: LendingSourceNote[] = [];
  for (const note of notes) {
    const key = `${note.source}\n${note.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}
