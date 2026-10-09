import { bscBatch, bscCallRpc, BSC_LOG_RPC, padAddress, topicAddress } from "./lending-bsc";

export const VENUS_CORE_COMPTROLLER = "0xfd36e2c2a6789db23113685031d7f16329158384";
export const VENUS_CORE_POOL = "https://api.venus.io/markets/core-pool?chainId=56&limit=100";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BALANCE_OF = "0x70a08231";
const BORROW_BALANCE = "0x95dd9193";
const CHECK_MEMBERSHIP = "0x929fe9a1";
/** bStocks were listed after this BSC block. */
const LOG_START_BLOCK = 104_000_000;
const LOG_SPAN = 49_999;
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

async function transferAddresses(vTokens: readonly string[], endBlock: number): Promise<Set<string>> {
  const addresses = new Set<string>();
  const ranges: number[] = [];
  for (let start = LOG_START_BLOCK; start <= endBlock; start += LOG_SPAN + 1) ranges.push(start);
  let cursor = 0;
  const failures: string[] = [];
  async function worker() {
    while (cursor < ranges.length) {
      const start = ranges[cursor];
      cursor += 1;
      const to = Math.min(start + LOG_SPAN, endBlock);
      let lastError = "log request failed";
      let logs: { topics?: string[] }[] | null = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          const response = await fetch(BSC_LOG_RPC, {
            method: "POST",
            signal: AbortSignal.timeout(60_000),
            headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_getLogs",
              params: [
                {
                  address: vTokens,
                  topics: [TRANSFER_TOPIC],
                  fromBlock: `0x${start.toString(16)}`,
                  toBlock: `0x${to.toString(16)}`,
                },
              ],
            }),
          });
          const payload = (await response.json()) as { result?: { topics?: string[] }[]; error?: { message?: string } };
          if (payload.error) throw new Error(payload.error.message || "eth_getLogs failed");
          if (!Array.isArray(payload.result)) throw new Error("eth_getLogs result was not a list");
          logs = payload.result;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "eth_getLogs failed";
          await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 500 * 2 ** attempt)));
        }
      }
      if (!logs) {
        failures.push(lastError);
        return;
      }
      for (const log of logs) {
        for (const topic of (log.topics ?? []).slice(1, 3)) {
          const address = topicAddress(topic);
          if (address !== ZERO) addresses.add(address);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ranges.length) }, () => worker()));
  if (failures.length > 0) throw new Error(failures[0] ?? "Venus log scan failed");
  return addresses;
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
  try {
    const payload = await getJson(VENUS_CORE_POOL);
    const markets = parseCoreMarkets(payload);
    const bstocks = markets.filter((market) => market.category === "bstocks");
    if (bstocks.length === 0 || markets.length === 0) return null;
    const collateralHintUsd = venusCollateralHint(payload);
    const rpc = bscCallRpc();
    const endBlock = await latestBlock(rpc);
    const holders = [...(await transferAddresses(bstocks.map((market) => market.vToken), endBlock))];
    if (holders.length === 0) return null;

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
