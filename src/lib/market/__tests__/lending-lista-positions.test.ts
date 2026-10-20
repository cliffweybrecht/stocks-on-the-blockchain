import { describe, expect, it } from "vitest";
import {
  LISTA_BORROW_TOPIC,
  LISTA_LOG_START_BLOCK,
  LISTA_MARKET_SELECTOR,
  LISTA_POSITION_SELECTOR,
  borrowersFromBorrowLog,
  collectListaBorrowers,
  fetchListaStockLoans,
  listaBookCovers,
  listaBorrowAssets,
  loanFromListaPosition,
} from "../lending-lista-positions";

const MARKET = `0x${"ab".repeat(32)}`;
const USER = `0x${"11".repeat(20)}`;
const USER_TOPIC = `0x${USER.slice(2).padStart(64, "0")}`;
const COLLATERAL = `0x${"22".repeat(20)}`;
const LOAN = `0x${"33".repeat(20)}`;
const LLTV = BigInt("750000000000000000");
const E18 = BigInt(10) ** BigInt(18);

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function abi(values: readonly bigint[]): string {
  return `0x${values.map((value) => value.toString(16).padStart(64, "0")).join("")}`;
}

describe("lista stock loans", () => {
  it("reads a borrower out of a Borrow log", () => {
    expect(borrowersFromBorrowLog({ topics: [LISTA_BORROW_TOPIC, MARKET, USER_TOPIC] })).toEqual({
      marketId: MARKET,
      user: USER,
    });
    expect(borrowersFromBorrowLog({ topics: [LISTA_BORROW_TOPIC, MARKET] })).toBeNull();
  });

  it("rounds borrow shares up and prices the cushion", () => {
    expect(listaBorrowAssets(BigInt(3), BigInt(10), BigInt(4))).toBe(BigInt(8));
    expect(listaBookCovers(BigInt(98), BigInt(100))).toBe(true);
    expect(listaBookCovers(BigInt(97), BigInt(100))).toBe(false);
    expect(listaBookCovers(BigInt(104), BigInt(100))).toBe(false);
    const priced = loanFromListaPosition({
      collateralRaw: BigInt(2000) * E18,
      borrowShares: BigInt(1000) * E18,
      totalBorrowAssets: BigInt(1000) * E18,
      totalBorrowShares: BigInt(1000) * E18,
      lltv: LLTV,
      collateralDecimals: 18,
      loanDecimals: 18,
      collateralPriceUsd: 2,
      loanPriceUsd: 1,
    });
    expect(priced.unpriced).toBe(false);
    expect(priced.loan?.collateralUsd).toBe(4000);
    expect(priced.loan?.cushion).toBeCloseTo(2 / 3, 8);
    expect(loanFromListaPosition({ ...pricedInput(), collateralPriceUsd: null }).unpriced).toBe(true);
  });

  it("splits a log range that the node refuses, then keeps the borrower", async () => {
    const borrowers = new Map<string, Set<string>>();
    const widths: number[] = [];
    await collectListaBorrowers({
      startBlock: 0,
      endBlock: 20_000,
      ranges: [{ fromBlock: 0, toBlock: 20_000 }],
      deadlineMs: Date.now() + 5_000,
      borrowers,
      sleep: async () => {},
      getLogs: async (range) => {
        const width = range.toBlock - range.fromBlock;
        widths.push(width);
        if (width > 5_000) throw new Error("too wide");
        if (range.fromBlock === 0) return [{ topics: [LISTA_BORROW_TOPIC, MARKET, USER_TOPIC] }];
        return [];
      },
    });
    expect(widths.some((width) => width > 5_000)).toBe(true);
    expect(borrowers.get(MARKET)?.has(USER)).toBe(true);
  });

  it("prices a finished cached range and refuses a book with no price", async () => {
    const call = async (calls: { method: string; params: unknown[] }[]) =>
      calls.map((item) => {
        if (item.method === "eth_blockNumber") return word(BigInt(LISTA_LOG_START_BLOCK));
        const params = item.params[0] as { to?: string; data?: string };
        if (params.data === "0x313ce567") return word(BigInt(18));
        if (params.data?.startsWith(LISTA_MARKET_SELECTOR)) return abi([BigInt(0), BigInt(0), BigInt(1000) * E18, BigInt(1000) * E18, BigInt(0), BigInt(0)]);
        if (params.data?.startsWith(LISTA_POSITION_SELECTOR)) return abi([BigInt(0), BigInt(1000) * E18, BigInt(2000) * E18]);
        return null;
      });
    const read = await fetchListaStockLoans({
      markets: [{ id: MARKET, collateralToken: COLLATERAL, loanToken: LOAN, lltv: LLTV }],
      prices: new Map([[MARKET, { collateralPriceUsd: 2, loanPriceUsd: 1 }]]),
      cachePath: null,
      now: () => 1_000,
      deadlineMs: 60_000,
      sleep: async () => {},
      getLogs: async () => [{ topics: [LISTA_BORROW_TOPIC, MARKET, USER_TOPIC] }],
      call,
    });
    expect(read.complete).toBe(true);
    expect(read.loans).toHaveLength(1);
    expect(read.loans[0]?.collateralUsd).toBe(4000);
    expect(read.loans[0]?.cushion).toBeCloseTo(2 / 3, 8);
    const missing = await fetchListaStockLoans({
      markets: [{ id: MARKET, collateralToken: COLLATERAL, loanToken: LOAN, lltv: LLTV }],
      prices: new Map([[MARKET, { collateralPriceUsd: null, loanPriceUsd: 1 }]]),
      cachePath: null,
      now: () => 1_000,
      deadlineMs: 60_000,
      sleep: async () => {},
      getLogs: async () => [{ topics: [LISTA_BORROW_TOPIC, MARKET, USER_TOPIC] }],
      call,
    });
    expect(missing.complete).toBe(false);
    expect(missing.loans).toEqual([]);
  });
});

function pricedInput() {
  return {
    collateralRaw: BigInt(2000) * E18,
    borrowShares: BigInt(1000) * E18,
    totalBorrowAssets: BigInt(1000) * E18,
    totalBorrowShares: BigInt(1000) * E18,
    lltv: LLTV,
    collateralDecimals: 18,
    loanDecimals: 18,
    collateralPriceUsd: 2 as number | null,
    loanPriceUsd: 1 as number | null,
  };
}
