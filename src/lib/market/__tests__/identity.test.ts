import { describe, expect, it } from "vitest";
import { assetRouteKey, findAssetByKey } from "../identity";

const rows = [
  { symbol: "TSLAx", contractAddress: "mint-backed" },
  { symbol: "TSLA", contractAddress: "mint-other" },
  { symbol: "TSLA", contractAddress: "mint-third" },
];

describe("findAssetByKey", () => {
  it("resolves a unique symbol or an exact mint", () => {
    expect(findAssetByKey(rows, "tslax")?.contractAddress).toBe("mint-backed");
    expect(findAssetByKey(rows, "mint-other")?.symbol).toBe("TSLA");
  });

  it("refuses an ambiguous ticker so two issuers stay separate", () => {
    expect(findAssetByKey(rows, "TSLA")).toBeUndefined();
    expect(assetRouteKey(rows[1]!, rows)).toBe("mint-other");
    expect(assetRouteKey(rows[0]!, rows)).toBe("TSLAx");
  });
});
