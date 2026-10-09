import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bscBatchRotating, bscRpcUrls, padAddress, topicAddress } from "./lending-bsc";

export const VENUS_CORE_COMPTROLLER = "0xfd36e2c2a6789db23113685031d7f16329158384";
export const VENUS_CORE_POOL = "https://api.venus.io/markets/core-pool?chainId=56&limit=100";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BALANCE_OF = "0x70a08231";
const BORROW_BALANCE = "0x95dd9193";
const CHECK_MEMBERSHIP = "0x929fe9a1";
/** bStocks were listed after this BSC block. */
export const VENUS_LOG_START_BLOCK = 104_000_000;
const LOG_START_BLOCK = VENUS_LOG_START_BLOCK;
/** NowNodes serves about 10k historical blocks before the request gets slow. */
const LOG_SPAN = 10_000;
const LOG_MIN_SPAN = 2_000;
/**
 * Cold log scans of the older BSC ranges take well under an hour at this span.
 * A warm cache only reads blocks since the last snapshot. Override with VENUS_SCAN_BUDGET_MS.
 */
export const VENUS_SCAN_BUDGET_MS = 60 * 60 * 1000;

export function venusScanBudgetMs(raw = process.env.VENUS_SCAN_BUDGET_MS): number {
  if (!raw) return VENUS_SCAN_BUDGET_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1_000) return VENUS_SCAN_BUDGET_MS;
  return parsed;
}
const ZERO = "0x0000000000000000000000000000000000000000";

export interface VenusAccountBorrow {
  borrowUsd: number;
  bstockBorrowPowerUsd: number;
  totalBorrowPowerUsd: number;
}

export interface VenusBorrowEstimate {
  usd: number;
  lowerBoundUsd: number | null;
  method: string;
  asOf: string;
  block: number | null;
}

/**
 * Checked onchain Oct 8, 2026, ~8:20 PM Mountain Time, BSC block ~126.55M.
 * Used only when the live pro-rata scan does not finish.
 */
export const VENUS_CHECKED_ESTIMATE: VenusBorrowEstimate = {
  usd: 255_389.46046163054,
  lowerBoundUsd: 195_590.93156447148,
  asOf: "2026-10-09T02:20:00.000Z",
  block: 126_550_000,
  method:
    "Pro-rata from onchain balances at BSC block about 126.55 million, checked Oct 8, 2026 at 8:20 PM Mountain Time. Each account's borrow is multiplied by the share of its borrowing power that comes from bStock collateral. The live scan did not refresh this figure.",
};

/** Empty input stays missing. A finished scan with no borrows is a real zero. */
export function attributeVenusBorrow(accounts: readonly VenusAccountBorrow[]): {
  estimateUsd: number;
  lowerBoundUsd: number;
  onlyBstockAccounts: number;
} | null {
  if (accounts.length === 0) return null;
  let estimate = 0;
  let lower = 0;
  let only = 0;
  for (const account of accounts) {
    if (!(account.totalBorrowPowerUsd > 0) || !(account.borrowUsd >= 0) || !Number.isFinite(account.borrowUsd)) continue;
    const share = account.bstockBorrowPowerUsd / account.totalBorrowPowerUsd;
    if (!Number.isFinite(share) || share < 0) continue;
    const capped = Math.min(share, 1);
    estimate += account.borrowUsd * capped;
    if (capped >= 0.999) {
      lower += account.borrowUsd;
      only += 1;
    }
  }
  return { estimateUsd: estimate, lowerBoundUsd: lower, onlyBstockAccounts: only };
}

interface CoreMarket {
  vToken: string;
  underlying: string;
  symbol: string;
  category: string;
  comptroller: string;
  collateralFactor: number;
  exchangeRate: bigint;
  priceMantissa: bigint;
}

const ZERO_WORD = BigInt(0);
const ONE_MILLION = BigInt(1_000_000);
const TEN = BigInt(10);
const SUPPLY_SCALE = TEN ** BigInt(54);
const BORROW_SCALE = TEN ** BigInt(36);

function bigintDiv(numerator: bigint, denominator: bigint): number {
  if (denominator <= ZERO_WORD) return 0;
  const whole = numerator / denominator;
  const frac = ((numerator % denominator) * ONE_MILLION) / denominator;
  return Number(whole) + Number(frac) / 1_000_000;
}

function word(hex: string | null | undefined): bigint {
  if (!hex || hex === "0x") return ZERO_WORD;
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const wordHex = body.slice(0, 64) || "0";
  return BigInt(`0x${wordHex}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function venusCollateralHint(payload: unknown): number | null {
  const root = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(root?.result) ? root.result : [];
  let sum = 0;
  let seen = false;
  for (const item of list) {
    const row = asRecord(item);
    if (!row || row.category !== "bstocks") continue;
    const cents = Number(row.totalSupplyUnderlyingCents);
    if (!Number.isFinite(cents) || cents < 0) continue;
    sum += cents / 100;
    seen = true;
  }
  return seen ? sum : null;
}

function parseCoreMarkets(payload: unknown): CoreMarket[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload) ? payload : Array.isArray(root?.result) ? root.result : [];
  const markets: CoreMarket[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const vToken = typeof row.address === "string" ? row.address.toLowerCase() : "";
    const underlying = typeof row.underlyingAddress === "string" ? row.underlyingAddress.toLowerCase() : "";
    const comptroller = typeof row.poolComptrollerAddress === "string" ? row.poolComptrollerAddress.toLowerCase() : "";
    if (!vToken || !underlying || comptroller !== VENUS_CORE_COMPTROLLER) continue;
    const factorRaw = Number(row.collateralFactorMantissa);
    const factor = Number.isFinite(factorRaw) ? (factorRaw > 5 ? factorRaw / 1e18 : factorRaw) : 0;
    let exchangeRate = ZERO_WORD;
    let priceMantissa = ZERO_WORD;
    try {
      exchangeRate = BigInt(String(row.exchangeRateMantissa ?? "0"));
      priceMantissa = BigInt(String(row.underlyingPriceMantissa ?? "0"));
    } catch {
      continue;
    }
    markets.push({
      vToken,
      underlying,
      symbol: typeof row.underlyingSymbol === "string" ? row.underlyingSymbol : vToken,
      category: typeof row.category === "string" ? row.category : "",
      comptroller,
      collateralFactor: factor,
      exchangeRate,
      priceMantissa,
    });
  }
  return markets;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(45_000),
    headers: {
      accept: "application/json",
      "accept-version": "stable",
      "user-agent": "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function latestBlock(): Promise<number> {
  const [hex] = await bscBatchRotating([{ method: "eth_blockNumber", params: [] }]);
  if (!hex) throw new Error("BSC block number was missing.");
  return Number(BigInt(hex));
}

export interface LogRangeQuery {
  fromBlock: number;
  toBlock: number;
}

const SCAN_TIMEOUT = "Venus log scan ran out of time.";

/**
 * Read Transfer logs. A dropped response is retried with backoff.
 * If the range still fails, it is split in half down to minSpan.
 * Past deadlineMs the scan stops so the caller can keep the last good estimate.
 */
export async function collectHolderAddresses(input: {
  vTokens: readonly string[];
  startBlock: number;
  endBlock: number;
  initialSpan: number;
  minSpan: number;
  deadlineMs: number;
  /** When set, these ranges are scanned instead of slicing startBlock..endBlock. */
  ranges?: readonly LogRangeQuery[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  concurrency?: number;
  onRange?: (range: LogRangeQuery, addresses: ReadonlySet<string>) => void | Promise<void>;
  getLogs: (range: LogRangeQuery) => Promise<{ topics?: string[] }[]>;
}): Promise<Set<string>> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = input.attempts ?? 3;
  const addresses = new Set<string>();
  const queue: LogRangeQuery[] = input.ranges ? [...input.ranges] : [];
  if (!input.ranges) {
    for (let start = input.startBlock; start <= input.endBlock; start += input.initialSpan) {
      queue.push({ fromBlock: start, toBlock: Math.min(start + input.initialSpan - 1, input.endBlock) });
    }
  }
  let failure: string | null = null;

  async function readRange(range: LogRangeQuery): Promise<void> {
    if (now() >= input.deadlineMs) throw new Error(SCAN_TIMEOUT);
    let lastError = "log request failed";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (now() >= input.deadlineMs) throw new Error(SCAN_TIMEOUT);
      try {
        const logs = await input.getLogs(range);
        for (const log of logs) {
          for (const topic of (log.topics ?? []).slice(1, 3)) {
            const address = topicAddress(topic);
            if (address !== ZERO) addresses.add(address);
          }
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "eth_getLogs failed";
        if (attempt < attempts - 1) {
          const wait = Math.min(1_200, 300 * 2 ** attempt);
          const room = input.deadlineMs - now();
          if (room <= 0) throw new Error(SCAN_TIMEOUT);
          await sleep(Math.min(wait, room));
        }
      }
    }
    const width = range.toBlock - range.fromBlock;
    if (width > input.minSpan) {
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
        if (input.onRange) await input.onRange(range, addresses);
      } catch (error) {
        failure = error instanceof Error ? error.message : "Venus log scan failed";
      }
    }
  }
  const workers = Math.min(input.concurrency ?? 4, Math.max(queue.length, 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (failure) throw new Error(failure);
  return addresses;
}

async function fetchLogsAt(url: string, vTokens: readonly string[], range: LogRangeQuery): Promise<{ topics?: string[] }[]> {
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
          address: vTokens,
          topics: [TRANSFER_TOPIC],
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

async function fetchLogsRotating(vTokens: readonly string[], range: LogRangeQuery): Promise<{ topics?: string[] }[]> {
  let last = "eth_getLogs failed";
  for (const url of bscRpcUrls()) {
    try {
      return await fetchLogsAt(url, vTokens, range);
    } catch (error) {
      last = error instanceof Error ? error.message : last;
    }
  }
  throw new Error(last);
}

/** A finished live scan wins. Otherwise keep the newest saved estimate and its original time. */
export function chooseVenusEstimate(
  live: VenusBorrowEstimate | null,
  previous: VenusBorrowEstimate | null,
  checked: VenusBorrowEstimate,
): VenusBorrowEstimate {
  if (live && Number.isFinite(live.usd)) return live;
  const base = previous && Number.isFinite(previous.usd) && previous.asOf ? previous : checked;
  const note = "The live scan did not refresh this figure.";
  return { ...base, method: base.method.includes(note) ? base.method : `${base.method} ${note}` };
}

export function venusEstimateFromSnapshot(
  day: { rows: readonly { id: string; stableBorrowedUsd: number | null; borrowEstimate?: { method: string; asOf: string; lowerBoundUsd: number | null } | null }[] } | null,
): VenusBorrowEstimate | null {
  const row = day?.rows.find((item) => item.id === "venus-bnb" && item.borrowEstimate && item.stableBorrowedUsd !== null);
  if (!row?.borrowEstimate || row.stableBorrowedUsd === null) return null;
  return {
    usd: row.stableBorrowedUsd,
    lowerBoundUsd: row.borrowEstimate.lowerBoundUsd,
    method: row.borrowEstimate.method,
    asOf: row.borrowEstimate.asOf,
    block: null,
  };
}

function supplyUsd(vTokenBalance: bigint, market: CoreMarket): number {
  if (vTokenBalance <= ZERO_WORD || market.exchangeRate <= ZERO_WORD || market.priceMantissa <= ZERO_WORD) return 0;
  return bigintDiv(vTokenBalance * market.exchangeRate * market.priceMantissa, SUPPLY_SCALE);
}

function borrowUsd(raw: bigint, market: CoreMarket): number {
  if (raw <= ZERO_WORD || market.priceMantissa <= ZERO_WORD) return 0;
  return bigintDiv(raw * market.priceMantissa, BORROW_SCALE);
}

export const VENUS_HOLDER_CACHE_SCHEMA = "venus-holder-cache-v1";

export interface VenusHolderCache {
  schema: typeof VENUS_HOLDER_CACHE_SCHEMA;
  vTokens: string[];
  startBlock: number;
  ranges: LogRangeQuery[];
  addresses: string[];
}

export function defaultVenusHolderCachePath(): string {
  return join(process.cwd(), "data", "lending-snapshots", "venus-holder-cache.json");
}

export function normalizeVenusRanges(ranges: readonly LogRangeQuery[]): LogRangeQuery[] {
  const sorted = ranges
    .filter((range) => Number.isInteger(range.fromBlock) && Number.isInteger(range.toBlock) && range.toBlock >= range.fromBlock)
    .map((range) => ({ fromBlock: range.fromBlock, toBlock: range.toBlock }))
    .sort((a, b) => a.fromBlock - b.fromBlock || a.toBlock - b.toBlock);
  const merged: LogRangeQuery[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.fromBlock > last.toBlock + 1) merged.push({ ...range });
    else last.toBlock = Math.max(last.toBlock, range.toBlock);
  }
  return merged;
}

/** Last block of the contiguous scanned prefix that begins at startBlock. */
export function venusCoveredThrough(startBlock: number, ranges: readonly LogRangeQuery[]): number {
  let cursor = startBlock - 1;
  for (const range of normalizeVenusRanges(ranges)) {
    if (range.fromBlock > cursor + 1) break;
    if (range.toBlock > cursor) cursor = range.toBlock;
  }
  return cursor;
}

export function venusCacheMatches(cache: VenusHolderCache | null, startBlock: number, vTokens: readonly string[]): cache is VenusHolderCache {
  if (!cache || cache.schema !== VENUS_HOLDER_CACHE_SCHEMA || cache.startBlock !== startBlock) return false;
  const cached = [...cache.vTokens].map((token) => token.toLowerCase()).sort().join(",");
  const next = [...vTokens].map((token) => token.toLowerCase()).sort().join(",");
  return cached === next;
}

/** Inclusive chunks of `span` inside [start, end] that the cache does not already cover. */
export function missingVenusLogRanges(
  startBlock: number,
  endBlock: number,
  span: number,
  covered: readonly LogRangeQuery[],
): LogRangeQuery[] {
  if (endBlock < startBlock || span < 1) return [];
  const merged = normalizeVenusRanges(covered);
  const missing: LogRangeQuery[] = [];
  const push = (from: number, to: number) => {
    for (let cursor = from; cursor <= to; cursor += span) {
      missing.push({ fromBlock: cursor, toBlock: Math.min(cursor + span - 1, to) });
    }
  };
  let cursor = startBlock;
  for (const range of merged) {
    if (range.toBlock < cursor) continue;
    if (range.fromBlock > endBlock) break;
    const gapEnd = Math.min(range.fromBlock - 1, endBlock);
    if (range.fromBlock > cursor) push(cursor, gapEnd);
    cursor = Math.max(cursor, range.toBlock + 1);
    if (cursor > endBlock) return missing;
  }
  if (cursor <= endBlock) push(cursor, endBlock);
  return missing;
}

export function parseVenusHolderCache(payload: unknown): VenusHolderCache | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Partial<VenusHolderCache>;
  const startBlock = body.startBlock;
  if (body.schema !== VENUS_HOLDER_CACHE_SCHEMA || typeof startBlock !== "number" || !Number.isInteger(startBlock)) return null;
  if (!Array.isArray(body.vTokens) || !body.vTokens.every((token) => typeof token === "string")) return null;
  if (!Array.isArray(body.ranges) || !Array.isArray(body.addresses)) return null;
  const ranges: LogRangeQuery[] = [];
  for (const range of body.ranges) {
    if (!range || typeof range !== "object") continue;
    const row = range as Partial<LogRangeQuery>;
    const fromBlock = row.fromBlock;
    const toBlock = row.toBlock;
    if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock === undefined || toBlock === undefined || toBlock < fromBlock) continue;
    ranges.push({ fromBlock, toBlock });
  }
  const addresses = body.addresses.filter((address): address is string => typeof address === "string" && /^0x[0-9a-fA-F]{40}$/.test(address));
  return {
    schema: VENUS_HOLDER_CACHE_SCHEMA,
    vTokens: body.vTokens.map((token) => token.toLowerCase()),
    startBlock,
    ranges,
    addresses: [...new Set(addresses.map((address) => address.toLowerCase()))],
  };
}

async function readVenusHolderCache(path: string): Promise<VenusHolderCache | null> {
  try {
    return parseVenusHolderCache(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function writeVenusHolderCache(cache: VenusHolderCache, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cache));
  await rename(tmp, path);
}

/**
 * Live pro-rata scan. Returns null when the chain read fails or the
 * bStock supply it finds is far from the Venus API collateral.
 * Finished log ranges are cached so the next run only scans new blocks.
 */
export async function scanVenusBStockBorrow(nowMs = Date.now(), cachePath = defaultVenusHolderCachePath()): Promise<VenusBorrowEstimate | null> {
  const deadline = Date.now() + venusScanBudgetMs();
  const cacheState: VenusHolderCache = {
    schema: VENUS_HOLDER_CACHE_SCHEMA,
    vTokens: [],
    startBlock: LOG_START_BLOCK,
    ranges: [],
    addresses: [],
  };
  let sinceWrite = 0;
  const persist = async (force = false) => {
    if (!force && sinceWrite < 20) return;
    sinceWrite = 0;
    try {
      await writeVenusHolderCache(cacheState, cachePath);
    } catch {
      // A cache miss next time is slower. It does not change the estimate.
    }
  };
  try {
    const payload = await getJson(VENUS_CORE_POOL);
    const markets = parseCoreMarkets(payload);
    const bstocks = markets.filter((market) => market.category === "bstocks");
    if (bstocks.length === 0 || markets.length === 0) return null;
    const collateralHintUsd = venusCollateralHint(payload);
    const endBlock = await latestBlock();
    const vTokens = bstocks.map((market) => market.vToken);
    const stored = await readVenusHolderCache(cachePath);
    const reusable = venusCacheMatches(stored, LOG_START_BLOCK, vTokens) ? stored : null;
    cacheState.vTokens = vTokens.map((token) => token.toLowerCase());
    cacheState.ranges = reusable ? [...reusable.ranges] : [];
    cacheState.addresses = reusable ? [...reusable.addresses] : [];
    const holders = new Set(cacheState.addresses);
    const missing = missingVenusLogRanges(LOG_START_BLOCK, endBlock, LOG_SPAN, cacheState.ranges);
    if (missing.length > 0) {
      await collectHolderAddresses({
        vTokens,
        startBlock: LOG_START_BLOCK,
        endBlock,
        initialSpan: LOG_SPAN,
        minSpan: LOG_MIN_SPAN,
        deadlineMs: deadline,
        ranges: missing,
        concurrency: 8,
        onRange: async (range, found) => {
          cacheState.ranges.push(range);
          for (const address of found) holders.add(address);
          cacheState.addresses = [...holders];
          sinceWrite += 1;
          await persist();
        },
        getLogs: (range) => fetchLogsRotating(vTokens, range),
      });
      cacheState.addresses = [...holders];
      await persist(true);
    }
    if (holders.size === 0 || Date.now() >= deadline) return null;

    const holderList = [...holders];
    const balanceCalls = holderList.flatMap((account) =>
      bstocks.map((market) => ({
        method: "eth_call",
        params: [{ to: market.vToken, data: BALANCE_OF + padAddress(account) }, "latest"],
      })),
    );
    const balances = await bscBatchRotating(balanceCalls);
    const active: string[] = [];
    holderList.forEach((account, holderIndex) => {
      const stillHolds = bstocks.some((_, marketIndex) => word(balances[holderIndex * bstocks.length + marketIndex]) > ZERO_WORD);
      if (stillHolds) active.push(account);
    });
    if (active.length === 0) return null;

    const accounts: VenusAccountBorrow[] = [];
    let supplied = 0;
    for (const account of active) {
      if (Date.now() >= deadline) return null;
      const calls = markets.flatMap((market) => [
        { method: "eth_call", params: [{ to: market.vToken, data: BORROW_BALANCE + padAddress(account) }, "latest"] },
        { method: "eth_call", params: [{ to: market.vToken, data: BALANCE_OF + padAddress(account) }, "latest"] },
        {
          method: "eth_call",
          params: [
            {
              to: VENUS_CORE_COMPTROLLER,
              data: CHECK_MEMBERSHIP + padAddress(account) + padAddress(market.vToken),
            },
            "latest",
          ],
        },
      ]);
      const results = await bscBatchRotating(calls);
      let borrow = 0;
      let power = 0;
      let bPower = 0;
      markets.forEach((market, index) => {
        const borrowed = borrowUsd(word(results[index * 3]), market);
        const supply = supplyUsd(word(results[index * 3 + 1]), market);
        const entered = word(results[index * 3 + 2]) > ZERO_WORD;
        if (borrowed > 0.01) borrow += borrowed;
        if (market.category === "bstocks") supplied += supply;
        if (entered) {
          const borrowPower = supply * market.collateralFactor;
          power += borrowPower;
          if (market.category === "bstocks") bPower += borrowPower;
        }
      });
      accounts.push({ borrowUsd: borrow, bstockBorrowPowerUsd: bPower, totalBorrowPowerUsd: power });
    }
    if (collateralHintUsd !== null && collateralHintUsd > 0) {
      const ratio = supplied / collateralHintUsd;
      if (!(ratio > 0.7 && ratio < 1.4)) return null;
    }
    const attributed = attributeVenusBorrow(accounts);
    if (!attributed) return null;
    return {
      usd: attributed.estimateUsd,
      lowerBoundUsd: attributed.lowerBoundUsd,
      asOf: new Date(nowMs).toISOString(),
      block: endBlock,
      method: `Pro-rata from onchain balances at BSC block ${endBlock.toLocaleString("en-US")}. Each account's borrow is multiplied by the share of its borrowing power that comes from bStock collateral.`,
    };
  } catch {
    if (cacheState.vTokens.length > 0) await persist(true);
    return null;
  }
}
