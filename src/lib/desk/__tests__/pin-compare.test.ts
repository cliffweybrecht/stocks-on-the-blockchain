import { describe, expect, it } from "vitest";
import { PIN_COMPARE_MAX, selectPinnedCompareRows, shouldShowPinCompare } from "../pin-compare";

const tsla = {
  symbol: "TSLAx",
  contractAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
};
const hood = {
  symbol: "HOODx",
  contractAddress: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
};
const ondo = {
  symbol: "TSLAon",
  contractAddress: "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo",
};

describe("selectPinnedCompareRows", () => {
  it("keeps pin order, drops unknown mints, and needs two resolved names to compare", () => {
    const pins = [ondo.contractAddress, "not-a-mint-on-this-desk", tsla.contractAddress, hood.contractAddress];
    const rows = selectPinnedCompareRows([hood, tsla, ondo], pins);
    expect(rows.map((row) => row.symbol)).toEqual(["TSLAon", "TSLAx", "HOODx"]);
    expect(shouldShowPinCompare(rows)).toBe(true);
    expect(shouldShowPinCompare(selectPinnedCompareRows([tsla], [tsla.contractAddress]))).toBe(false);
    expect(shouldShowPinCompare([])).toBe(false);
  });

  it("caps the compare strip", () => {
    const catalog = Array.from({ length: PIN_COMPARE_MAX + 4 }, (_, index) => ({
      symbol: `S${index}`,
      contractAddress: `Xs${"B".repeat(30)}${String(index).padStart(4, "0")}`,
    }));
    const pins = catalog.map((row) => row.contractAddress);
    expect(selectPinnedCompareRows(catalog, pins)).toHaveLength(PIN_COMPARE_MAX);
  });
});
