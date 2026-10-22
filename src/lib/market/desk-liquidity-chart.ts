import type { VolumeChartRangeId } from "./daily-volume-view";
import { equityCardRangeCoverageHint } from "./equity-card-range-volume";
import type { EquityCardLiquidityHistory } from "./equity-card-range-liquidity";
import { asNonNegativeNumber } from "./numbers";

/**
 * Desk liquidity is a stock: one close per America/New_York day, the nightly
 * snapshot (11:59 PM ET). A missing day is left out. A stored 0 stays 0.
 */
export interface DeskLiquidityClose {
  date: string;
  /** Unix seconds of America/New_York midnight on `date`. */
  t: number;
  liquidityUsd: number;
}

export interface DeskLiquidityRangeView {
  liquidityUsd: number | null;
  /** Recorded closes inside the window. Not the window length. */
  days: number;
  recorded: boolean;
  /** `24H`, `avg 7D`, or `avg 7D · 5 of 7 days`. Empty when nothing was stored. */
  hint: string;
  caption: string;
  /** Oldest first. Days with no stored reserve are omitted. */
  series: DeskLiquidityClose[];
  basis: "close" | "average" | "empty";
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Day-level `displayedLiquidityUsd`. Null is omitted. An explicit 0 is kept. */
export function deskLiquidityClosesFromDays(
  days: readonly { date: string; t: number; displayedLiquidityUsd: number | null }[],
): DeskLiquidityClose[] {
  const closes: DeskLiquidityClose[] = [];
  for (const day of days) {
    const liquidityUsd = asNonNegativeNumber(day.displayedLiquidityUsd);
    if (liquidityUsd === null || !day.date || !Number.isFinite(day.t) || day.t <= 0) continue;
    closes.push({ date: day.date, t: day.t, liquidityUsd: roundUsd(liquidityUsd) });
  }
  closes.sort((a, b) => a.t - b.t);
  return closes;
}

/**
 * Sum of per-asset nightly reserves. An asset with no reserve is omitted, not
 * added as $0. A day whose every asset is missing is left out.
 */
export function deskLiquidityClosesFromHistory(history: EquityCardLiquidityHistory | null | undefined): DeskLiquidityClose[] {
  if (!history) return [];
  const totals = new Map<string, { t: number; sum: number }>();
  for (const series of Object.values(history.byAsset)) {
    for (const point of series) {
      const liquidityUsd = asNonNegativeNumber(point.liquidityUsd);
      if (liquidityUsd === null || !point.date || !Number.isFinite(point.t) || point.t <= 0) continue;
      const row = totals.get(point.date) ?? { t: point.t, sum: 0 };
      row.sum += liquidityUsd;
      totals.set(point.date, row);
    }
  }
  return [...totals.entries()]
    .map(([date, row]) => ({ date, t: row.t, liquidityUsd: roundUsd(row.sum) }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Home chart. Same Eastern midnight sums. A chain with no reserve that day is
 * omitted, not added as $0.
 */
export function mergeDeskLiquidityCloses(groups: readonly (readonly DeskLiquidityClose[])[]): DeskLiquidityClose[] {
  const byT = new Map<number, { date: string; sum: number }>();
  for (const group of groups) {
    for (const close of group) {
      const liquidityUsd = asNonNegativeNumber(close.liquidityUsd);
      if (liquidityUsd === null || close.t <= 0) continue;
      const row = byT.get(close.t) ?? { date: close.date, sum: 0 };
      row.sum += liquidityUsd;
      if (!row.date) row.date = close.date;
      byT.set(close.t, row);
    }
  }
  return [...byT.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, row]) => ({ date: row.date, t, liquidityUsd: roundUsd(row.sum) }));
}

/**
 * Liquidity for the selected range.
 * `windowTs` is the volume chart's closed days (24H is the newest one).
 * Only those days can appear. A window day with no reserve is not drawn.
 * 24H is that latest close. 7D/14D/30D average the recorded closes.
 */
export function deskLiquidityRangeView(
  closes: readonly DeskLiquidityClose[],
  range: VolumeChartRangeId,
  windowTs: readonly number[],
): DeskLiquidityRangeView {
  const allowed = new Set(windowTs.filter((t) => Number.isFinite(t) && t > 0));
  const series = closes.filter((close) => allowed.has(close.t)).sort((a, b) => a.t - b.t);
  if (series.length === 0) {
    return {
      liquidityUsd: null,
      days: 0,
      recorded: false,
      hint: "",
      caption: range === "24h" ? "24H · no 11:59 PM ET close yet" : "No 11:59 PM ET closes in this range",
      series: [],
      basis: "empty",
    };
  }
  if (range === "24h") {
    const latest = series[series.length - 1]!;
    return {
      liquidityUsd: latest.liquidityUsd,
      days: 1,
      recorded: true,
      hint: "24H",
      caption: `24H · ${latest.date} · latest 11:59 PM ET close`,
      series: [latest],
      basis: "close",
    };
  }
  const sum = series.reduce((total, row) => total + row.liquidityUsd, 0);
  const coverage = equityCardRangeCoverageHint(range, series.length);
  const hint = coverage ? `avg ${range.toUpperCase()} · ${coverage}` : `avg ${range.toUpperCase()}`;
  return {
    liquidityUsd: roundUsd(sum / series.length),
    days: series.length,
    recorded: true,
    hint,
    caption: `${hint} · average of 11:59 PM ET closes`,
    series,
    basis: "average",
  };
}
