import { describe, expect, it } from "vitest";
import { easternMidnightUnix } from "../volume-snapshots";
import {
  deskLiquidityClosesFromDays,
  deskLiquidityClosesFromHistory,
  deskLiquidityRangeView,
  mergeDeskLiquidityCloses,
} from "../desk-liquidity-chart";
import type { EquityCardLiquidityHistory } from "../equity-card-range-liquidity";

function close(date: string, liquidityUsd: number) {
  return { date, t: easternMidnightUnix(date), liquidityUsd };
}

describe("desk liquidity chart", () => {
  it("keeps an explicit 0 and omits a null day", () => {
    const closes = deskLiquidityClosesFromDays([
      { date: "2026-10-18", t: easternMidnightUnix("2026-10-18"), displayedLiquidityUsd: 0 },
      { date: "2026-10-19", t: easternMidnightUnix("2026-10-19"), displayedLiquidityUsd: null },
      { date: "2026-10-17", t: easternMidnightUnix("2026-10-17"), displayedLiquidityUsd: 10 },
    ]);
    expect(closes.map((row) => row.date)).toEqual(["2026-10-17", "2026-10-18"]);
    expect(closes[1]?.liquidityUsd).toBe(0);
  });

  it("sums recorded assets and leaves a day with no reserves out", () => {
    const history: EquityCardLiquidityHistory = {
      lastClosedDay: "2026-10-19",
      snapshotDays: ["2026-10-18", "2026-10-19"],
      byAsset: {
        a: [close("2026-10-18", 4), close("2026-10-19", 1)],
        b: [close("2026-10-18", 6)],
      },
    };
    const closes = deskLiquidityClosesFromHistory(history);
    expect(closes).toEqual([
      { date: "2026-10-18", t: easternMidnightUnix("2026-10-18"), liquidityUsd: 10 },
      { date: "2026-10-19", t: easternMidnightUnix("2026-10-19"), liquidityUsd: 1 },
    ]);
  });

  it("omits a chain that did not record the day instead of adding $0", () => {
    const merged = mergeDeskLiquidityCloses([
      [close("2026-10-18", 10), close("2026-10-19", 3)],
      [close("2026-10-19", 7)],
    ]);
    expect(merged.map((row) => [row.date, row.liquidityUsd])).toEqual([
      ["2026-10-18", 10],
      ["2026-10-19", 10],
    ]);
  });

  it("uses the latest window day for 24H and averages only recorded closes", () => {
    const closes = [close("2026-10-17", 10), close("2026-10-18", 0), close("2026-10-19", 30)];
    const week = [
      easternMidnightUnix("2026-10-17"),
      easternMidnightUnix("2026-10-18"),
      easternMidnightUnix("2026-10-19"),
    ];
    expect(deskLiquidityRangeView(closes, "24h", [week[2]!])).toMatchObject({
      basis: "close",
      liquidityUsd: 30,
      days: 1,
      caption: "24H · 2026-10-19 · latest 11:59 PM ET close",
    });
    expect(deskLiquidityRangeView(closes, "24h", [week[1]!]).liquidityUsd).toBe(0);
    expect(deskLiquidityRangeView(closes, "24h", [easternMidnightUnix("2026-10-16")])).toMatchObject({
      basis: "empty",
      liquidityUsd: null,
      series: [],
    });
    expect(deskLiquidityRangeView(closes, "7d", week)).toMatchObject({
      basis: "average",
      liquidityUsd: 13.33,
      days: 3,
    });
    const gapped = deskLiquidityRangeView(
      [close("2026-10-17", 10), close("2026-10-19", 30)],
      "7d",
      week,
    );
    expect(gapped.days).toBe(2);
    expect(gapped.liquidityUsd).toBe(20);
    expect(gapped.series.map((row) => row.date)).toEqual(["2026-10-17", "2026-10-19"]);
    expect(gapped.caption).toContain("2 of 7 days");
  });
});
