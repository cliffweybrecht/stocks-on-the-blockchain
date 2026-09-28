import { describe, expect, it } from "vitest";
import {
  applyMintHolderCount,
  applyOtherHolderCounts,
  asHolderCount,
  counterpartyHolderSide,
  parseJupiterHolderCount,
  parseJupiterHolderCounts,
} from "../solana-holders";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const otherMint = "memeMint111111111111111111111111111111111";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const woollyMint = "woollyMint11111111111111111111111111111111";

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

describe("counterpartyHolderSide", () => {
  it("picks the mint that is not the asset page", () => {
    expect(
      counterpartyHolderSide(
        { baseAddress: otherMint, baseSymbol: "SI", quoteAddress: tslaMint, quoteSymbol: "NVDAx" },
        tslaMint,
      ),
    ).toEqual({ mint: otherMint, symbol: "SI" });
    expect(
      counterpartyHolderSide(
        { baseAddress: tslaMint, baseSymbol: "NVDAx", quoteAddress: usdcMint, quoteSymbol: "USDC" },
        tslaMint,
      ),
    ).toEqual({ mint: usdcMint, symbol: "USDC" });
    expect(
      counterpartyHolderSide(
        { baseAddress: woollyMint, baseSymbol: "WOOLLY", quoteAddress: tslaMint, quoteSymbol: "NVDAx" },
        tslaMint,
      ),
    ).toEqual({ mint: woollyMint, symbol: "WOOLLY" });
  });

  it("returns null when the page mint is missing from the pair", () => {
    expect(
      counterpartyHolderSide({ baseAddress: otherMint, quoteAddress: usdcMint }, tslaMint),
    ).toBeNull();
    expect(counterpartyHolderSide({ baseAddress: tslaMint, quoteAddress: null }, tslaMint)).toBeNull();
    expect(counterpartyHolderSide({ baseAddress: tslaMint, quoteAddress: tslaMint }, tslaMint)).toBeNull();
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

describe("applyOtherHolderCounts", () => {
  it("stamps a different counterparty count on each pair and never copies the asset count", () => {
    const pools = [
      {
        baseAddress: otherMint,
        baseSymbol: "SI",
        quoteAddress: tslaMint,
        quoteSymbol: "NVDAx",
        otherHolderCount: 40386 as number | null,
      },
      {
        baseAddress: tslaMint,
        baseSymbol: "NVDAx",
        quoteAddress: usdcMint,
        quoteSymbol: "USDC",
        otherHolderCount: 40386 as number | null,
      },
      {
        baseAddress: woollyMint,
        baseSymbol: "WOOLLY",
        quoteAddress: tslaMint,
        quoteSymbol: "NVDAx",
        otherHolderCount: 40386 as number | null,
      },
    ];
    applyOtherHolderCounts(
      tslaMint,
      pools,
      new Map([
        [tslaMint, 40386],
        [otherMint, 1200],
        [usdcMint, 2_000_000],
        [woollyMint, 840],
      ]),
    );
    expect(pools.map((pool) => pool.otherHolderCount)).toEqual([1200, 2_000_000, 840]);
  });

  it("leaves a dash when the other mint has no count", () => {
    const pools = [
      {
        baseAddress: tslaMint,
        quoteAddress: usdcMint,
        otherHolderCount: 10 as number | null,
      },
    ];
    applyOtherHolderCounts(tslaMint, pools, new Map([[tslaMint, 40386]]));
    expect(pools[0]?.otherHolderCount).toBeNull();
  });
});
