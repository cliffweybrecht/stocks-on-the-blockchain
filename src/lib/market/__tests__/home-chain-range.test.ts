import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE_DESK } from "../base-desk-volume";
import { BNB_DESK } from "../bnb-desk-volume";
import { filterVolumeRange, sumVolumePoints } from "../daily-volume-view";
import {
  homeChainClosedRangeBoard,
  homeChainRangeCoverageHint,
  type HomeDeskLaneDay,
} from "../home-chain-range";
import { mergeAdditionalDeskDays, mergeHomeDeskSnapshotPoints } from "../home-desk-volume";
import { closedRobinhoodDeskDays, parseRobinhoodDeskDays } from "../robinhood-desk-volume";
import { closedSnapshotDeskDays, parseSnapshotDeskDays } from "../snapshot-desk-volume";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "../types";
import {
  closedSnapshotVolumePoints,
  parseDeskVolumeSnapshotRecords,
  pointsFromDeskVolumeSnapshots,
} from "../volume-snapshots";

const nowT = Date.parse("2026-10-08T03:00:00Z") / 1000;

function readJson(file: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots", file), "utf8"));
}

function lane(partial: Partial<HomeDeskLaneDay> & Pick<HomeDeskLaneDay, "t" | "combined24hUsd">): HomeDeskLaneDay {
  return {
    t: partial.t,
    publicEquity24hUsd: partial.publicEquity24hUsd ?? null,
    private24hUsd: partial.private24hUsd ?? null,
    etfIndex24hUsd: partial.etfIndex24hUsd ?? null,
    combined24hUsd: partial.combined24hUsd,
  };
}

describe("homeChainClosedRangeBoard", () => {
  it("sums each chain over the chart window and leaves a missing lane null", () => {
    const day = (offset: number) => Date.UTC(2026, 8, 24 + offset) / 1000;
    const solanaClosed = [0, 1, 2, 3].map((offset) => ({
      t: day(offset),
      volumeUsd: 100,
      kind: "calendar_day" as const,
    }));
    const solanaLanes = solanaClosed.map((point) =>
      lane({ t: point.t, publicEquity24hUsd: 80, private24hUsd: 20, etfIndex24hUsd: null, combined24hUsd: 100 }),
    );
    const robinhood = [
      lane({ t: day(2), publicEquity24hUsd: 5, private24hUsd: null, etfIndex24hUsd: 1, combined24hUsd: 6 }),
      lane({ t: day(3), publicEquity24hUsd: 7, private24hUsd: null, etfIndex24hUsd: null, combined24hUsd: 7 }),
    ];
    const board = homeChainClosedRangeBoard({
      solanaClosed,
      solanaLanes,
      robinhoodDays: robinhood.map((row) => ({
        date: "2026-09-26",
        t: row.t,
        publicEquity24hUsd: row.publicEquity24hUsd,
        private24hUsd: row.private24hUsd,
        etfIndex24hUsd: row.etfIndex24hUsd,
        combined24hUsd: row.combined24hUsd,
        displayedLiquidityUsd: null,
        equity: [],
        etf: [],
        private: [],
      })),
      baseDays: [],
      bnbDays: [],
    });
    const seven = board["7d"];
    expect(seven.windowDayCount).toBe(4);
    expect(seven.byChainId[SOLANA_CHAIN_ID]?.combinedUsd).toBe(400);
    expect(seven.byChainId[SOLANA_CHAIN_ID]?.volume24hUsd).toBe(320);
    expect(seven.byChainId[SOLANA_CHAIN_ID]?.privateVolume24hUsd).toBe(80);
    expect(seven.byChainId[SOLANA_CHAIN_ID]?.etfVolume24hUsd).toBeNull();
    expect(seven.byChainId[SOLANA_CHAIN_ID]?.days).toBe(4);
    expect(seven.byChainId[ROBINHOOD_CHAIN_ID]?.combinedUsd).toBe(13);
    expect(seven.byChainId[ROBINHOOD_CHAIN_ID]?.privateVolume24hUsd).toBeNull();
    expect(seven.byChainId[ROBINHOOD_CHAIN_ID]?.days).toBe(2);
    expect(homeChainRangeCoverageHint("7d", 2)).toBe("2 of 7 days");
    expect(homeChainRangeCoverageHint("7d", 7)).toBeNull();
    expect(homeChainRangeCoverageHint("7d", 0)).toBeNull();
    const rowSum =
      (seven.byChainId[SOLANA_CHAIN_ID]?.combinedUsd ?? 0) +
      (seven.byChainId[ROBINHOOD_CHAIN_ID]?.combinedUsd ?? 0) +
      (seven.byChainId[BASE_CHAIN_ID]?.combinedUsd ?? 0) +
      (seven.byChainId[BNB_CHAIN_ID]?.combinedUsd ?? 0);
    expect(rowSum).toBe(seven.headlineUsd);
    expect(seven.byChainId[BASE_CHAIN_ID]?.combinedUsd).toBeNull();
    expect(seven.byChainId[BASE_CHAIN_ID]?.volume24hUsd).toBeNull();
  });

  it("matches the chart headline on the recorded Solana, Robinhood, Base, and BNB snapshots", () => {
    const solanaRecords = parseDeskVolumeSnapshotRecords(readJson("solana.json"));
    const solanaClosed = closedSnapshotVolumePoints(pointsFromDeskVolumeSnapshots(solanaRecords), nowT);
    const solanaLanes: HomeDeskLaneDay[] = solanaRecords.map((row) => ({
      t: row.t,
      publicEquity24hUsd: row.publicEquity24hUsd,
      private24hUsd: row.private24hUsd,
      etfIndex24hUsd: row.etfIndex24hUsd,
      combined24hUsd: row.combined24hUsd,
    }));
    const robinhoodDays = closedRobinhoodDeskDays(parseRobinhoodDeskDays(readJson("robinhood.json")), nowT);
    const baseDays = closedSnapshotDeskDays(parseSnapshotDeskDays(readJson("base.json"), BASE_DESK), nowT);
    const bnbDays = closedSnapshotDeskDays(parseSnapshotDeskDays(readJson("bnb.json"), BNB_DESK), nowT);
    const board = homeChainClosedRangeBoard({
      solanaClosed,
      solanaLanes,
      robinhoodDays,
      baseDays,
      bnbDays,
    });
    let merged = mergeHomeDeskSnapshotPoints(solanaClosed, robinhoodDays);
    merged = mergeAdditionalDeskDays(merged, baseDays);
    merged = mergeAdditionalDeskDays(merged, bnbDays);

    const coverage: Record<string, Record<string, number>> = {};
    for (const range of ["7d", "14d", "30d"] as const) {
      const snapshot = board[range];
      const headline = sumVolumePoints(filterVolumeRange(merged, range));
      expect(snapshot.headlineUsd).toBe(headline);
      const chainSum = [SOLANA_CHAIN_ID, ROBINHOOD_CHAIN_ID, BASE_CHAIN_ID, BNB_CHAIN_ID].reduce(
        (sum, chainId) => sum + (snapshot.byChainId[chainId]?.combinedUsd ?? 0),
        0,
      );
      expect(chainSum).toBe(snapshot.headlineUsd);
      coverage[range] = {
        window: snapshot.windowDayCount,
        solana: snapshot.byChainId[SOLANA_CHAIN_ID]?.days ?? 0,
        robinhood: snapshot.byChainId[ROBINHOOD_CHAIN_ID]?.days ?? 0,
        base: snapshot.byChainId[BASE_CHAIN_ID]?.days ?? 0,
        bnb: snapshot.byChainId[BNB_CHAIN_ID]?.days ?? 0,
      };
    }
    expect(coverage["7d"]?.window).toBe(7);
    expect(coverage["7d"]?.solana).toBeLessThanOrEqual(7);
    expect(coverage["30d"]?.window).toBeLessThanOrEqual(30);
    expect(coverage["30d"]?.solana).toBeGreaterThan(0);
    expect((coverage["30d"]?.robinhood ?? 0) <= (coverage["30d"]?.window ?? 0)).toBe(true);
  });
});
