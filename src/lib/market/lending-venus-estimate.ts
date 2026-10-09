import { bscBatch, bscCallRpc, BSC_LOG_RPC, padAddress, topicAddress } from "./lending-bsc";

export const VENUS_CORE_COMPTROLLER = "0xfd36e2c2a6789db23113685031d7f16329158384";
export const VENUS_CORE_POOL = "https://api.venus.io/markets/core-pool?chainId=56&limit=100";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BALANCE_OF = "0x70a08231";
const BORROW_BALANCE = "0x95dd9193";
const CHECK_MEMBERSHIP = "0x929fe9a1";
/** bStocks were listed after this BSC block. */
const LOG_START_BLOCK = 104_000_000;
const LOG_SPAN = 50_000;
const LOG_MIN_SPAN = 5_000;
/** Stop the live scan and keep the last good estimate after this long. */
export const VENUS_SCAN_BUDGET_MS = 180_000;
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

async function latestBlock(rpc: string): Promise<number> {
  const [hex] = await bscBatch(rpc, [{ method: "eth_blockNumber", params: [] }]);
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
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  concurrency?: number;
  getLogs: (range: LogRangeQuery) => Promise<{ topics?: string[] }[]>;
}): Promise<Set<string>> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = input.attempts ?? 3;
  const addresses = new Set<string>();
  const queue: LogRangeQuery[] = [];
  for (let start = input.startBlock; start <= input.endBlock; start += input.initialSpan) {
    queue.push({ fromBlock: start, toBlock: Math.min(start + input.initialSpan - 1, input.endBlock) });
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

async function fetchPocketLogs(vTokens: readonly string[], range: LogRangeQuery): Promise<{ topics?: string[] }[]> {
  const response = await fetch(BSC_LOG_RPC, {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
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

/**
 * Live pro-rata scan. Returns null when the chain read fails or the
 * bStock supply it finds is far from the Venus API collateral.
 */
export async function scanVenusBStockBorrow(nowMs = Date.now()): Promise<VenusBorrowEstimate | null> {
  const deadline = Date.now() + VENUS_SCAN_BUDGET_MS;
  try {
    const payload = await getJson(VENUS_CORE_POOL);
    const markets = parseCoreMarkets(payload);
    const bstocks = markets.filter((market) => market.category === "bstocks");
    if (bstocks.length === 0 || markets.length === 0) return null;
    const collateralHintUsd = venusCollateralHint(payload);
    const rpc = bscCallRpc();
    const endBlock = await latestBlock(rpc);
    const vTokens = bstocks.map((market) => market.vToken);
    const holders = [
      ...(await collectHolderAddresses({
        vTokens,
        startBlock: LOG_START_BLOCK,
        endBlock,
        initialSpan: LOG_SPAN,
        minSpan: LOG_MIN_SPAN,
        deadlineMs: deadline,
        getLogs: (range) => fetchPocketLogs(vTokens, range),
      })),
    ];
    if (holders.length === 0 || Date.now() >= deadline) return null;

    const balanceCalls = holders.flatMap((account) =>
      bstocks.map((market) => ({
        method: "eth_call",
        params: [{ to: market.vToken, data: BALANCE_OF + padAddress(account) }, "latest"],
      })),
    );
    const balances = await bscBatch(rpc, balanceCalls);
    const active: string[] = [];
    holders.forEach((account, holderIndex) => {
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
      const results = await bscBatch(rpc, calls);
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
    return null;
  }
}
