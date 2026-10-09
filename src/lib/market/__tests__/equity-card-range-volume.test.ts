import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compareByEquityCardRangeVolume, equityCardRangeVolumesFromSnapshot } from "../equity-card-range-volume";
import { loadEquityCardRangeVolumes, resetEquityCardRangeVolumeCache } from "../equity-card-range-volume-file";

const AAPL_X = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const AAPL_C = "0xb200000000000000000000c2e324d24d7eecd1fb";

/** 23:00 America/New_York on 2026-10-07. Oct 7 is still open. Oct 6 is the newest closed day. */
const NOW = Date.parse("2026-10-08T03:00:00Z") / 1000;

function readSnapshot(file: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots", file), "utf8"));
}

function day(date: string, assets: unknown[], combined = 1) {
  return {
    date,
    combined24hUsd: combined,
    generatedAt: `${date}T16:00:00.000Z`,
    assets,
  };
}

describe("equityCardRangeVolumesFromSnapshot", () => {
  it("sums the newest closed Eastern days and leaves a missing asset unknown", () => {
    const payload = {
      records: [
        day("2026-10-04", [{ address: "mint-a", volume24hUsd: 10 }, { address: "mint-b", volume24hUsd: 1 }]),
        day("2026-10-05", [{ address: "mint-a", volume24hUsd: 0 }]),
        day("2026-10-06", [{ address: "mint-a", volume24hUsd: 5 }, { address: "mint-b", volume24hUsd: 4 }]),
        day("2026-10-07", [{ address: "mint-a", volume24hUsd: 100 }]),
      ],
    };
    const volumes = equityCardRangeVolumesFromSnapshot(payload, NOW);
    expect(volumes["mint-a"]?.["7d"]).toEqual({ volumeUsd: 15, days: 3 });
    expect(volumes["mint-b"]?.["7d"]).toEqual({ volumeUsd: 5, days: 2 });
    expect(volumes["mint-missing"]).toBeUndefined();
    expect(volumes["mint-a"]?.["14d"]).toEqual({ volumeUsd: 15, days: 3 });
    expect(volumes["mint-a"]?.["30d"]).toEqual({ volumeUsd: 15, days: 3 });
  });

  it("does not treat the in-progress Eastern evening as the next UTC date", () => {
    const stillOct6 = Date.parse("2026-10-07T03:00:00Z") / 1000;
    const payload = {
      records: [
        day("2026-10-05", [{ address: "mint-a", volume24hUsd: 2 }]),
        day("2026-10-06", [{ address: "mint-a", volume24hUsd: 9 }]),
      ],
    };
    const volumes = equityCardRangeVolumesFromSnapshot(payload, stillOct6);
    expect(volumes["mint-a"]?.["7d"]).toEqual({ volumeUsd: 2, days: 1 });
  });

  it("keeps one figure per address per day and folds EVM case", () => {
    const payload = {
      records: [
        day("2026-10-06", [
          { address: "0xAbC", volume24hUsd: 3 },
          { contractAddress: "0xabc", volume24hUsd: 8 },
          { symbol: "NOADDR", volume24hUsd: 50 },
          { address: "mint-neg", volume24hUsd: -4 },
        ]),
      ],
    };
    const volumes = equityCardRangeVolumesFromSnapshot(payload, NOW);
    expect(volumes["0xabc"]?.["7d"]).toEqual({ volumeUsd: 8, days: 1 });
    expect(volumes["mint-neg"]).toBeUndefined();
  });

  it("uses symbolsWithVolume only when the day has no assets list", () => {
    const payload = {
      records: [
        {
          date: "2026-10-05",
          combined24hUsd: 1,
          symbolsWithVolume: [{ address: "0xAa", volume24hUsd: 2 }],
        },
        {
          date: "2026-10-06",
          combined24hUsd: 1,
          assets: [{ address: "0xAa", volume24hUsd: 5 }],
          symbolsWithVolume: [{ address: "0xAa", volume24hUsd: 99 }],
        },
        { date: "2026-10-04", hour: "2026-10-04T15", t: 1, combined24hUsd: 1, assets: [{ address: "0xAa", volume24hUsd: 70 }] },
      ],
    };
    const volumes = equityCardRangeVolumesFromSnapshot(payload, NOW);
    expect(volumes["0xaa"]?.["7d"]).toEqual({ volumeUsd: 7, days: 2 });
  });

  it("drops a day the desk chart would not plot", () => {
    const payload = {
      records: [
        { date: "2026-10-06", assets: [{ address: "mint-a", volume24hUsd: 12 }] },
        { date: "not-a-day", combined24hUsd: 4, assets: [{ address: "mint-a", volume24hUsd: 4 }] },
      ],
    };
    expect(equityCardRangeVolumesFromSnapshot(payload, NOW)).toEqual({});
  });
});

describe("recorded snapshot files", () => {
  it("sums Solana AAPLx across the four asset days inside the last seven closed days", () => {
    const volumes = equityCardRangeVolumesFromSnapshot(readSnapshot("solana.json"), NOW);
    expect(volumes[AAPL_X]?.["7d"]?.days).toBe(4);
    expect(volumes[AAPL_X]?.["7d"]?.volumeUsd).toBeCloseTo(3_898_895.25, 2);
    expect(volumes[AAPL_X]?.["14d"]?.days).toBe(8);
    expect(volumes[AAPL_X]?.["14d"]?.volumeUsd).toBeCloseTo(5_247_329.51, 2);
    expect(volumes[AAPL_X]?.["30d"]).toEqual(volumes[AAPL_X]?.["14d"]);
  });

  it("sums Base AAPLc across all seven newest closed days", () => {
    const volumes = equityCardRangeVolumesFromSnapshot(readSnapshot("base.json"), NOW);
    expect(volumes[AAPL_C]?.["7d"]).toEqual({ volumeUsd: 32_463_551.2, days: 7 });
    const thirty = volumes[AAPL_C]?.["30d"];
    expect(thirty?.days).toBeLessThan(30);
    expect(thirty?.days).toBe(volumes[AAPL_C]?.["14d"]?.days);
  });

  it("finds no per-asset rows in Robinhood and sums backfilled BNB SPCXB", () => {
    expect(equityCardRangeVolumesFromSnapshot(readSnapshot("robinhood.json"), NOW)).toEqual({});
    const bnb = equityCardRangeVolumesFromSnapshot(readSnapshot("bnb.json"), NOW);
    const spcxb = "0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1";
    expect(bnb[spcxb]?.["7d"]?.days).toBe(7);
    expect(bnb[spcxb]?.["7d"]?.volumeUsd).toBeCloseTo(40_273_797.76, 2);
    expect(bnb[spcxb]?.["14d"]?.days).toBe(14);
    expect(bnb[spcxb]?.["14d"]?.volumeUsd).toBeCloseTo(68_536_705.34, 2);
    expect(bnb[spcxb]?.["30d"]).toEqual(bnb[spcxb]?.["14d"]);
  });

  it("keeps a DexScreener row and fills a day only the backfill has", () => {
    const volumes = equityCardRangeVolumesFromSnapshot(
      {
        records: [
          day("2026-10-06", [{ address: "mint-a", volume24hUsd: 10 }]),
          day("2026-10-05", [{ address: "mint-a", volume24hUsd: 4 }]),
        ],
      },
      NOW,
      {
        source: "gecko-hourly-et-backfill",
        records: [
          {
            date: "2026-10-06",
            assets: [{ address: "mint-a", volume24hUsd: 99, source: "gecko-hourly-et-backfill" }],
          },
          {
            date: "2026-09-20",
            assets: [{ address: "mint-a", volume24hUsd: 3, source: "gecko-hourly-et-backfill" }],
          },
        ],
      },
    );
    expect(volumes["mint-a"]?.["7d"]?.volumeUsd).toBe(17);
    expect(volumes["mint-a"]?.["7d"]?.volumeUsd).not.toBe(106);
    expect(volumes["mint-a"]?.["30d"]?.days).toBe(3);
  });
});

describe("loadEquityCardRangeVolumes", () => {
  it("reuses the parsed map for the same Eastern day", async () => {
    resetEquityCardRangeVolumeCache();
    const first = await loadEquityCardRangeVolumes("solana", NOW);
    const second = await loadEquityCardRangeVolumes("solana", NOW);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    const snapshotOnly = equityCardRangeVolumesFromSnapshot(readSnapshot("solana.json"), NOW);
    expect(snapshotOnly[AAPL_X]?.["7d"]?.days).toBe(4);
    expect(first[AAPL_X]?.["7d"]?.volumeUsd ?? 0).toBeGreaterThanOrEqual(snapshotOnly[AAPL_X]?.["7d"]?.volumeUsd ?? 0);
    expect(await loadEquityCardRangeVolumes("not-a-chain", NOW)).toEqual({});
  });
});

describe("compareByEquityCardRangeVolume", () => {
  it("ranks by the closed-range sum and leaves missing volume last", () => {
    const volumes = equityCardRangeVolumesFromSnapshot(
      {
        records: [
          day("2026-10-06", [
            { address: "low-live", volume24hUsd: 5 },
            { address: "high-live", volume24hUsd: 1 },
          ]),
        ],
      },
      NOW,
    );
    const rows = [
      { contractAddress: "low-live", symbol: "LOW", volume24hUsd: 900, displayedLiquidityUsd: 1, volumeCoverage: "reported" as const },
      { contractAddress: "high-live", symbol: "HIGH", volume24hUsd: 1, displayedLiquidityUsd: 1, volumeCoverage: "reported" as const },
      { contractAddress: "none", symbol: "NONE", volume24hUsd: 5_000, displayedLiquidityUsd: 1, volumeCoverage: "reported" as const },
    ];
    const ranked = [...rows].sort((a, b) => compareByEquityCardRangeVolume(a, b, volumes, "7d"));
    expect(ranked.map((row) => row.symbol)).toEqual(["LOW", "HIGH", "NONE"]);
  });
});
