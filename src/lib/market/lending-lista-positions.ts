import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { bscBatchRotating, bscRpcUrls, tryEachUrl } from "./lending-bsc";
import { LENDING_PAST_LIMIT_USD, type PricedLoan } from "./lending-health";
import {
  missingVenusLogRanges,
  venusCoveredThrough,
  type LogRangeQuery,
} from "./lending-venus-estimate";

export const LISTA_MOOLAH = "0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C";
/** Borrow(bytes32,address,address,address,uint256,uint256). Topic 2 is the borrower. */
export const LISTA_BORROW_TOPIC = "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43";
export const LISTA_POSITION_SELECTOR = "0x93c52062";
export const LISTA_MARKET_SELECTOR = "0x5c60e39a";
const DECIMALS_SELECTOR = "0x313ce567";
/** Borrow logs exist on this contract by block 90 million. Earlier blocks are not scanned. */
export const LISTA_LOG_START_BLOCK = 90_000_000;
export const LISTA_LOG_SPAN = 100_000;
export const LISTA_LOG_MIN_SPAN = 5_000;
export const LISTA_SCAN_BUDGET_MS = 20 * 60 * 1000;
export const LISTA_BORROWER_CACHE_SCHEMA = "lista-borrower-cache-v1";

const LLTV_SCALE = BigInt(10) ** BigInt(18);
const ZERO = BigInt(0);
const ONE = BigInt(1);

export interface ListaMarketBook {
  id: string;
  collateralToken: string;
  loanToken: string;
  lltv: bigint;
}

export interface ListaBorrowerCache {
  schema: typeof LISTA_BORROWER_CACHE_SCHEMA;
  startBlock: number;
  ranges: LogRangeQuery[];
  borrowers: Record<string, string[]>;
}

export function listaScanBudgetMs(raw = process.env.LISTA_SCAN_BUDGET_MS): number {
  if (!raw) return LISTA_SCAN_BUDGET_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1_000) return LISTA_SCAN_BUDGET_MS;
  return parsed;
}

export function defaultListaBorrowerCachePath(): string {
  return `${process.cwd()}/data/lending-snapshots/lista-borrower-cache.json`;
}

export function borrowersFromBorrowLog(log: { topics?: readonly string[] }): { marketId: string; user: string } | null {
  const topics = log.topics ?? [];
  const market = topics[1]?.toLowerCase() ?? "";
  const userTopic = topics[2]?.toLowerCase() ?? "";
  if (!/^0x[0-9a-f]{64}$/.test(market)) return null;
  if (!/^0x[0-9a-f]{64}$/.test(userTopic)) return null;
  const user = `0x${userTopic.slice(-40)}`;
  if (user === "0x0000000000000000000000000000000000000000") return null;
  return { marketId: market, user };
}

export function parseListaBorrowerCache(payload: unknown): ListaBorrowerCache | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Partial<ListaBorrowerCache>;
  if (body.schema !== LISTA_BORROWER_CACHE_SCHEMA || body.startBlock !== LISTA_LOG_START_BLOCK) return null;
  if (!Array.isArray(body.ranges) || !body.borrowers || typeof body.borrowers !== "object") return null;
  const ranges: LogRangeQuery[] = [];
  for (const range of body.ranges) {
    if (!range || typeof range !== "object") continue;
    const row = range as Partial<LogRangeQuery>;
    if (!Number.isInteger(row.fromBlock) || !Number.isInteger(row.toBlock) || row.fromBlock === undefined || row.toBlock === undefined) continue;
    if (row.toBlock < row.fromBlock) continue;
    ranges.push({ fromBlock: row.fromBlock, toBlock: row.toBlock });
  }
  const borrowers: Record<string, string[]> = {};
  for (const [market, users] of Object.entries(body.borrowers)) {
    if (!/^0x[0-9a-f]{64}$/.test(market) || !Array.isArray(users)) continue;
    const clean = users.filter((user): user is string => typeof user === "string" && /^0x[0-9a-f]{40}$/.test(user));
    if (clean.length > 0) borrowers[market] = [...new Set(clean)];
  }
  return { schema: LISTA_BORROWER_CACHE_SCHEMA, startBlock: LISTA_LOG_START_BLOCK, ranges, borrowers };
}

/** Round borrow shares up to assets, the way Moolah bills the borrower. */
export function listaBorrowAssets(borrowShares: bigint, totalAssets: bigint, totalShares: bigint): bigint | null {
  if (borrowShares < ZERO || totalAssets < ZERO || totalShares < ZERO) return null;
  if (borrowShares === ZERO) return ZERO;
  if (totalShares === ZERO) return null;
  return (borrowShares * totalAssets + totalShares - ONE) / totalShares;
}

function tokenAmount(raw: bigint, decimals: number): number | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || raw < ZERO) return null;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale;
  const frac = raw % scale;
  const value = Number(whole) + Number(frac) / Number(scale);
  return Number.isFinite(value) ? value : null;
}

/**
 * One stock loan. Collateral and debt are priced in dollars.
 * A stock drop scales only the collateral, which is what the liquidation line uses.
 */
export function loanFromListaPosition(input: {
  collateralRaw: bigint;
  borrowShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lltv: bigint;
  collateralDecimals: number;
  loanDecimals: number;
  collateralPriceUsd: number | null;
  loanPriceUsd: number | null;
}): { loan: PricedLoan | null; unpriced: boolean } {
  const assets = listaBorrowAssets(input.borrowShares, input.totalBorrowAssets, input.totalBorrowShares);
  if (assets === null) return { loan: null, unpriced: input.borrowShares > ZERO };
  if (assets === ZERO) return { loan: null, unpriced: false };
  if (input.collateralRaw <= ZERO || input.lltv <= ZERO) return { loan: null, unpriced: true };
  if (input.collateralPriceUsd === null || !(input.collateralPriceUsd > 0) || input.loanPriceUsd === null || !(input.loanPriceUsd > 0)) {
    return { loan: null, unpriced: true };
  }
  const collateralTokens = tokenAmount(input.collateralRaw, input.collateralDecimals);
  const borrowTokens = tokenAmount(assets, input.loanDecimals);
  if (collateralTokens === null || borrowTokens === null || !(collateralTokens > 0)) return { loan: null, unpriced: true };
  const collateralUsd = collateralTokens * input.collateralPriceUsd;
  const debtUsd = borrowTokens * input.loanPriceUsd;
  if (!Number.isFinite(collateralUsd) || !Number.isFinite(debtUsd) || !(collateralUsd > 0)) return { loan: null, unpriced: true };
  const limit = collateralUsd * (Number(input.lltv) / Number(LLTV_SCALE));
  if (!(limit > 0) || !Number.isFinite(limit)) return { loan: null, unpriced: true };
  if (debtUsd - limit > LENDING_PAST_LIMIT_USD) return { loan: { collateralUsd, cushion: 0, alreadyPast: true }, unpriced: false };
  const cushion = 1 - debtUsd / limit;
  if (!Number.isFinite(cushion)) return { loan: null, unpriced: true };
  if (cushion <= 0) return { loan: { collateralUsd, cushion: 0, alreadyPast: true }, unpriced: false };
  return { loan: { collateralUsd, cushion: Math.min(1, cushion), alreadyPast: false }, unpriced: false };
}

export function listaBookCovers(pricedBorrowAssets: bigint, publishedBorrowAssets: bigint): boolean {
  if (publishedBorrowAssets <= ZERO) return pricedBorrowAssets === ZERO;
  if (pricedBorrowAssets < ZERO) return false;
  return pricedBorrowAssets * BigInt(100) >= publishedBorrowAssets * BigInt(98) && pricedBorrowAssets * BigInt(100) <= publishedBorrowAssets * BigInt(103);
}

function words(hex: string | null | undefined): bigint[] | null {
  if (!hex || hex === "0x") return null;
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length < 64 || body.length % 64 !== 0) return null;
  const out: bigint[] = [];
  for (let index = 0; index < body.length; index += 64) out.push(BigInt(`0x${body.slice(index, index + 64)}`));
  return out;
}

function padWord(hex: string): string {
  return hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function readCache(path: string): Promise<ListaBorrowerCache | null> {
  try {
    return parseListaBorrowerCache(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function writeCache(cache: ListaBorrowerCache, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache));
  await rename(tmp, path);
}

async function fetchLogsAt(url: string, range: LogRangeQuery): Promise<{ topics?: string[] }[]> {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          address: LISTA_MOOLAH,
          topics: [LISTA_BORROW_TOPIC],
          fromBlock: `0x${range.fromBlock.toString(16)}`,
          toBlock: `0x${range.toBlock.toString(16)}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as { result?: { topics?: string[] }[]; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || "eth_getLogs failed");
  if (!Array.isArray(payload.result)) throw new Error("eth_getLogs result was not a list");
  return payload.result;
}

function addBorrower(borrowers: Map<string, Set<string>>, marketId: string, user: string) {
  const set = borrowers.get(marketId) ?? new Set<string>();
  set.add(user);
  borrowers.set(marketId, set);
}

/**
 * Walk Borrow logs and remember every borrower.
 * A dropped range is split, then retried. Past the deadline the scan stops and keeps what it finished.
 */
export async function collectListaBorrowers(input: {
  startBlock: number;
  endBlock: number;
  ranges: readonly LogRangeQuery[];
  deadlineMs: number;
  borrowers: Map<string, Set<string>>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onRange?: (range: LogRangeQuery) => Promise<void>;
  getLogs: (range: LogRangeQuery) => Promise<{ topics?: string[] }[]>;
}): Promise<void> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const queue = [...input.ranges];
  let failure: string | null = null;
  async function readRange(range: LogRangeQuery): Promise<void> {
    if (now() >= input.deadlineMs) throw new Error("Lista log scan ran out of time.");
    let lastError = "log request failed";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (now() >= input.deadlineMs) throw new Error("Lista log scan ran out of time.");
      try {
        const logs = await input.getLogs(range);
        for (const log of logs) {
          const borrower = borrowersFromBorrowLog(log);
          if (borrower) addBorrower(input.borrowers, borrower.marketId, borrower.user);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        if (attempt < 2) await sleep(Math.min(800, 200 * 2 ** attempt));
      }
    }
    const width = range.toBlock - range.fromBlock;
    if (width > LISTA_LOG_MIN_SPAN) {
      const mid = range.fromBlock + Math.floor(width / 2);
      await readRange({ fromBlock: range.fromBlock, toBlock: mid });
      await readRange({ fromBlock: mid + 1, toBlock: range.toBlock });
      return;
    }
    throw new Error(lastError);
  }
  async function worker() {
    while (!failure) {
      const range = queue.shift();
      if (!range) return;
      try {
        await readRange(range);
        if (input.onRange) await input.onRange(range);
      } catch (error) {
        failure = error instanceof Error ? error.message : "Lista log scan failed";
      }
    }
  }
  const workers = Math.min(4, Math.max(queue.length, 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (failure) throw new Error(failure);
}

function cacheBorrowers(cache: ListaBorrowerCache): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [market, users] of Object.entries(cache.borrowers)) map.set(market, new Set(users));
  return map;
}

function snapshotBorrowers(map: Map<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [market, users] of map) out[market] = [...users];
  return out;
}

async function latestBlock(call: (calls: { method: string; params: unknown[] }[]) => Promise<(string | null)[]>): Promise<number> {
  const [hex] = await call([{ method: "eth_blockNumber", params: [] }]);
  if (!hex) throw new Error("BSC block number was missing.");
  return Number(BigInt(hex));
}

/**
 * Real Lista loans for the bStock markets that have a borrow.
 * Borrowers come from Moolah Borrow logs. Each position is read on chain.
 * The book is exact only when every market's debt is covered and the log scan reached the chain tip.
 */
export async function fetchListaStockLoans(input: {
  markets: readonly ListaMarketBook[];
  prices: ReadonlyMap<string, { collateralPriceUsd: number | null; loanPriceUsd: number | null }>;
  deadlineMs?: number;
  cachePath?: string | null;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  getLogs?: (range: LogRangeQuery) => Promise<{ topics?: string[] }[]>;
  call?: (calls: { method: string; params: unknown[] }[]) => Promise<(string | null)[]>;
}): Promise<{ loans: PricedLoan[]; unpricedLoanCount: number; source: string; complete: boolean }> {
  const source = "https://public-bsc.nownodes.io";
  const wanted = new Map(input.markets.map((market) => [market.id.toLowerCase(), market]));
  if (wanted.size === 0) return { loans: [], unpricedLoanCount: 0, source, complete: true };
  const now = input.now ?? Date.now;
  const deadline = now() + (input.deadlineMs ?? listaScanBudgetMs());
  const call = input.call ?? ((calls) => bscBatchRotating(calls));
  const getLogs = input.getLogs ?? ((range) => tryEachUrl(bscRpcUrls(), (url) => fetchLogsAt(url, range), { sleep: input.sleep }));
  const cachePath = input.cachePath === undefined ? defaultListaBorrowerCachePath() : input.cachePath;
  const stored = cachePath ? await readCache(cachePath) : null;
  const cache: ListaBorrowerCache = stored ?? {
    schema: LISTA_BORROWER_CACHE_SCHEMA,
    startBlock: LISTA_LOG_START_BLOCK,
    ranges: [],
    borrowers: {},
  };
  const borrowers = cacheBorrowers(cache);
  const endBlock = await latestBlock(call);
  const missing = missingVenusLogRanges(LISTA_LOG_START_BLOCK, endBlock, LISTA_LOG_SPAN, cache.ranges);
  let sinceWrite = 0;
  const persist = async (force = false) => {
    if (!cachePath) return;
    if (!force && sinceWrite < 5) return;
    sinceWrite = 0;
    cache.ranges = cache.ranges.slice();
    cache.borrowers = snapshotBorrowers(borrowers);
    try {
      await writeCache(cache, cachePath);
    } catch {
      // A missed cache write only makes the next scan repeat a range.
    }
  };
  if (missing.length > 0) {
    try {
      await collectListaBorrowers({
        startBlock: LISTA_LOG_START_BLOCK,
        endBlock,
        ranges: missing,
        deadlineMs: deadline,
        borrowers,
        now,
        sleep: input.sleep,
        getLogs,
        onRange: async (range) => {
          cache.ranges.push(range);
          sinceWrite += 1;
          await persist();
        },
      });
      await persist(true);
    } catch {
      await persist(true);
      return { loans: [], unpricedLoanCount: 0, source, complete: false };
    }
  }
  if (venusCoveredThrough(LISTA_LOG_START_BLOCK, cache.ranges) < endBlock || now() >= deadline) {
    return { loans: [], unpricedLoanCount: 0, source, complete: false };
  }

  const tokens = [...new Set(input.markets.flatMap((market) => [market.collateralToken.toLowerCase(), market.loanToken.toLowerCase()]))];
  const decimalResults = await call(tokens.map((token) => ({ method: "eth_call", params: [{ to: token, data: DECIMALS_SELECTOR }, "latest"] })));
  const decimals = new Map<string, number>();
  tokens.forEach((token, index) => {
    const hex = decimalResults[index];
    if (!hex || hex === "0x") return;
    try {
      const value = Number(BigInt(hex));
      if (Number.isInteger(value) && value >= 0 && value <= 36) decimals.set(token, value);
    } catch {
      // A missing decimal leaves that market unpriced.
    }
  });

  const loans: PricedLoan[] = [];
  let unpricedLoanCount = 0;
  for (const market of wanted.values()) {
    if (now() >= deadline) return { loans: [], unpricedLoanCount: 0, source, complete: false };
    const users = [...(borrowers.get(market.id.toLowerCase()) ?? [])];
    const marketCall = { method: "eth_call", params: [{ to: LISTA_MOOLAH, data: LISTA_MARKET_SELECTOR + padWord(market.id) }, "latest"] };
    const positionCalls = users.map((user) => ({
      method: "eth_call",
      params: [{ to: LISTA_MOOLAH, data: LISTA_POSITION_SELECTOR + padWord(market.id) + padWord(user) }, "latest"],
    }));
    const results = await call([marketCall, ...positionCalls]);
    const marketWords = words(results[0]);
    const totalBorrowAssets = marketWords?.[2] ?? null;
    const totalBorrowShares = marketWords?.[3] ?? null;
    if (totalBorrowAssets === null || totalBorrowShares === null) return { loans: [], unpricedLoanCount: 0, source, complete: false };
    const prices = input.prices.get(market.id.toLowerCase());
    const collateralDecimals = decimals.get(market.collateralToken.toLowerCase());
    const loanDecimals = decimals.get(market.loanToken.toLowerCase());
    let pricedAssets = ZERO;
    if (collateralDecimals === undefined || loanDecimals === undefined) {
      if (totalBorrowAssets > ZERO) return { loans: [], unpricedLoanCount: 0, source, complete: false };
      continue;
    }
    for (let index = 0; index < users.length; index += 1) {
      const position = words(results[index + 1]);
      if (!position || position.length < 3) {
        unpricedLoanCount += 1;
        continue;
      }
      const read = loanFromListaPosition({
        collateralRaw: position[2] ?? ZERO,
        borrowShares: position[1] ?? ZERO,
        totalBorrowAssets,
        totalBorrowShares,
        lltv: market.lltv,
        collateralDecimals,
        loanDecimals,
        collateralPriceUsd: prices?.collateralPriceUsd ?? null,
        loanPriceUsd: prices?.loanPriceUsd ?? null,
      });
      if (read.loan) {
        const assets = listaBorrowAssets(position[1] ?? ZERO, totalBorrowAssets, totalBorrowShares);
        if (assets !== null) pricedAssets += assets;
        loans.push(read.loan);
      } else if (read.unpriced) unpricedLoanCount += 1;
    }
    if (!listaBookCovers(pricedAssets, totalBorrowAssets)) return { loans: [], unpricedLoanCount: 0, source, complete: false };
  }
  return { loans, unpricedLoanCount, source, complete: true };
}
