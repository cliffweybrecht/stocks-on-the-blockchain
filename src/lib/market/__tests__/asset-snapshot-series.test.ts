import { describe, expect, it } from "vitest";
import { assetSnapshotVolumeFromPayload, lookupAssetSnapshotVolume } from "../asset-snapshot-series";
import { utcInstantForDayKey } from "../volume-snapshots";

describe("assetSnapshotVolumeFromPayload", () => {
  it("keeps per-asset closed days from records that still list assets", () => {
    const index = assetSnapshotVolumeFromPayload({
      records: [
        {
          date: "2026-10-01",
          assets: [{ address: "mint-race", symbol: "RACE", volume24hUsd: 100 }],
        },
        {
          date: "2026-10-02",
          assets: [{ address: "mint-race", symbol: "RACE", volume24hUsd: 250 }],
        },
        { date: "2026-10-03", combined24hUsd: 1 },
      ],
    });
    const points = lookupAssetSnapshotVolume(index, { symbol: "race" });
    expect(points).toEqual([
      { t: utcInstantForDayKey("2026-10-01"), volumeUsd: 100, kind: "calendar_day" },
      { t: utcInstantForDayKey("2026-10-02"), volumeUsd: 250, kind: "calendar_day" },
    ]);
    expect(lookupAssetSnapshotVolume(index, { mint: "mint-race" })).toEqual(points);
    expect(lookupAssetSnapshotVolume(index, { symbol: "missing" })).toEqual([]);
  });
});
