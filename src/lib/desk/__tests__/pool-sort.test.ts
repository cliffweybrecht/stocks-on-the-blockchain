import { describe, expect, it } from "vitest";
import { poolAggregateTotals, sortPoolsByVolume } from "../pool-sort";

describe("sortPoolsByVolume", () => {
  it("ranks reported volume first and keeps null last, without turning null into 0", () => {
    const sorted = sortPoolsByVolume([
      { dexId: "orca", volume24hUsd: null, liquidityUsd: 9 },
      { dexId: "raydium", volume24hUsd: 10, liquidityUsd: 1 },
      { dexId: "meteora", volume24hUsd: 0, liquidityUsd: 4 },
      { dexId: "pumpswap", volume24hUsd: 10, liquidityUsd: 8 },
    ]);
    expect(sorted.map((pool) => pool.dexId)).toEqual(["pumpswap", "raydium", "meteora", "orca"]);
  });
});

describe("poolAggregateTotals", () => {
  it("sums reported numbers and stays null when nothing reported", () => {
    expect(
      poolAggregateTotals([
        { volume24hUsd: 10, liquidityUsd: 2 },
        { volume24hUsd: null, liquidityUsd: 3 },
        { volume24hUsd: 0, liquidityUsd: null },
      ]),
    ).toEqual({ volume24hUsd: 10, liquidityUsd: 5, poolCount: 3 });
    expect(poolAggregateTotals([{ volume24hUsd: null, liquidityUsd: null }])).toEqual({
      volume24hUsd: null,
      liquidityUsd: null,
      poolCount: 1,
    });
  });
});
