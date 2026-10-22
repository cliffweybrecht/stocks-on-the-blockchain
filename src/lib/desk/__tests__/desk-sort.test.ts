import { describe, expect, it } from "vitest";
import { deskSortOptions, resolveDeskSortKey } from "../desk-sort";

describe("deskSortOptions", () => {
  it("puts Market value on the Solana desk after Volume and Liquidity", () => {
    expect(deskSortOptions({ solanaDesk: true, showRobinhoodMarks: false })).toEqual([
      ["volume24hUsd", "Volume"],
      ["displayedLiquidityUsd", "Liquidity"],
      ["marketValueUsd", "Market value"],
    ]);
  });

  it("drops Market value when the section is hidden", () => {
    expect(
      deskSortOptions({ solanaDesk: true, showRobinhoodMarks: false, includeMarketValue: false }).map((row) => row[1]),
    ).toEqual(["Volume", "Liquidity"]);
  });

  it("keeps Pools and Robinhood marks on other chains", () => {
    expect(deskSortOptions({ solanaDesk: false, showRobinhoodMarks: true }).map((row) => row[1])).toEqual([
      "Volume",
      "Liquidity",
      "Market value",
      "Pools",
      "RH vs DEX",
    ]);
  });
});

describe("resolveDeskSortKey", () => {
  it("drops a Pools sort on the Solana desk and leaves other sorts alone", () => {
    expect(resolveDeskSortKey("poolCount", true)).toBe("volume24hUsd");
    expect(resolveDeskSortKey("displayedLiquidityUsd", true)).toBe("displayedLiquidityUsd");
    expect(resolveDeskSortKey("poolCount", false)).toBe("poolCount");
    expect(resolveDeskSortKey("marketValueUsd", true, false)).toBe("volume24hUsd");
    expect(resolveDeskSortKey("marketValueUsd", true, true)).toBe("marketValueUsd");
  });
});
