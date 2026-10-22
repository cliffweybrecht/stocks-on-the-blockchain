import { describe, expect, it } from "vitest";
import {
  JUPITER_POSITION_DISCRIMINATOR,
  JUPITER_POSITION_SIZE,
  JUPITER_TICK_DISCRIMINATOR,
  JUPITER_TICK_SIZE,
  decodeJupiterExchangePrices,
  decodeJupiterPosition,
  fetchJupiterStockLoans,
  jupiterDebtCoversBook,
  jupiterRatioAtTick,
  jupiterStockCushion,
  jupiterVaultMemcmp,
  loansFromJupiterVault,
  type JupiterVaultQuote,
} from "../lending-jupiter-positions";

function writeU32(data: Uint8Array, offset: number, value: number) {
  for (let index = 0; index < 4; index += 1) data[offset + index] = (value >> (8 * index)) & 255;
}

function writeU64(data: Uint8Array, offset: number, value: bigint) {
  for (let index = 0; index < 8; index += 1) data[offset + index] = Number((value >> BigInt(8 * index)) & BigInt(255));
}

function writeU128(data: Uint8Array, offset: number, value: bigint) {
  for (let index = 0; index < 16; index += 1) data[offset + index] = Number((value >> BigInt(8 * index)) & BigInt(255));
}

function positionBytes(): Uint8Array {
  const data = new Uint8Array(JUPITER_POSITION_SIZE);
  data.set(JUPITER_POSITION_DISCRIMINATOR, 0);
  data[8] = 7;
  writeU32(data, 51, 1);
  writeU64(data, 55, BigInt("100000000000"));
  return data;
}

function tickBytes(totalIds = 1): Uint8Array {
  const data = new Uint8Array(JUPITER_TICK_SIZE);
  data.set(JUPITER_TICK_DISCRIMINATOR, 0);
  writeU32(data, 15, totalIds);
  return data;
}

function quote(totalBorrowBase: bigint, vaultType = 0): JupiterVaultQuote {
  return {
    id: 7,
    supplyMint: "stock",
    borrowMint: "usdc",
    supplyDecimals: 8,
    borrowDecimals: 6,
    supplyPriceUsd: 100,
    borrowPriceUsd: 1,
    liquidationThreshold: 0.75,
    vaultType,
    totalBorrowBase,
  };
}

const EXCHANGE = BigInt(10) ** BigInt(12);

describe("jupiter stock loans", () => {
  it("uses the same tick ladder as the vault program", () => {
    expect(jupiterRatioAtTick(0)).toBe(BigInt(1) << BigInt(48));
    expect(jupiterVaultMemcmp(84)).toBe("7Pm");
  });

  it("reads a position and prices a healthy loan", () => {
    const decoded = decodeJupiterPosition(positionBytes());
    expect(decoded?.vaultId).toBe(7);
    expect(decoded?.supplyRaw).toBe(BigInt("100000000000"));
    expect(jupiterStockCushion(100, 50, 0.75)?.cushion).toBeCloseTo(1 / 3, 12);
    expect(jupiterStockCushion(100, 80, 0.75)?.alreadyPast).toBe(true);
    const prices = new Uint8Array(64);
    writeU128(prices, 32, EXCHANGE);
    writeU128(prices, 48, EXCHANGE);
    expect(decodeJupiterExchangePrices(Buffer.from(prices).toString("base64"))).toEqual({ supply: EXCHANGE, borrow: EXCHANGE });
    const read = loansFromJupiterVault({
      quote: quote(BigInt(1)),
      positions: [positionBytes()],
      ticks: new Map([[0, { tick: 0, liquidated: false, totalIds: 1 }]]),
      supplyExchangePrice: EXCHANGE,
      borrowExchangePrice: EXCHANGE,
    });
    expect(read.debtBase).toBe(BigInt(100000000));
    expect(read.loans[0]?.collateralUsd).toBe(10000);
    expect(read.loans[0]?.cushion).toBeCloseTo(1 - 100 / 7500, 12);
    expect(read.loans[0]?.alreadyPast).toBe(false);
    expect(jupiterDebtCoversBook(BigInt(95), BigInt(100))).toBe(true);
    expect(jupiterDebtCoversBook(BigInt(94), BigInt(100))).toBe(false);
  });

  it("leaves a liquidated tick unpriced", () => {
    const read = loansFromJupiterVault({
      quote: quote(BigInt(1)),
      positions: [positionBytes()],
      ticks: new Map([[0, { tick: 0, liquidated: false, totalIds: 5 }]]),
      supplyExchangePrice: EXCHANGE,
      borrowExchangePrice: EXCHANGE,
    });
    expect(read.loans).toEqual([]);
    expect(read.unpricedLoanCount).toBe(1);
    expect(read.debtBase).toBe(BigInt(0));
  });

  it("tries the next Solana RPC when the first one fails", async () => {
    const seen: string[] = [];
    const account = (bytes: Uint8Array) => ({
      pubkey: "11111111111111111111111111111111",
      account: { data: [Buffer.from(bytes).toString("base64"), "base64"] },
    });
    const prices = new Uint8Array(64);
    writeU128(prices, 32, EXCHANGE);
    writeU128(prices, 48, EXCHANGE);
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push(url);
      if (url.includes("fail")) return { ok: false, status: 503, json: async () => ({}) } as Response;
      const body = JSON.parse(String(init?.body)) as { method?: string; params?: { filters?: { dataSize?: number }[] }[] };
      if (body.method === "simulateTransaction") {
        return {
          ok: true,
          json: async () => ({ result: { value: { err: null, returnData: { data: [Buffer.from(prices).toString("base64"), "base64"] } } } }),
        } as Response;
      }
      const size = body.params?.[1]?.filters?.find((filter) => filter.dataSize)?.dataSize;
      const bytes = size === JUPITER_POSITION_SIZE ? positionBytes() : size === JUPITER_TICK_SIZE ? tickBytes() : new Uint8Array(8);
      return { ok: true, json: async () => ({ result: [account(bytes)] }) } as Response;
    }) as typeof fetch;
    const vaults = [
      {
        id: 7,
        type: 0,
        supplyToken: { address: "stock", decimals: 8, price: "100" },
        borrowToken: { address: "usdc", decimals: 6, price: "1" },
        liquidationThreshold: "750",
        totalBorrow: "100000000",
      },
    ];
    const read = await fetchJupiterStockLoans(vaults, new Set(["stock"]), {
      rpcUrls: ["https://fail.example", "https://ok.example"],
      fetchImpl,
      sleep: async () => {},
    });
    expect(seen[0]).toBe("https://fail.example");
    expect(read.source).toBe("https://ok.example");
    expect(read.loans).toHaveLength(1);
    expect(read.loans[0]?.collateralUsd).toBe(10000);
    await expect(
      fetchJupiterStockLoans([{ ...vaults[0], type: 2 }], new Set(["stock"]), {
        rpcUrls: ["https://ok.example"],
        fetchImpl,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/plain vault/);
  });
});
