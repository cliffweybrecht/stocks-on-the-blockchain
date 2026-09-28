import { describe, expect, it } from "vitest";
import {
  applyMintHolderCount,
  applyPairHolderCounts,
  asHolderCount,
  dexScreenerPairDetailsPath,
  parseDexScreenerPairHolderCount,
  parseJupiterHolderCount,
  parseJupiterHolderCounts,
} from "../solana-holders";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const otherMint = "memeMint111111111111111111111111111111111";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("asHolderCount", () => {
  it("keeps a non-negative integer and a numeric string", () => {
    expect(asHolderCount(40386)).toBe(40386);
    expect(asHolderCount(0)).toBe(0);
    expect(asHolderCount("1200")).toBe(1200);
  });

  it("rejects missing, negative, and non-integer values", () => {
    expect(asHolderCount(null)).toBeNull();
    expect(asHolderCount(undefined)).toBeNull();
    expect(asHolderCount(-4)).toBeNull();
    expect(asHolderCount(12.5)).toBeNull();
    expect(asHolderCount("40386.2")).toBeNull();
    expect(asHolderCount("nope")).toBeNull();
  });
});

describe("parseJupiterHolderCounts", () => {
  it("reads holderCount for each requested mint from one payload", () => {
    const counts = parseJupiterHolderCounts(
      [
        { id: otherMint, holderCount: 9, stats24h: { numTraders: 100 } },
        { id: usdcMint, symbol: "USDC", holderCount: 2_000_000 },
        { id: tslaMint, symbol: "TSLAx", holderCount: 40386, stats24h: { numTraders: 1655 } },
      ],
      new Set([tslaMint, otherMint, usdcMint]),
    );
    expect(counts.get(tslaMint)).toBe(40386);
    expect(counts.get(otherMint)).toBe(9);
    expect(counts.get(usdcMint)).toBe(2_000_000);
  });

  it("stays null when the field is missing, even if 24h traders are present", () => {
    expect(parseJupiterHolderCount([{ id: tslaMint, stats24h: { numTraders: 1655 } }], tslaMint)).toBeNull();
    const counts = parseJupiterHolderCounts(
      [{ id: tslaMint, stats24h: { numTraders: 1655 } }],
      new Set([tslaMint]),
    );
    expect(counts.get(tslaMint)).toBeNull();
  });

  it("does not borrow a count from a different mint", () => {
    expect(parseJupiterHolderCount([{ id: otherMint, holderCount: 9 }], tslaMint)).toBeNull();
    expect(parseJupiterHolderCount({ tokens: [{ id: tslaMint, holderCount: 9 }] }, tslaMint)).toBeNull();
    expect(parseJupiterHolderCount([], tslaMint)).toBeNull();
    expect(parseJupiterHolderCounts([{ id: otherMint, holderCount: 9 }], new Set([tslaMint])).has(tslaMint)).toBe(
      false,
    );
  });

  it("stops on the matching row instead of substituting a later count", () => {
    expect(
      parseJupiterHolderCount(
        [
          { id: tslaMint, holderCount: null },
          { address: tslaMint, holderCount: 50 },
        ],
        tslaMint,
      ),
    ).toBeNull();
  });
});

describe("parseDexScreenerPairHolderCount", () => {
  it("reads this pair's holders.count and does not substitute the LP wallet count", () => {
    expect(
      parseDexScreenerPairHolderCount({
        holders: { count: 115946 },
        lpHolders: { count: 18, holders: [{ id: "lp-wallet", balance: "1" }] },
      }),
    ).toBe(115946);
    expect(parseDexScreenerPairHolderCount({ holders: { count: 120477 }, lpHolders: null })).toBe(120477);
    expect(parseDexScreenerPairHolderCount({ holders: { count: "20252" }, lpHolders: { count: 4 } })).toBe(20252);
    expect(parseDexScreenerPairHolderCount({ holders: { count: 0 }, lpHolders: null })).toBe(0);
  });

  it("stays null when this pair did not report holders, even if an LP count is present", () => {
    expect(parseDexScreenerPairHolderCount({ lpHolders: { count: 4 } })).toBeNull();
    expect(parseDexScreenerPairHolderCount({ holders: null, lpHolders: { count: 18 } })).toBeNull();
    expect(parseDexScreenerPairHolderCount({ holders: { holders: [{ id: "only-a-row" }] } })).toBeNull();
    expect(parseDexScreenerPairHolderCount({ holders: { count: 12.5 }, lpHolders: { count: 2 } })).toBeNull();
    expect(parseDexScreenerPairHolderCount({ lpHolders: { count: 12.5 } })).toBeNull();
    expect(parseDexScreenerPairHolderCount(null)).toBeNull();
  });
});

describe("dexScreenerPairDetailsPath", () => {
  it("targets one Solana pool and skips a blank address", () => {
    expect(dexScreenerPairDetailsPath("pair-1")).toBe("/dex/pair-details/v4/solana/pair-1");
    expect(dexScreenerPairDetailsPath("  ")).toBeNull();
  });
});

describe("applyMintHolderCount", () => {
  it("sets only the asset count", () => {
    const asset = { holderCount: null as number | null };
    applyMintHolderCount(asset, 40386);
    expect(asset.holderCount).toBe(40386);
    applyMintHolderCount(asset, null);
    expect(asset.holderCount).toBeNull();
    applyMintHolderCount(asset, 0);
    expect(asset.holderCount).toBe(0);
  });
});

describe("applyPairHolderCounts", () => {
  it("keeps a different LP count on each pool and does not copy a shared mint count", () => {
    const pools = [
      { pairAddress: "nvda-usdc-orca", pairHolderCount: 5_250_000 as number | null },
      { pairAddress: "nvda-usdc-raydium", pairHolderCount: 5_250_000 as number | null },
      { pairAddress: "nvda-sol-meteora", pairHolderCount: 3_820_000 as number | null },
    ];
    applyPairHolderCounts(
      pools,
      new Map<string, number | null>([
        [usdcMint, 5_250_000],
        [tslaMint, 112_538],
        ["nvda-usdc-orca", 18],
        ["nvda-usdc-raydium", 41],
        ["nvda-sol-meteora", null],
      ]),
    );
    expect(pools.map((pool) => pool.pairHolderCount)).toEqual([18, 41, null]);
  });

  it("does not fill a pool from another pool or from the asset mint", () => {
    const pools = [
      { pairAddress: "pair-a", pairHolderCount: 9 as number | null },
      { pairAddress: "  ", pairHolderCount: 9 as number | null },
    ];
    applyPairHolderCounts(pools, new Map([[tslaMint, 112_538], ["pair-b", 7]]));
    expect(pools.map((pool) => pool.pairHolderCount)).toEqual([null, null]);
  });
});
