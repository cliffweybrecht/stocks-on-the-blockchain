import { describe, expect, it } from "vitest";
import {
  assetMatchesCoverageFilter,
  inferVolumeCoverage,
  parseCoverageFilter,
  solanaHydrateProgress,
  volumeCoverageLabel,
} from "../volume-coverage";

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

describe("coverage filters", () => {
  it("parses known coverage query values and ignores junk", () => {
    expect(parseCoverageFilter("with-volume")).toBe("with-volume");
    expect(parseCoverageFilter("hydrating")).toBe("hydrating");
    expect(parseCoverageFilter("with-pools")).toBe("with-pools");
    expect(parseCoverageFilter("no-pools")).toBe("no-pools");
    expect(parseCoverageFilter("all")).toBe("all");
    expect(parseCoverageFilter(undefined)).toBe("all");
    expect(parseCoverageFilter(undefined, "with-volume")).toBe("with-volume");
    expect(parseCoverageFilter("all", "with-volume")).toBe("all");
    expect(parseCoverageFilter(["with-volume", "no-pools"])).toBe("with-volume");
    expect(parseCoverageFilter("zero")).toBe("all");
    expect(parseCoverageFilter("zero", "with-volume")).toBe("with-volume");
  });

  it("never treats null volume as matching With volume", () => {
    const reported = { volume24hUsd: 0, poolCount: 1 };
    const noPools = { volume24hUsd: null, poolCount: 0 };
    const poolsNoVolume = { volume24hUsd: null, poolCount: 2 };

    const hydrating = {
      volume24hUsd: null,
      poolCount: 0,
      volumeCoverage: "hydrate_incomplete" as const,
    };

    expect(assetMatchesCoverageFilter(reported, "with-volume")).toBe(true);
    expect(assetMatchesCoverageFilter(noPools, "with-volume")).toBe(false);
    expect(assetMatchesCoverageFilter(poolsNoVolume, "with-volume")).toBe(false);

    expect(assetMatchesCoverageFilter(reported, "with-pools")).toBe(true);
    expect(assetMatchesCoverageFilter(noPools, "with-pools")).toBe(false);
    expect(assetMatchesCoverageFilter(poolsNoVolume, "with-pools")).toBe(true);

    expect(assetMatchesCoverageFilter(reported, "no-pools")).toBe(false);
    expect(assetMatchesCoverageFilter(noPools, "no-pools")).toBe(true);
    expect(assetMatchesCoverageFilter(poolsNoVolume, "no-pools")).toBe(false);
    expect(assetMatchesCoverageFilter(hydrating, "no-pools")).toBe(false);
    expect(assetMatchesCoverageFilter(hydrating, "hydrating")).toBe(true);
    expect(assetMatchesCoverageFilter(noPools, "hydrating")).toBe(false);
  });
});

describe("volumeCoverageLabel", () => {
  it("keeps hydrating distinct from confirmed-empty and from reported volume", () => {
    expect(volumeCoverageLabel("reported")).toBe("With volume");
    expect(volumeCoverageLabel("hydrate_incomplete")).toBe("Still hydrating");
    expect(volumeCoverageLabel("no_indexed_pools")).toBe("Confirmed no pools");
  });
});

describe("solanaHydrateProgress", () => {
  it("separates still-hydrating from confirmed DexScreener-empty", () => {
    const progress = solanaHydrateProgress({
      assetCount: 100,
      assetsWithVolume: 48,
      assetsWithPools: 50,
      assetsStillHydrating: 10,
      assetsWithNoIndexedPools: 40,
    });
    expect(progress.checked).toBe(90);
    expect(progress.checkedPct).toBe(90);
    expect(progress.confirmedNoPools).toBe(40);
    expect(progress.stillHydrating).toBe(10);
  });
});
