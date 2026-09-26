import { describe, expect, it } from "vitest";
import { applyMintHolderCount, asHolderCount, parseJupiterHolderCount } from "../solana-holders";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const otherMint = "memeMint111111111111111111111111111111111";

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

describe("parseJupiterHolderCount", () => {
  it("reads holderCount only for the requested mint", () => {
    expect(
      parseJupiterHolderCount(
        [
          { id: otherMint, holderCount: 9, stats24h: { numTraders: 100 } },
          { id: tslaMint, symbol: "TSLAx", holderCount: 40386, stats24h: { numTraders: 1655 } },
        ],
        tslaMint,
      ),
    ).toBe(40386);
  });

  it("stays null when the field is missing, even if 24h traders are present", () => {
    expect(
      parseJupiterHolderCount([{ id: tslaMint, stats24h: { numTraders: 1655 } }], tslaMint),
    ).toBeNull();
  });

  it("does not borrow a count from a different mint", () => {
    expect(parseJupiterHolderCount([{ id: otherMint, holderCount: 9 }], tslaMint)).toBeNull();
    expect(parseJupiterHolderCount({ tokens: [{ id: tslaMint, holderCount: 9 }] }, tslaMint)).toBeNull();
    expect(parseJupiterHolderCount([], tslaMint)).toBeNull();
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

describe("applyMintHolderCount", () => {
  it("copies one mint count onto the asset and every pool", () => {
    const asset = {
      holderCount: null as number | null,
      pools: [{ holderCount: null as number | null }, { holderCount: null as number | null }],
    };
    applyMintHolderCount(asset, 40386);
    expect(asset.holderCount).toBe(40386);
    expect(asset.pools.map((pool) => pool.holderCount)).toEqual([40386, 40386]);
  });

  it("keeps a reported zero and clears to null without inventing zero", () => {
    const asset = {
      holderCount: 10 as number | null,
      pools: [{ holderCount: 10 as number | null }],
    };
    applyMintHolderCount(asset, 0);
    expect(asset.holderCount).toBe(0);
    expect(asset.pools[0]?.holderCount).toBe(0);
    applyMintHolderCount(asset, null);
    expect(asset.holderCount).toBeNull();
    expect(asset.pools[0]?.holderCount).toBeNull();
  });
});
