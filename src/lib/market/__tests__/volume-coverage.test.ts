import { describe, expect, it } from "vitest";
import { inferVolumeCoverage } from "../volume-coverage";

describe("inferVolumeCoverage", () => {
  it("never treats missing volume as a reported zero", () => {
    expect(inferVolumeCoverage({ volume24hUsd: 0, poolCount: 1 })).toBe("reported");
    expect(inferVolumeCoverage({ volume24hUsd: null, poolCount: 0 })).toBe("no_indexed_pools");
    expect(inferVolumeCoverage({ volume24hUsd: null, poolCount: 2 })).toBe("pools_without_volume");
    expect(inferVolumeCoverage({ volume24hUsd: null, poolCount: 0, hydrateFailed: true })).toBe("hydrate_failed");
    expect(inferVolumeCoverage({ volume24hUsd: null, poolCount: 0, hydrateIncomplete: true })).toBe(
      "hydrate_incomplete",
    );
  });
});
