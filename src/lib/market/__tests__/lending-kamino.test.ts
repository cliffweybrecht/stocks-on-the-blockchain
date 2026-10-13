import { describe, expect, it } from "vitest";
import { bandsFromLoans, collateralAtRisk } from "../lending-health";
import { tryEachUrl } from "../lending-bsc";
import {
  KAMINO_OBLIGATION_DISCRIMINATOR,
  KAMINO_OBLIGATION_SIZE,
  decodeKaminoObligation,
  encodeBase58,
  fetchKaminoMarketObligations,
  kaminoStockCushion,
  loansFromKaminoObligations,
} from "../lending-kamino-obligations";

const SCALE = BigInt(1) << BigInt(60);
const MASK = BigInt(255);

function usdToSf(usd: number): bigint {
  return (BigInt(Math.round(usd * 1_000_000)) * SCALE) / BigInt(1_000_000);
}

function writeU64(data: Uint8Array, offset: number, value: bigint) {
  for (let index = 0; index < 8; index += 1) data[offset + index] = Number((value >> BigInt(index * 8)) & MASK);
}

function writeU128(data: Uint8Array, offset: number, value: bigint) {
  for (let index = 0; index < 16; index += 1) data[offset + index] = Number((value >> BigInt(index * 8)) & MASK);
}

function obligation(input: {
  reserve?: Uint8Array;
  stockUsd?: number;
  amount?: bigint;
  debtUsd?: number;
  unhealthyUsd?: number;
  second?: { reserve: Uint8Array; usd: number };
}): Uint8Array {
  const data = new Uint8Array(KAMINO_OBLIGATION_SIZE);
  data.set(KAMINO_OBLIGATION_DISCRIMINATOR, 0);
  const reserve = input.reserve ?? Uint8Array.from({ length: 32 }, () => 7);
  data.set(reserve, 96);
  writeU64(data, 96 + 32, input.amount ?? BigInt(1));
  writeU128(data, 96 + 40, usdToSf(input.stockUsd ?? 0));
  if (input.second) {
    data.set(input.second.reserve, 96 + 136);
    writeU64(data, 96 + 136 + 32, BigInt(1));
    writeU128(data, 96 + 136 + 40, usdToSf(input.second.usd));
  }
  writeU128(data, 2208, usdToSf(input.debtUsd ?? 0));
  writeU128(data, 2256, usdToSf(input.unhealthyUsd ?? 0));
  return data;
}

describe("kamino sentora obligations", () => {
  const reserve = Uint8Array.from({ length: 32 }, () => 7);
  const otherReserve = Uint8Array.from({ length: 32 }, () => 9);
  const stockMint = "StockMint111";
  const otherMint = "PyusdMint111";

  it("reads each stock loan and leaves an unknown reserve unpriced", () => {
    expect(encodeBase58(KAMINO_OBLIGATION_DISCRIMINATOR)).toBe("VEdzkJnDweW");
    const tight = obligation({ reserve, stockUsd: 100, debtUsd: 70, unhealthyUsd: 79 });
    const room = obligation({
      reserve,
      stockUsd: 100,
      debtUsd: 90,
      unhealthyUsd: 150,
      second: { reserve: otherReserve, usd: 100 },
    });
    const mystery = obligation({ reserve: Uint8Array.from({ length: 32 }, () => 4), stockUsd: 50, debtUsd: 10, unhealthyUsd: 40 });
    const idle = obligation({ reserve, stockUsd: 80, debtUsd: 0, unhealthyUsd: 60 });
    const mints = new Map([
      [encodeBase58(reserve), stockMint],
      [encodeBase58(otherReserve), otherMint],
    ]);
    const read = loansFromKaminoObligations({
      accounts: [tight, room, mystery, idle, new Uint8Array(10)],
      reserveMints: mints,
      equityMints: new Set([stockMint]),
    });
    expect(read.unpricedLoanCount).toBe(1);
    expect(read.loans).toHaveLength(2);
    const bands = bandsFromLoans(read.loans);
    expect(collateralAtRisk(bands, 0.1)).toBe(0);
    expect(collateralAtRisk(bands, 0.2)).toBeCloseTo(100, 4);
    expect(collateralAtRisk(bands, 0.5)).toBeCloseTo(100, 4);
    expect(kaminoStockCushion({ stockUsd: 100, otherUsd: 0, debtUsd: 80, unhealthyUsd: 79 })?.alreadyPast).toBe(true);
    expect(decodeKaminoObligation(new Uint8Array(4))).toBeNull();
  });

  it("tries the next Solana RPC when the first loan read fails", async () => {
    const account = obligation({ reserve, stockUsd: 10, debtUsd: 4, unhealthyUsd: 8 });
    const calls: string[] = [];
    const result = await fetchKaminoMarketObligations("Market111", {
      rpcUrls: ["https://rpc.example/a", "https://rpc.example/b"],
      sleep: async () => undefined,
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).endsWith("/a")) throw new Error("timeout");
        return new Response(
          JSON.stringify({
            result: [{ account: { data: [Buffer.from(account).toString("base64"), "base64"] } }],
          }),
          { status: 200 },
        );
      },
    });
    expect(calls).toEqual(["https://rpc.example/a", "https://rpc.example/b"]);
    expect(result.source).toBe("https://rpc.example/b");
    expect(result.accounts).toHaveLength(1);
    await expect(
      tryEachUrl(["https://rpc.example/a"], async () => {
        throw new Error("down");
      }, { rounds: 2, sleep: async () => undefined }),
    ).rejects.toThrow(/down/);
  });
});
