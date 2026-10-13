import { LENDING_PAST_LIMIT_USD, type PricedLoan } from "./lending-health";
import { tryEachUrl } from "./lending-bsc";
import { DEFAULT_SOLANA_RPC_URL } from "./solana-supply";

/** Kamino Lend program. Obligations are accounts this program owns. */
export const KLEND_PROGRAM_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";

/**
 * Account size from klend-sdk 13.0.2: 8-byte discriminator plus the zero-copy struct.
 * A public getProgramAccounts filter on this size and the market pubkey returns the Sentora loans.
 */
export const KAMINO_OBLIGATION_SIZE = 3344;

/** Anchor account discriminator for Obligation. */
export const KAMINO_OBLIGATION_DISCRIMINATOR = Uint8Array.from([168, 206, 141, 106, 88, 76, 172, 167]);

/** lending_market pubkey sits after the discriminator, tag, and LastUpdate. */
export const KAMINO_MARKET_OFFSET = 32;

const DEPOSIT_OFFSET = 96;
const DEPOSIT_STRIDE = 136;
const DEPOSIT_COUNT = 8;
const BORROW_FACTOR_DEBT_OFFSET = 2208;
const UNHEALTHY_OFFSET = 2256;
/** Kamino stores dollar values as a fraction scaled by 2^60. */
const ZERO = BigInt(0);
const ONE = BigInt(1);
const BYTE = BigInt(8);
const BASE = BigInt(58);
const FRACTION_SCALE = ONE << BigInt(60);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export interface KaminoDecodedDeposit {
  reserve: string;
  depositedAmount: bigint;
  marketValueUsd: number;
}

export interface KaminoDecodedObligation {
  lendingMarket: string;
  deposits: KaminoDecodedDeposit[];
  /** Borrow-factor-adjusted debt. This is what the program compares with the liquidation line. */
  debtUsd: number;
  unhealthyUsd: number;
}

export function solanaObligationRpcUrls(env: Readonly<Record<string, string | undefined>> = process.env): string[] {
  const preferred = env.SOLANA_RPC_URL?.trim();
  return [...new Set([preferred, DEFAULT_SOLANA_RPC_URL].filter((url): url is string => Boolean(url)))];
}

export function encodeBase58(bytes: Uint8Array): string {
  let value = ZERO;
  for (const byte of bytes) value = (value << BYTE) + BigInt(byte);
  const chars: string[] = [];
  while (value > ZERO) {
    const next = value / BASE;
    chars.push(BASE58[Number(value - next * BASE)] ?? "");
    value = next;
  }
  let zeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros += 1;
  }
  return `${"1".repeat(zeros)}${chars.reverse().join("") || (bytes.length > 0 && zeros === bytes.length ? "" : "1")}`;
}

function readU64(data: Uint8Array, offset: number): bigint {
  let value = ZERO;
  for (let index = 7; index >= 0; index -= 1) value = (value << BYTE) + BigInt(data[offset + index] ?? 0);
  return value;
}

function readU128(data: Uint8Array, offset: number): bigint {
  let value = ZERO;
  for (let index = 15; index >= 0; index -= 1) value = (value << BYTE) + BigInt(data[offset + index] ?? 0);
  return value;
}

function fractionUsd(raw: bigint): number {
  const whole = raw / FRACTION_SCALE;
  const frac = raw % FRACTION_SCALE;
  return Number(whole) + Number(frac) / Number(FRACTION_SCALE);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Null when the account is not a current Kamino obligation. */
export function decodeKaminoObligation(data: Uint8Array): KaminoDecodedObligation | null {
  if (data.length !== KAMINO_OBLIGATION_SIZE) return null;
  if (!sameBytes(data.subarray(0, KAMINO_OBLIGATION_DISCRIMINATOR.length), KAMINO_OBLIGATION_DISCRIMINATOR)) return null;
  const deposits: KaminoDecodedDeposit[] = [];
  for (let index = 0; index < DEPOSIT_COUNT; index += 1) {
    const start = DEPOSIT_OFFSET + index * DEPOSIT_STRIDE;
    const reserveBytes = data.subarray(start, start + 32);
    if (reserveBytes.every((byte) => byte === 0)) continue;
    const depositedAmount = readU64(data, start + 32);
    const marketValueUsd = fractionUsd(readU128(data, start + 40));
    if (depositedAmount === ZERO && !(marketValueUsd > 0)) continue;
    deposits.push({ reserve: encodeBase58(reserveBytes), depositedAmount, marketValueUsd });
  }
  return {
    lendingMarket: encodeBase58(data.subarray(KAMINO_MARKET_OFFSET, KAMINO_MARKET_OFFSET + 32)),
    deposits,
    debtUsd: fractionUsd(readU128(data, BORROW_FACTOR_DEBT_OFFSET)),
    unhealthyUsd: fractionUsd(readU128(data, UNHEALTHY_OFFSET)),
  };
}

/** Reserve address to liquidity mint, from Kamino reserve metrics. */
export function kaminoReserveMints(payload: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(payload)) return map;
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as { reserve?: unknown; liquidityTokenMint?: unknown };
    if (typeof row.reserve !== "string" || typeof row.liquidityTokenMint !== "string") continue;
    if (!row.reserve || !row.liquidityTokenMint) continue;
    map.set(row.reserve, row.liquidityTokenMint);
  }
  return map;
}

/**
 * Drop that lands on the liquidation line when only stock collateral falls.
 * Other collateral, such as a dollar coin, stays put.
 * Null when the line cannot be figured.
 */
export function kaminoStockCushion(input: {
  stockUsd: number;
  otherUsd: number;
  debtUsd: number;
  unhealthyUsd: number;
}): { cushion: number; alreadyPast: boolean } | null {
  if (!(input.unhealthyUsd > 0) || !Number.isFinite(input.unhealthyUsd) || !Number.isFinite(input.debtUsd)) return null;
  if (input.debtUsd - input.unhealthyUsd > LENDING_PAST_LIMIT_USD) return { cushion: 0, alreadyPast: true };
  const total = input.stockUsd + input.otherUsd;
  if (!(input.stockUsd > 0) || !(total > 0) || !Number.isFinite(total)) return null;
  const numer = (input.debtUsd / input.unhealthyUsd) * total - input.otherUsd;
  if (numer <= 0) return { cushion: 1, alreadyPast: false };
  const cushion = 1 - numer / input.stockUsd;
  if (!Number.isFinite(cushion)) return null;
  if (cushion <= 0) return { cushion: 0, alreadyPast: true };
  return { cushion, alreadyPast: false };
}

/**
 * One priced loan per obligation that locks stock and owes dollars.
 * A deposit whose reserve is not in the metrics list makes that loan unpriced.
 * Loans with no stock collateral are left out. They are not stock loans.
 */
export function loansFromKaminoObligations(input: {
  accounts: readonly Uint8Array[];
  reserveMints: ReadonlyMap<string, string>;
  equityMints: ReadonlySet<string>;
}): { loans: PricedLoan[]; unpricedLoanCount: number } {
  const loans: PricedLoan[] = [];
  let unpricedLoanCount = 0;
  for (const account of input.accounts) {
    const decoded = decodeKaminoObligation(account);
    if (!decoded) continue;
    if (!(decoded.debtUsd > LENDING_PAST_LIMIT_USD)) continue;
    let stockUsd = 0;
    let otherUsd = 0;
    let unpriced = false;
    let sawStock = false;
    for (const deposit of decoded.deposits) {
      const mint = input.reserveMints.get(deposit.reserve);
      if (!mint) {
        unpriced = true;
        continue;
      }
      const equity = input.equityMints.has(mint);
      if (equity) sawStock = true;
      if (!(deposit.marketValueUsd > 0)) {
        if (deposit.depositedAmount > ZERO) unpriced = true;
        continue;
      }
      if (equity) stockUsd += deposit.marketValueUsd;
      else otherUsd += deposit.marketValueUsd;
    }
    if (!sawStock && !unpriced) continue;
    if (unpriced || !(stockUsd > 0)) {
      unpricedLoanCount += 1;
      continue;
    }
    const health = kaminoStockCushion({
      stockUsd,
      otherUsd,
      debtUsd: decoded.debtUsd,
      unhealthyUsd: decoded.unhealthyUsd,
    });
    if (!health) {
      unpricedLoanCount += 1;
      continue;
    }
    loans.push({ collateralUsd: stockUsd, cushion: health.cushion, alreadyPast: health.alreadyPast });
  }
  return { loans, unpricedLoanCount };
}

interface ProgramAccount {
  account?: { data?: unknown };
}

function accountBytes(row: ProgramAccount): Uint8Array | null {
  const data = row.account?.data;
  const encoded = Array.isArray(data) ? data[0] : null;
  if (typeof encoded !== "string" || !encoded) return null;
  return Uint8Array.from(Buffer.from(encoded, "base64"));
}

/**
 * Read every obligation in one Kamino market.
 * Kamino's HTTP API lists a wallet's loans only when the wallet is already known, and the market-wide routes 404.
 * This uses Solana getProgramAccounts, filtered to klend obligations for that market.
 */
export async function fetchKaminoMarketObligations(
  market: string,
  options?: {
    rpcUrls?: readonly string[];
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ accounts: Uint8Array[]; source: string }> {
  const urls = options?.rpcUrls ?? solanaObligationRpcUrls();
  if (urls.length === 0) throw new Error("No Solana RPC is configured.");
  const fetchImpl = options?.fetchImpl ?? fetch;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "getProgramAccounts",
    params: [
      KLEND_PROGRAM_ID,
      {
        encoding: "base64",
        commitment: "confirmed",
        filters: [
          { dataSize: KAMINO_OBLIGATION_SIZE },
          { memcmp: { offset: 0, bytes: encodeBase58(KAMINO_OBLIGATION_DISCRIMINATOR) } },
          { memcmp: { offset: KAMINO_MARKET_OFFSET, bytes: market } },
        ],
      },
    ],
  });
  const source = await tryEachUrl(
    urls,
    async (url) => {
      const response = await fetchImpl(url, {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)" },
        body,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
      if (payload.error?.message) throw new Error(payload.error.message);
      if (!Array.isArray(payload.result)) throw new Error("Solana did not return a list of loans.");
      const accounts: Uint8Array[] = [];
      for (const item of payload.result) {
        if (!item || typeof item !== "object") continue;
        const bytes = accountBytes(item as ProgramAccount);
        if (bytes) accounts.push(bytes);
      }
      if (accounts.length === 0) throw new Error("Solana returned no Sentora loans.");
      return { accounts, source: url };
    },
    { sleep: options?.sleep },
  );
  return source;
}
