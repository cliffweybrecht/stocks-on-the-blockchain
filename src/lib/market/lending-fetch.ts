import { buildEquityAddressBook, bookHasChain, type EquityAddressBook, xstocksPageHasNext } from "./lending-addresses";
import {
  noteFromRow,
  parseAaveEquitiesHub,
  parseJupiterLend,
  parseKaminoReserveMetrics,
  parseListaBStock,
  parseMorphoMarkets,
  parseVenusMarkets,
  withListaApy,
} from "./lending-parse";
import { lendingDayFromCapture, type LendingDaySnapshot, type LendingRow, type LendingSourceNote } from "./lending-snapshot";

const UA = "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)";

const KAMINO_MARKETS = "https://api.kamino.finance/v2/kamino-market?programId=KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const KAMINO_XSTOCKS = "5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua";
const KAMINO_SENTORA = "8BNUWRSibVasaAmhYpBCFpGgMisGKfVAf9ho3Cmf6vjr";
const JUPITER_VAULTS = "https://lite-api.jup.ag/lend/v1/borrow/vaults";
const JUPITER_LIQUIDITY = "https://lite-api.jup.ag/lend/v1/liquidity/tokens";
const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";
const AAVE_GRAPHQL = "https://api.v4.aave.com/graphql";
const VENUS_MARKETS = "https://api.venus.io/markets?chainId=56&limit=100";
const LISTA_OVERALL = "https://api.lista.org/api/moolah/overall";
const LISTA_MARKETS = "https://api.lista.org/api/moolah/borrow/markets?chain=bsc&zone=5&pageSize=50&page=";
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
      loanAsset { address symbol }
      collateralAsset { address symbol }
      state { collateralAssetsUsd borrowAssetsUsd supplyAssetsUsd borrowApy }
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
            supplied { exchange { value } }
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

async function fetchListaMarkets(): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const payload = await getJsonRetry(`${LISTA_MARKETS}${page}`);
    const data = (payload as { data?: { total?: unknown; list?: unknown[] } }).data;
    const list = data?.list ?? [];
    if (list.length === 0) break;
    rows.push(...list);
    const total = Number(data?.total);
    if (Number.isFinite(total) && rows.length >= total) break;
  }
  return rows;
}

function failure(source: string, message: string): LendingSourceNote {
  return { source, message };
}

export async function captureLendingSnapshot(nowMs = Date.now()): Promise<LendingDaySnapshot> {
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
    settle("Lista markets", () => fetchListaMarkets()),
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

  const rows: LendingRow[] = [];
  rows.push(...(await captureKamino(kaminoList.data, book)));
  rows.push(captureJupiter(jupiterVaults, jupiterLiquidity, book));
  rows.push(captureAave(aave, book));
  for (const [index, chainId] of MORPHO_CHAINS.entries()) {
    const fetched = morphoChains[index];
    rows.push(captureMorpho(chainId, fetched, book));
  }
  rows.push(captureVenus(venus));
  rows.push(captureLista(listaOverall, listaMarkets));

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

function captureVenus(result: { data: unknown; error: string | null }): LendingRow {
  if (result.error) {
    const row = parseVenusMarkets(null, VENUS_MARKETS);
    return { ...row, error: result.error };
  }
  return parseVenusMarkets(result.data, VENUS_MARKETS);
}

function captureLista(
  overall: { data: unknown; error: string | null },
  markets: { data: unknown; error: string | null },
): LendingRow {
  const row = overall.error
    ? { ...parseListaBStock(null, LISTA_OVERALL), error: overall.error }
    : parseListaBStock(overall.data, LISTA_OVERALL);
  if (markets.error || !Array.isArray(markets.data)) {
    if (markets.error && (row.collateralUsd !== null || row.stableBorrowedUsd !== null)) {
      return { ...row, error: row.error ?? `Lista borrow rates did not load (${markets.error}).` };
    }
    return row;
  }
  return withListaApy(row, markets.data);
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
