import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "../types";
import {
  compareByEquityCardRangeLiquidity,
  equityCardLiquidityForRange,
  equityCardLiquidityHistoryFromSnapshot,
  equityCardLiquidityHint,
  lastClosedEasternDay,
} from "../equity-card-range-liquidity";
import { loadEquityCardRangeMetrics, resetEquityCardRangeVolumeCache } from "../equity-card-range-volume-file";

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

function row(partial: {
  contractAddress: string;
  symbol: string;
  volume24hUsd?: number | null;
  displayedLiquidityUsd?: number | null;
}) {
  return {
    contractAddress: partial.contractAddress,
    symbol: partial.symbol,
    volume24hUsd: partial.volume24hUsd ?? 1,
    displayedLiquidityUsd: partial.displayedLiquidityUsd ?? null,
    volumeCoverage: "reported" as const,
  };
}

describe("equityCardLiquidityHistoryFromSnapshot", () => {
  it("averages recorded closes inside the volume window and keeps a real zero", () => {
    const payload = {
      records: [
        day("2026-10-04", [
          { address: "mint-a", displayedLiquidityUsd: 10 },
          { address: "mint-b", displayedLiquidityUsd: 1 },
        ]),
        day("2026-10-05", [{ address: "mint-a", displayedLiquidityUsd: 0 }]),
        day("2026-10-06", [
          { address: "mint-a", displayedLiquidityUsd: 5 },
          { address: "mint-b", displayedLiquidityUsd: null },
        ]),
        day("2026-10-07", [{ address: "mint-a", displayedLiquidityUsd: 100 }]),
      ],
    };
    const history = equityCardLiquidityHistoryFromSnapshot(payload, NOW);
    expect(lastClosedEasternDay(NOW)).toBe("2026-10-06");
    const week = equityCardLiquidityForRange(history, "mint-a", "7d");
    expect(week?.days).toBe(3);
    expect(week?.liquidityUsd).toBe(5);
    expect(week?.series.map((point) => point.date)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(equityCardLiquidityForRange(history, "mint-b", "7d")).toMatchObject({ liquidityUsd: 1, days: 1 });
    expect(equityCardLiquidityForRange(history, "mint-missing", "7d")).toBeNull();
    expect(equityCardLiquidityForRange(history, "mint-a", "24h")).toMatchObject({
      liquidityUsd: 5,
      days: 1,
      series: [expect.objectContaining({ date: "2026-10-06" })],
    });
    expect(equityCardLiquidityForRange(history, "mint-b", "24h")).toBeNull();
  });

  it("does not call an older close the 24H figure when the last closed day has no reserve", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(
      {
        records: [
          day("2026-10-05", [{ address: "mint-a", displayedLiquidityUsd: 40 }]),
          day("2026-10-06", [{ address: "mint-a", volume24hUsd: 3, displayedLiquidityUsd: null }]),
        ],
      },
      NOW,
    );
    expect(equityCardLiquidityForRange(history, "mint-a", "24h")).toBeNull();
    expect(equityCardLiquidityForRange(history, "mint-a", "7d")?.liquidityUsd).toBe(40);
    expect(equityCardLiquidityHint("24h", 0, false)).toBe("current");
    expect(equityCardLiquidityHint("7d", 1, true)).toBe("avg 7D · 1 of 7 days");
    expect(equityCardLiquidityHint("7d", 7, true)).toBe("avg 7D");
  });

  it("sums pool reserves only when the nightly asset omitted the displayed sum", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(
      {
        records: [
          day("2026-10-06", [
            {
              address: "0xAbC",
              displayedLiquidityUsd: null,
              pools: [{ liquidityUsd: 2 }, { liquidityUsd: 3 }, { liquidityUsd: null }, { liquidityUsd: -1 }],
            },
            { address: "mint-zero", displayedLiquidityUsd: 0, pools: [{ liquidityUsd: 90 }] },
          ]),
        ],
      },
      NOW,
    );
    expect(equityCardLiquidityForRange(history, "0xabc", "24h")?.liquidityUsd).toBe(5);
    expect(equityCardLiquidityForRange(history, "mint-zero", "24h")?.liquidityUsd).toBe(0);
  });

  it("keeps a sanity-guard zero and does not add an excluded pool back", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(
      {
        records: [
          day("2026-10-06", [
            {
              address: "mint-guarded",
              displayedLiquidityUsd: 0,
              pools: [{ pairAddress: "dead-pool", liquidityUsd: 596_294_797.53 }],
              excludedLiquidityPools: [
                {
                  poolId: "dead-pool",
                  liquidityUsd: 596_294_797.53,
                  reason: "liquidity-above-50m-with-volume-below-0.01pct",
                },
              ],
            },
            {
              address: "mint-fallback",
              pools: [
                { pairAddress: "kept", liquidityUsd: 20 },
                { pairAddress: "dead-pool", liquidityUsd: 80_000_000 },
              ],
              excludedLiquidityPools: [
                {
                  poolId: "dead-pool",
                  liquidityUsd: 80_000_000,
                  reason: "liquidity-above-50m-with-volume-below-0.01pct",
                },
              ],
            },
          ]),
        ],
      },
      NOW,
    );
    expect(equityCardLiquidityForRange(history, "mint-guarded", "24h")?.liquidityUsd).toBe(0);
    expect(equityCardLiquidityForRange(history, "mint-fallback", "24h")?.liquidityUsd).toBe(20);
  });

  it("ignores Gecko backfill reserves and symbolsWithVolume", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(
      {
        records: [
          day("2026-10-06", [{ address: "mint-a", displayedLiquidityUsd: 8 }]),
          {
            date: "2026-10-05",
            combined24hUsd: 1,
            symbolsWithVolume: [{ address: "mint-a", displayedLiquidityUsd: 80, volume24hUsd: 1 }],
          },
        ],
      },
      NOW,
      {
        source: "gecko-hourly-et-backfill",
        records: [
          {
            date: "2026-10-06",
            assets: [{ address: "mint-a", displayedLiquidityUsd: 999, volume24hUsd: 1, source: "gecko-hourly-et-backfill" }],
          },
          {
            date: "2026-09-20",
            assets: [{ address: "mint-a", displayedLiquidityUsd: 50, volume24hUsd: 1, source: "gecko-hourly-et-backfill" }],
          },
        ],
      },
    );
    expect(history.snapshotDays).toContain("2026-09-20");
    expect(equityCardLiquidityForRange(history, "mint-a", "30d")).toMatchObject({ liquidityUsd: 8, days: 1 });
    expect(history.byAsset["mint-a"]?.map((point) => point.date)).toEqual(["2026-10-06"]);
  });

  it("leaves the in-progress Eastern day out of the close and the average", () => {
    const stillOct6 = Date.parse("2026-10-07T03:00:00Z") / 1000;
    const history = equityCardLiquidityHistoryFromSnapshot(
      {
        records: [
          day("2026-10-05", [{ address: "mint-a", displayedLiquidityUsd: 2 }]),
          day("2026-10-06", [{ address: "mint-a", displayedLiquidityUsd: 9 }]),
        ],
      },
      stillOct6,
    );
    expect(history.lastClosedDay).toBe("2026-10-05");
    expect(equityCardLiquidityForRange(history, "mint-a", "24h")?.liquidityUsd).toBe(2);
    expect(equityCardLiquidityForRange(history, "mint-a", "7d")).toMatchObject({ liquidityUsd: 2, days: 1 });
  });
});

describe("recorded liquidity snapshots", () => {
  it("averages Solana AAPLx over the asset days inside each closed window", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(readSnapshot("solana.json"), NOW);
    expect(equityCardLiquidityForRange(history, AAPL_X, "24h")).toBeNull();
    const week = equityCardLiquidityForRange(history, AAPL_X, "7d");
    const fortnight = equityCardLiquidityForRange(history, AAPL_X, "14d");
    const month = equityCardLiquidityForRange(history, AAPL_X, "30d");
    expect(week?.days).toBe(4);
    expect(week?.series.map((point) => point.date)).toEqual(["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(week?.liquidityUsd).toBe(746_862.61);
    expect(fortnight?.days).toBe(8);
    expect(month?.days).toBe(8);
    expect(month?.liquidityUsd).toBe(fortnight?.liquidityUsd);
    expect(fortnight?.liquidityUsd).not.toBe(week?.liquidityUsd);
  });

  it("uses Base AAPLc closes through the last closed day", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(readSnapshot("base.json"), NOW);
    expect(equityCardLiquidityForRange(history, AAPL_C, "24h")).toMatchObject({
      liquidityUsd: 1_655_048.67,
      days: 1,
      series: [expect.objectContaining({ date: "2026-10-06" })],
    });
    expect(equityCardLiquidityForRange(history, AAPL_C, "7d")?.days).toBe(7);
    const fortnight = equityCardLiquidityForRange(history, AAPL_C, "14d");
    expect(fortnight?.days).toBe(10);
    expect(fortnight?.days).toBeLessThan(14);
  });

  it("finds no closed Robinhood or BNB reserves before those desks stored per-asset liquidity", () => {
    expect(equityCardLiquidityHistoryFromSnapshot(readSnapshot("robinhood.json"), NOW).byAsset).toEqual({});
    expect(equityCardLiquidityHistoryFromSnapshot(readSnapshot("bnb.json"), NOW).byAsset).toEqual({});
  });

  it("reads displayedLiquidityUsd, including a sanity-guard zero, on every chain desk", () => {
    // 12:00 America/New_York on 2026-10-20. Oct 19 has already closed.
    const now = Date.parse("2026-10-20T16:00:00Z") / 1000;
    const solana = equityCardLiquidityHistoryFromSnapshot(readSnapshot("solana.json"), now);
    const spcx = solana.byAsset.Ae1nDy28fKVEwKPS8wqW2iCz15Kpe6yhMQkK2r2hfjru?.find((point) => point.date === "2026-10-12");
    expect(spcx?.liquidityUsd).toBe(0);
    expect(lastClosedEasternDay(now)).toBe("2026-10-19");

    expect(equityCardLiquidityForRange(equityCardLiquidityHistoryFromSnapshot(readSnapshot("base.json"), now), AAPL_C, "24h")).toMatchObject({
      liquidityUsd: 1_525_297.69,
      days: 1,
      series: [expect.objectContaining({ date: "2026-10-19" })],
    });
    expect(
      equityCardLiquidityForRange(
        equityCardLiquidityHistoryFromSnapshot(readSnapshot("robinhood.json"), now),
        "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
        "24h",
      )?.liquidityUsd,
    ).toBe(3_505_683.6);
    const bnb = equityCardLiquidityHistoryFromSnapshot(readSnapshot("bnb.json"), now);
    expect(equityCardLiquidityForRange(bnb, "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a", "24h")?.liquidityUsd).toBe(1_283_118.58);
    expect(equityCardLiquidityForRange(bnb, "0x68fa48B1C2FE52b3D776E1953e0E782b5044Ce28", "24h")?.liquidityUsd).toBe(5_012.88);
  });
});

describe("compareByEquityCardRangeLiquidity", () => {
  it("ranks by the range average, then by the live figure when a range is missing", () => {
    const history = equityCardLiquidityHistoryFromSnapshot(
      {
        records: [
          day("2026-10-05", [
            { address: "low", displayedLiquidityUsd: 1 },
            { address: "high", displayedLiquidityUsd: 20 },
          ]),
          day("2026-10-06", [
            { address: "low", displayedLiquidityUsd: 19 },
            { address: "high", displayedLiquidityUsd: 2 },
          ]),
        ],
      },
      NOW,
    );
    const rows = [
      row({ contractAddress: "low", symbol: "LOW", displayedLiquidityUsd: 9_000 }),
      row({ contractAddress: "high", symbol: "HIGH", displayedLiquidityUsd: 1 }),
      row({ contractAddress: "live", symbol: "LIVE", displayedLiquidityUsd: 8 }),
    ];
    const week = [...rows].sort((a, b) => compareByEquityCardRangeLiquidity(a, b, history, "7d"));
    expect(week.map((item) => item.symbol)).toEqual(["HIGH", "LOW", "LIVE"]);
    const dayRank = [...rows].sort((a, b) => compareByEquityCardRangeLiquidity(a, b, history, "24h"));
    expect(dayRank.map((item) => item.symbol)).toEqual(["LOW", "LIVE", "HIGH"]);
    expect(equityCardLiquidityForRange(history, "high", "7d")?.liquidityUsd).toBe(11);
    expect(equityCardLiquidityForRange(history, "low", "7d")?.liquidityUsd).toBe(10);
    expect(equityCardLiquidityForRange(history, "high", "24h")?.liquidityUsd).toBe(2);
    expect(equityCardLiquidityForRange(history, "low", "24h")?.liquidityUsd).toBe(19);
  });
});

describe("loadEquityCardRangeMetrics", () => {
  it("reads liquidity with volume and does not write the snapshot file", async () => {
    resetEquityCardRangeVolumeCache();
    const path = join(process.cwd(), "data/volume-snapshots/solana.json");
    const before = statSync(path).mtimeMs;
    const first = await loadEquityCardRangeMetrics(SOLANA_CHAIN_ID, NOW);
    const second = await loadEquityCardRangeMetrics(SOLANA_CHAIN_ID, NOW);
    expect(statSync(path).mtimeMs).toBe(before);
    expect(second.volumes).toEqual(first.volumes);
    expect(second.liquidity).toEqual(first.liquidity);
    expect(second.liquidity).not.toBe(first.liquidity);
    expect(second.prices).toEqual(first.prices);
    expect(second.prices).not.toBe(first.prices);
    expect(second.volumeSeries).toEqual(first.volumeSeries);
    expect(equityCardLiquidityForRange(first.liquidity, AAPL_X, "7d")?.days).toBe(4);
    expect(await loadEquityCardRangeMetrics("not-a-chain", NOW)).toEqual({
      volumes: {},
      liquidity: { lastClosedDay: "", snapshotDays: [], byAsset: {} },
      volumeSeries: { snapshotDays: [], byAsset: {} },
      prices: { latestSnapshotDay: "", snapshotDays: [], byAsset: {} },
    });
    expect((await loadEquityCardRangeMetrics(BNB_CHAIN_ID, NOW)).liquidity.byAsset).toEqual({});
    expect((await loadEquityCardRangeMetrics(ROBINHOOD_CHAIN_ID, NOW)).liquidity.byAsset).toEqual({});
    expect(equityCardLiquidityForRange((await loadEquityCardRangeMetrics(BASE_CHAIN_ID, NOW)).liquidity, AAPL_C, "24h")?.days).toBe(
      1,
    );
  });

  it("loads later Robinhood and BNB closes without writing the snapshot files", async () => {
    resetEquityCardRangeVolumeCache();
    const now = Date.parse("2026-10-20T16:00:00Z") / 1000;
    const files = ["solana.json", "base.json", "bnb.json", "robinhood.json"] as const;
    const before = Object.fromEntries(files.map((file) => [file, statSync(join(process.cwd(), "data/volume-snapshots", file)).mtimeMs]));
    const robinhood = await loadEquityCardRangeMetrics(ROBINHOOD_CHAIN_ID, now);
    const bnb = await loadEquityCardRangeMetrics(BNB_CHAIN_ID, now);
    const base = await loadEquityCardRangeMetrics(BASE_CHAIN_ID, now);
    const solana = await loadEquityCardRangeMetrics(SOLANA_CHAIN_ID, now);
    for (const file of files) {
      expect(statSync(join(process.cwd(), "data/volume-snapshots", file)).mtimeMs).toBe(before[file]);
    }
    expect(equityCardLiquidityForRange(robinhood.liquidity, "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", "24h")?.liquidityUsd).toBe(
      3_505_683.6,
    );
    expect(equityCardLiquidityForRange(bnb.liquidity, "0x68fa48B1C2FE52b3D776E1953e0E782b5044Ce28", "24h")?.liquidityUsd).toBe(5_012.88);
    expect(equityCardLiquidityForRange(base.liquidity, AAPL_C, "24h")?.days).toBe(1);
    expect(solana.liquidity.byAsset.Ae1nDy28fKVEwKPS8wqW2iCz15Kpe6yhMQkK2r2hfjru?.some((point) => point.liquidityUsd === 0)).toBe(
      true,
    );
  });
});
