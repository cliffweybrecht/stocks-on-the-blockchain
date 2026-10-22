import { LENDING_PAST_LIMIT_USD, type PricedLoan } from "./lending-health";
import { tryEachUrl } from "./lending-bsc";
import { encodeBase58, solanaObligationRpcUrls } from "./lending-kamino-obligations";

/** Jupiter Lend vaults program, main market. */
export const JUPITER_VAULTS_PROGRAM_ID = "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi";
/** Jupiter Lend liquidity program, main market. Reserves live here. */
export const JUPITER_LIQUIDITY_PROGRAM_ID = "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC";

export const JUPITER_POSITION_DISCRIMINATOR = Uint8Array.from([170, 188, 143, 228, 122, 64, 247, 208]);
export const JUPITER_TICK_DISCRIMINATOR = Uint8Array.from([176, 94, 67, 247, 133, 173, 7, 115]);
export const JUPITER_VAULT_STATE_DISCRIMINATOR = Uint8Array.from([228, 196, 82, 165, 98, 210, 235, 152]);
export const JUPITER_VAULT_CONFIG_DISCRIMINATOR = Uint8Array.from([99, 86, 43, 216, 184, 102, 119, 77]);
export const JUPITER_RESERVE_DISCRIMINATOR = Uint8Array.from([21, 18, 59, 135, 120, 20, 31, 12]);

export const JUPITER_POSITION_SIZE = 71;
export const JUPITER_TICK_SIZE = 40;
export const JUPITER_VAULT_STATE_SIZE = 127;
export const JUPITER_VAULT_CONFIG_SIZE = 219;
export const JUPITER_RESERVE_SIZE = 192;

/** Empty tick stored on a supply-only position. */
export const JUPITER_INIT_TICK = -2147483648;
const MIN_TICK = -16383;
const EXCHANGE_PRECISION = BigInt(10) ** BigInt(12);
const ZERO = BigInt(0);
const ONE = BigInt(1);
/** A signer the simulate call can charge. The instruction itself does not use it. */
const SIM_SIGNER = "HEyJLdMfZhhQ7FHCtjD5DWDFNFQhaeAVAsHeWqoY6dSD";
const GET_EXCHANGE_PRICES = Uint8Array.from([237, 128, 83, 152, 52, 21, 231, 86]);
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const RATIO_FACTORS = [
  BigInt("18446744073709551616"),
  BigInt("18419115400608638658"),
  BigInt("18391528108445969703"),
  BigInt("18336477419114433396"),
  BigInt("18226869890870665593"),
  BigInt("18009616477100071088"),
  BigInt("17582847377087825313"),
  BigInt("16759408633341240198"),
  BigInt("15226414841393184936"),
  BigInt("12568272644527235157"),
  BigInt("8563108841104354677"),
  BigInt("3975055583337633975"),
  BigInt("856577552520149366"),
  BigInt("39775317560084773"),
  BigInt(85764505686420),
  BigInt(398745188),
];

export interface JupiterDecodedPosition {
  vaultId: number;
  nftId: number;
  supplyOnly: boolean;
  tick: number;
  tickId: number;
  supplyRaw: bigint;
  dustDebtRaw: bigint;
}

export interface JupiterDecodedTick {
  tick: number;
  liquidated: boolean;
  totalIds: number;
}

export interface JupiterVaultQuote {
  id: number;
  supplyMint: string;
  borrowMint: string;
  supplyDecimals: number;
  borrowDecimals: number;
  supplyPriceUsd: number;
  borrowPriceUsd: number;
  /** 0.75 means the loan is liquidated at 75% of collateral. */
  liquidationThreshold: number;
  /** Vault type 0 is a plain one-collateral vault. Other types are left unpriced. */
  vaultType: number;
  totalBorrowBase: bigint;
}

/**
 * Collateral/debt ratio at a tick, scaled by 2^48.
 * This is the same ladder the Jupiter vaults program uses.
 */
export function jupiterRatioAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > 16383) throw new Error(`Tick ${tick} is outside the Jupiter ladder.`);
  const abs = Math.abs(tick);
  let factor = RATIO_FACTORS[0] ?? ZERO;
  if (abs & 1) factor = RATIO_FACTORS[1] ?? factor;
  for (let bit = 1; bit <= 15; bit += 1) {
    if (abs & (1 << bit)) factor = (factor * (RATIO_FACTORS[bit + 1] ?? ZERO)) >> BigInt(64);
  }
  let precision = ZERO;
  if (tick > 0) {
    const maxU128 = (ONE << BigInt(128)) - ONE;
    factor = maxU128 / factor;
    if (factor % BigInt(65536) !== ZERO) precision = ONE;
  }
  return (factor >> BigInt(16)) + precision;
}

/** Net debt raw for a position that has not been liquidated. */
export function jupiterHealthyDebtRaw(position: Pick<JupiterDecodedPosition, "tick" | "supplyRaw" | "dustDebtRaw" | "supplyOnly">): bigint {
  if (position.supplyOnly || position.tick <= MIN_TICK || position.tick === JUPITER_INIT_TICK) return ZERO;
  const ratio = jupiterRatioAtTick(position.tick);
  const debt = ((ratio * (position.supplyRaw + ONE)) >> BigInt(48)) + ONE;
  return debt > position.dustDebtRaw ? debt - position.dustDebtRaw : ZERO;
}

/**
 * Token base units from a vault raw amount.
 * Jupiter stores amounts in a 9-decimal internal scale, then applies the vault exchange price.
 */
export function jupiterTokenBaseUnits(raw: bigint, exchangePrice: bigint, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || exchangePrice <= ZERO || raw < ZERO) return null;
  const scale = BigInt(10) ** BigInt(Math.max(0, 9 - decimals));
  return (raw * exchangePrice) / EXCHANGE_PRECISION / scale;
}

export function jupiterStockCushion(collateralUsd: number, debtUsd: number, liquidationThreshold: number): { cushion: number; alreadyPast: boolean } | null {
  if (!(collateralUsd > 0) || !(debtUsd > 0) || !(liquidationThreshold > 0) || liquidationThreshold > 1.05) return null;
  if (!Number.isFinite(collateralUsd) || !Number.isFinite(debtUsd)) return null;
  const limit = collateralUsd * liquidationThreshold;
  if (debtUsd - limit > LENDING_PAST_LIMIT_USD) return { cushion: 0, alreadyPast: true };
  const cushion = 1 - debtUsd / limit;
  if (!Number.isFinite(cushion)) return null;
  if (cushion <= 0) return { cushion: 0, alreadyPast: true };
  return { cushion: Math.min(1, cushion), alreadyPast: false };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) + ((data[offset + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  let value = 0;
  for (let index = 0; index < 4; index += 1) value += (data[offset + index] ?? 0) << (8 * index);
  return value >>> 0;
}

function readI32(data: Uint8Array, offset: number): number {
  const value = readU32(data, offset);
  return value > 0x7fffffff ? value - 0x100000000 : value;
}

function readU64(data: Uint8Array, offset: number): bigint {
  let value = ZERO;
  for (let index = 0; index < 8; index += 1) value += BigInt(data[offset + index] ?? 0) << BigInt(8 * index);
  return value;
}

function readU128(data: Uint8Array, offset: number): bigint {
  let value = ZERO;
  for (let index = 0; index < 16; index += 1) value += BigInt(data[offset + index] ?? 0) << BigInt(8 * index);
  return value;
}

export function decodeBase58(text: string): Uint8Array {
  let value = ZERO;
  for (const char of text) {
    const index = BASE58.indexOf(char);
    if (index < 0) throw new Error("Address was not base58.");
    value = value * BigInt(58) + BigInt(index);
  }
  const bytes: number[] = [];
  while (value > ZERO) {
    bytes.push(Number(value & BigInt(255)));
    value >>= BigInt(8);
  }
  let zeros = 0;
  for (const char of text) {
    if (char !== "1") break;
    zeros += 1;
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let index = 0; index < bytes.length; index += 1) out[out.length - 1 - index] = bytes[index] ?? 0;
  return out;
}

export function decodeJupiterPosition(data: Uint8Array): JupiterDecodedPosition | null {
  if (data.length !== JUPITER_POSITION_SIZE) return null;
  if (!sameBytes(data.subarray(0, 8), JUPITER_POSITION_DISCRIMINATOR)) return null;
  return {
    vaultId: readU16(data, 8),
    nftId: readU32(data, 10),
    supplyOnly: data[46] === 1,
    tick: readI32(data, 47),
    tickId: readU32(data, 51),
    supplyRaw: readU64(data, 55),
    dustDebtRaw: readU64(data, 63),
  };
}

export function decodeJupiterTick(data: Uint8Array): JupiterDecodedTick | null {
  if (data.length !== JUPITER_TICK_SIZE) return null;
  if (!sameBytes(data.subarray(0, 8), JUPITER_TICK_DISCRIMINATOR)) return null;
  return { tick: readI32(data, 10), liquidated: data[14] === 1, totalIds: readU32(data, 15) };
}

export function jupiterVaultMemcmp(vaultId: number): string {
  if (!Number.isInteger(vaultId) || vaultId < 0 || vaultId > 0xffff) throw new Error("Vault id is not a Jupiter vault id.");
  return encodeBase58(Uint8Array.from([vaultId & 0xff, (vaultId >> 8) & 0xff]));
}

function tokenUsd(baseUnits: bigint, decimals: number, priceUsd: number): number | null {
  if (!(priceUsd > 0) || !Number.isFinite(priceUsd)) return null;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = baseUnits / scale;
  const frac = baseUnits % scale;
  const tokens = Number(whole) + Number(frac) / Number(scale);
  if (!Number.isFinite(tokens) || tokens < 0) return null;
  const usd = tokens * priceUsd;
  return Number.isFinite(usd) ? usd : null;
}

export function loansFromJupiterVault(input: {
  quote: JupiterVaultQuote;
  positions: readonly Uint8Array[];
  ticks: ReadonlyMap<number, JupiterDecodedTick>;
  supplyExchangePrice: bigint;
  borrowExchangePrice: bigint;
}): { loans: PricedLoan[]; unpricedLoanCount: number; debtBase: bigint } {
  const loans: PricedLoan[] = [];
  let unpricedLoanCount = 0;
  let debtBase = ZERO;
  if (input.quote.vaultType !== 0) return { loans, unpricedLoanCount: 0, debtBase };
  for (const bytes of input.positions) {
    const position = decodeJupiterPosition(bytes);
    if (!position || position.vaultId !== input.quote.id || position.supplyRaw <= ZERO) continue;
    const debtRaw = jupiterHealthyDebtRaw(position);
    if (debtRaw <= ZERO) continue;
    const tick = input.ticks.get(position.tick);
    const liquidated = !tick || tick.liquidated || tick.totalIds > position.tickId;
    if (liquidated) {
      unpricedLoanCount += 1;
      continue;
    }
    const supplyBase = jupiterTokenBaseUnits(position.supplyRaw, input.supplyExchangePrice, input.quote.supplyDecimals);
    const borrowBase = jupiterTokenBaseUnits(debtRaw, input.borrowExchangePrice, input.quote.borrowDecimals);
    const collateralUsd = supplyBase === null ? null : tokenUsd(supplyBase, input.quote.supplyDecimals, input.quote.supplyPriceUsd);
    const debtUsd = borrowBase === null ? null : tokenUsd(borrowBase, input.quote.borrowDecimals, input.quote.borrowPriceUsd);
    if (collateralUsd === null || debtUsd === null || !(collateralUsd > 0) || !(debtUsd > 0)) {
      unpricedLoanCount += 1;
      continue;
    }
    const health = jupiterStockCushion(collateralUsd, debtUsd, input.quote.liquidationThreshold);
    if (!health) {
      unpricedLoanCount += 1;
      continue;
    }
    debtBase += borrowBase ?? ZERO;
    loans.push({ collateralUsd, cushion: health.cushion, alreadyPast: health.alreadyPast });
  }
  return { loans, unpricedLoanCount, debtBase };
}

/** True when priced debt covers nearly all of the published borrow. A short book is not treated as exact. */
export function jupiterDebtCoversBook(pricedDebtBase: bigint, publishedBorrowBase: bigint): boolean {
  if (publishedBorrowBase <= ZERO) return pricedDebtBase === ZERO;
  if (pricedDebtBase < ZERO) return false;
  return pricedDebtBase * BigInt(100) >= publishedBorrowBase * BigInt(95);
}

interface RpcAccount {
  account?: { data?: unknown };
  pubkey?: unknown;
}

function accountBytes(row: RpcAccount): Uint8Array | null {
  const data = row.account?.data;
  const encoded = Array.isArray(data) ? data[0] : null;
  if (typeof encoded !== "string" || !encoded) return null;
  return Uint8Array.from(Buffer.from(encoded, "base64"));
}

async function rpcCall(
  url: string,
  method: string,
  params: unknown[],
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    signal: AbortSignal.timeout(45_000),
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error?.message) throw new Error(payload.error.message);
  return payload.result;
}

async function programAccounts(
  url: string,
  program: string,
  filters: unknown[],
  fetchImpl: typeof fetch,
): Promise<RpcAccount[]> {
  const result = await rpcCall(
    url,
    "getProgramAccounts",
    [program, { encoding: "base64", commitment: "confirmed", filters }],
    fetchImpl,
  );
  if (!Array.isArray(result)) throw new Error("Solana did not return a list of accounts.");
  return result.filter((item): item is RpcAccount => Boolean(item) && typeof item === "object");
}

function compactU16(value: number): Buffer {
  if (value < 128) return Buffer.from([value]);
  return Buffer.from([(value & 0x7f) | 0x80, value >> 7]);
}

function legacyTransaction(keys: Uint8Array[], programIndex: number, accountIndexes: number[], data: Uint8Array): string {
  const header = Buffer.from([1, 0, keys.length - 1]);
  const accounts = Buffer.concat([compactU16(keys.length), ...keys.map((key) => Buffer.from(key))]);
  const instruction = Buffer.concat([
    compactU16(1),
    Buffer.from([programIndex]),
    compactU16(accountIndexes.length),
    Buffer.from(accountIndexes),
    compactU16(data.length),
    Buffer.from(data),
  ]);
  const message = Buffer.concat([header, accounts, Buffer.alloc(32, 1), instruction]);
  return Buffer.concat([compactU16(1), Buffer.alloc(64), message]).toString("base64");
}

export function decodeJupiterExchangePrices(base64: string): { supply: bigint; borrow: bigint } | null {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.length < 64) return null;
  return { supply: readU128(bytes, 32), borrow: readU128(bytes, 48) };
}

async function exchangePrices(
  url: string,
  accounts: { state: string; config: string; supplyReserve: string; borrowReserve: string },
  fetchImpl: typeof fetch,
): Promise<{ supply: bigint; borrow: bigint }> {
  const keys = [
    decodeBase58(SIM_SIGNER),
    decodeBase58(JUPITER_VAULTS_PROGRAM_ID),
    decodeBase58(accounts.state),
    decodeBase58(accounts.config),
    decodeBase58(accounts.supplyReserve),
    decodeBase58(accounts.borrowReserve),
  ];
  for (const key of keys) {
    if (key.length !== 32) throw new Error("A Jupiter account address was the wrong length.");
  }
  const tx = legacyTransaction(keys, 1, [2, 3, 4, 5], GET_EXCHANGE_PRICES);
  const result = (await rpcCall(
    url,
    "simulateTransaction",
    [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }],
    fetchImpl,
  )) as { value?: { err?: unknown; returnData?: { data?: unknown } } };
  if (result?.value?.err) throw new Error("Jupiter exchange prices did not simulate.");
  const data = result?.value?.returnData?.data;
  const encoded = Array.isArray(data) ? data[0] : null;
  if (typeof encoded !== "string") throw new Error("Jupiter exchange prices were missing.");
  const prices = decodeJupiterExchangePrices(encoded);
  if (!prices || prices.supply <= ZERO || prices.borrow <= ZERO) throw new Error("Jupiter exchange prices were empty.");
  return prices;
}

function finitePrice(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function jupiterQuotesFromVaults(payload: unknown, equityMints: ReadonlySet<string>): JupiterVaultQuote[] {
  if (!Array.isArray(payload)) return [];
  const quotes: JupiterVaultQuote[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const vault = item as {
      id?: unknown;
      type?: unknown;
      supplyToken?: { address?: unknown; decimals?: unknown; price?: unknown };
      borrowToken?: { address?: unknown; decimals?: unknown; price?: unknown };
      liquidationThreshold?: unknown;
      totalBorrow?: unknown;
    };
    const mint = typeof vault.supplyToken?.address === "string" ? vault.supplyToken.address : "";
    if (!mint || !equityMints.has(mint)) continue;
    const id = typeof vault.id === "number" ? vault.id : Number(vault.id);
    const supplyDecimals = Number(vault.supplyToken?.decimals);
    const borrowDecimals = Number(vault.borrowToken?.decimals);
    const supplyPrice = finitePrice(vault.supplyToken?.price);
    const borrowPrice = finitePrice(vault.borrowToken?.price);
    const threshold = Number(vault.liquidationThreshold) / 1000;
    const borrowMint = typeof vault.borrowToken?.address === "string" ? vault.borrowToken.address : "";
    let totalBorrow = ZERO;
    try {
      totalBorrow = BigInt(typeof vault.totalBorrow === "string" || typeof vault.totalBorrow === "number" ? String(vault.totalBorrow) : "0");
    } catch {
      totalBorrow = ZERO;
    }
    if (!Number.isInteger(id) || !borrowMint || supplyPrice === null || borrowPrice === null) continue;
    if (!Number.isInteger(supplyDecimals) || !Number.isInteger(borrowDecimals)) continue;
    quotes.push({
      id,
      supplyMint: mint,
      borrowMint,
      supplyDecimals,
      borrowDecimals,
      supplyPriceUsd: supplyPrice,
      borrowPriceUsd: borrowPrice,
      liquidationThreshold: threshold,
      vaultType: Number(vault.type ?? 0),
      totalBorrowBase: totalBorrow,
    });
  }
  return quotes;
}

async function oneAccount(
  url: string,
  program: string,
  filters: unknown[],
  fetchImpl: typeof fetch,
): Promise<{ pubkey: string; data: Uint8Array } | null> {
  const rows = await programAccounts(url, program, filters, fetchImpl);
  const row = rows[0];
  if (!row || typeof row.pubkey !== "string") return null;
  const data = accountBytes(row);
  if (!data) return null;
  return { pubkey: row.pubkey, data };
}

/**
 * Read every open stock loan on Jupiter Lend.
 * Positions are program accounts. Debt is the tick ratio. Prices are the vault's published token prices.
 * A book that does not cover the published borrow is rejected so a partial read is not called exact.
 */
export async function fetchJupiterStockLoans(
  vaults: unknown,
  equityMints: ReadonlySet<string>,
  options?: { rpcUrls?: readonly string[]; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> },
): Promise<{ loans: PricedLoan[]; unpricedLoanCount: number; source: string }> {
  const quotes = jupiterQuotesFromVaults(vaults, equityMints).filter((quote) => quote.totalBorrowBase > ZERO);
  if (quotes.length === 0) return { loans: [], unpricedLoanCount: 0, source: "https://lite-api.jup.ag/lend/v1/borrow/vaults" };
  if (quotes.some((quote) => quote.vaultType !== 0)) {
    throw new Error("A Jupiter stock vault is not a plain vault, so its loans were not priced.");
  }
  const urls = options?.rpcUrls ?? solanaObligationRpcUrls();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const positionDisc = encodeBase58(JUPITER_POSITION_DISCRIMINATOR);
  const tickDisc = encodeBase58(JUPITER_TICK_DISCRIMINATOR);
  const stateDisc = encodeBase58(JUPITER_VAULT_STATE_DISCRIMINATOR);
  const configDisc = encodeBase58(JUPITER_VAULT_CONFIG_DISCRIMINATOR);
  const reserveDisc = encodeBase58(JUPITER_RESERVE_DISCRIMINATOR);
  return tryEachUrl(
    urls,
    async (url) => {
      const loans: PricedLoan[] = [];
      let unpricedLoanCount = 0;
      let pricedDebt = ZERO;
      let published = ZERO;
      for (const quote of quotes) {
        published += quote.totalBorrowBase;
        const vaultFilter = jupiterVaultMemcmp(quote.id);
        const [positionRows, tickRows, state, config, supplyReserve, borrowReserve] = await Promise.all([
          programAccounts(
            url,
            JUPITER_VAULTS_PROGRAM_ID,
            [
              { dataSize: JUPITER_POSITION_SIZE },
              { memcmp: { offset: 0, bytes: positionDisc } },
              { memcmp: { offset: 8, bytes: vaultFilter } },
            ],
            fetchImpl,
          ),
          programAccounts(
            url,
            JUPITER_VAULTS_PROGRAM_ID,
            [
              { dataSize: JUPITER_TICK_SIZE },
              { memcmp: { offset: 0, bytes: tickDisc } },
              { memcmp: { offset: 8, bytes: vaultFilter } },
            ],
            fetchImpl,
          ),
          oneAccount(
            url,
            JUPITER_VAULTS_PROGRAM_ID,
            [
              { dataSize: JUPITER_VAULT_STATE_SIZE },
              { memcmp: { offset: 0, bytes: stateDisc } },
              { memcmp: { offset: 8, bytes: vaultFilter } },
            ],
            fetchImpl,
          ),
          oneAccount(
            url,
            JUPITER_VAULTS_PROGRAM_ID,
            [
              { dataSize: JUPITER_VAULT_CONFIG_SIZE },
              { memcmp: { offset: 0, bytes: configDisc } },
              { memcmp: { offset: 8, bytes: vaultFilter } },
            ],
            fetchImpl,
          ),
          oneAccount(
            url,
            JUPITER_LIQUIDITY_PROGRAM_ID,
            [
              { dataSize: JUPITER_RESERVE_SIZE },
              { memcmp: { offset: 0, bytes: reserveDisc } },
              { memcmp: { offset: 8, bytes: quote.supplyMint } },
            ],
            fetchImpl,
          ),
          oneAccount(
            url,
            JUPITER_LIQUIDITY_PROGRAM_ID,
            [
              { dataSize: JUPITER_RESERVE_SIZE },
              { memcmp: { offset: 0, bytes: reserveDisc } },
              { memcmp: { offset: 8, bytes: quote.borrowMint } },
            ],
            fetchImpl,
          ),
        ]);
        if (!state || !config || !supplyReserve || !borrowReserve) throw new Error(`Jupiter vault ${quote.id} was missing an account.`);
        const prices = await exchangePrices(
          url,
          { state: state.pubkey, config: config.pubkey, supplyReserve: supplyReserve.pubkey, borrowReserve: borrowReserve.pubkey },
          fetchImpl,
        );
        const ticks = new Map<number, JupiterDecodedTick>();
        for (const row of tickRows) {
          const bytes = accountBytes(row);
          const tick = bytes ? decodeJupiterTick(bytes) : null;
          if (tick) ticks.set(tick.tick, tick);
        }
        const read = loansFromJupiterVault({
          quote,
          positions: positionRows.flatMap((row) => {
            const bytes = accountBytes(row);
            return bytes ? [bytes] : [];
          }),
          ticks,
          supplyExchangePrice: prices.supply,
          borrowExchangePrice: prices.borrow,
        });
        loans.push(...read.loans);
        unpricedLoanCount += read.unpricedLoanCount;
        pricedDebt += read.debtBase;
      }
      if (!jupiterDebtCoversBook(pricedDebt, published)) {
        throw new Error("Jupiter priced loans did not cover the published borrow.");
      }
      return { loans, unpricedLoanCount, source: url };
    },
    { sleep: options?.sleep },
  );
}
