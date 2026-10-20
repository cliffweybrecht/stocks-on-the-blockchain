"use client";

import { useState, type ReactNode } from "react";
import { formatUsdCompact } from "@/lib/market/format";
import {
  formatLendingCapturedAt,
  formatLendingFractionPct,
  lendingHistorySeries,
  lendingHistoryWindow,
  type LendingHistoryPoint,
  type LendingHistoryRange,
} from "@/lib/market/lending-snapshot";

const RANGES: { id: LendingHistoryRange; label: string }[] = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All" },
];

export function LendingHistoryChart({
  history,
  initialRange = "7d",
}: {
  history: readonly LendingHistoryPoint[];
  initialRange?: LendingHistoryRange;
}) {
  const [range, setRange] = useState<LendingHistoryRange>(initialRange);
  const points = lendingHistoryWindow(history, range);
  const series = lendingHistorySeries(points);
  const latest = points[points.length - 1];
  const timeLabel = formatLendingCapturedAt(latest?.capturedAt);
  return (
    <section className="max-w-3xl space-y-3" data-lending-history={series.kind} data-lending-history-range={range}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium text-foreground">Over time</h3>
        <div className="flex flex-wrap gap-1" role="group" aria-label="How many days to show">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={range === item.id}
              className={`rounded-full px-3 py-1.5 text-sm ${range === item.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
              onClick={() => setRange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground" data-lending-freshness="history">
        Daily snapshots on this desk · {timeLabel}
      </p>
      {series.kind === "empty" ? (
        <p className="text-sm leading-6 text-muted-foreground">No daily snapshot is stored yet. Earlier days are not filled in.</p>
      ) : null}
      {series.kind === "single" ? (
        <p className="text-sm leading-6 text-muted-foreground">
          One daily snapshot, {series.point.date}. The chart starts once a second day is stored. Earlier days are not filled in.
        </p>
      ) : null}
      {series.kind === "line" ? <HistoryLines points={series.points} /> : null}
    </section>
  );
}

function HistoryLines({ points }: { points: readonly LendingHistoryPoint[] }) {
  return (
    <div className="space-y-4">
      <MoneyChart points={points} />
      <FullChart points={points} />
    </div>
  );
}

function MoneyChart({ points }: { points: readonly LendingHistoryPoint[] }) {
  const values = points.flatMap((point) => [point.collateralUsd, point.stableBorrowedUsd].filter((value): value is number => value !== null && value >= 0));
  if (values.length === 0) {
    return <p className="text-sm leading-6 text-muted-foreground">No dollar amounts were stored for these days.</p>;
  }
  const max = Math.max(1, ...values);
  const collateral = linePath(points, (point) => point.collateralUsd, max);
  const borrowed = linePath(points, (point) => point.stableBorrowedUsd, max);
  return (
    <figure className="space-y-2">
      <ChartFrame
        label="Stock locked and dollars borrowed by daily snapshot"
        maxLabel={formatUsdCompact(max)}
        points={points}
        max={max}
      >
        {collateral ? <path d={collateral} fill="none" stroke="currentColor" strokeWidth="2" /> : null}
        {borrowed ? <path d={borrowed} fill="none" stroke="currentColor" strokeOpacity="0.4" strokeWidth="2" /> : null}
        {points.map((point, index) => (
          <g key={point.date}>
            {dot(points, index, point.collateralUsd, max, 1)}
            {dot(points, index, point.stableBorrowedUsd, max, 0.4)}
          </g>
        ))}
      </ChartFrame>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-sm leading-6 text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-foreground" aria-hidden />
          Stock locked
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-foreground/40" aria-hidden />
          Dollars borrowed
        </span>
      </figcaption>
      <PointList points={points} />
    </figure>
  );
}

function FullChart({ points }: { points: readonly LendingHistoryPoint[] }) {
  const values = points.map((point) => point.utilization).filter((value): value is number => value !== null && value >= 0);
  if (values.length === 0) {
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        How full was not reported for these days. It counts only pools that publish their own lend supply.
      </p>
    );
  }
  const max = Math.max(1, ...values);
  const line = linePath(points, (point) => point.utilization, max);
  return (
    <figure className="space-y-2">
      <ChartFrame label="How full by daily snapshot" maxLabel={formatLendingFractionPct(max)} points={points} max={max}>
        {line ? <path d={line} fill="none" stroke="currentColor" strokeWidth="2" /> : null}
        {points.map((point, index) => (
          <g key={point.date}>{dot(points, index, point.utilization, max, 1)}</g>
        ))}
      </ChartFrame>
      <figcaption className="text-sm leading-6 text-muted-foreground">
        How full is dollars borrowed divided by dollars supplied to lend. Jupiter Lend, Venus, and Frankencoin are left out. They do not publish their own lend supply. A missing day stays blank.
      </figcaption>
    </figure>
  );
}

function ChartFrame({
  label,
  maxLabel,
  points,
  max,
  children,
}: {
  label: string;
  maxLabel: string;
  points: readonly LendingHistoryPoint[];
  max: number;
  children: ReactNode;
}) {
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-40 w-full text-foreground" role="img" aria-label={label}>
      <line x1={PAD_L} y1={yAt(0, max)} x2={WIDTH - PAD_R} y2={yAt(0, max)} stroke="currentColor" strokeOpacity="0.15" />
      <line x1={PAD_L} y1={yAt(max, max)} x2={WIDTH - PAD_R} y2={yAt(max, max)} stroke="currentColor" strokeOpacity="0.08" />
      <text x={PAD_L - 8} y={yAt(max, max) + 4} textAnchor="end" fill="currentColor" opacity="0.6" fontSize="11">
        {maxLabel}
      </text>
      {children}
      {first ? (
        <text x={xAt(0, points.length)} y={HEIGHT - 6} textAnchor="start" fill="currentColor" opacity="0.6" fontSize="11">
          {first.date}
        </text>
      ) : null}
      {last && points.length > 1 ? (
        <text x={xAt(points.length - 1, points.length)} y={HEIGHT - 6} textAnchor="end" fill="currentColor" opacity="0.6" fontSize="11">
          {last.date}
        </text>
      ) : null}
    </svg>
  );
}

function PointList({ points }: { points: readonly LendingHistoryPoint[] }) {
  return (
    <ul className="sr-only">
      {points.map((point) => (
        <li key={point.date}>
          {point.date}: stock {formatUsdCompact(point.collateralUsd)}, borrowed {formatUsdCompact(point.stableBorrowedUsd)}, how full{" "}
          {formatLendingFractionPct(point.utilization)}
        </li>
      ))}
    </ul>
  );
}

const WIDTH = 640;
const HEIGHT = 168;
const PAD_L = 52;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 24;
const INNER_W = WIDTH - PAD_L - PAD_R;
const INNER_H = HEIGHT - PAD_T - PAD_B;

function xAt(index: number, count: number): number {
  return PAD_L + (count <= 1 ? INNER_W / 2 : (index / (count - 1)) * INNER_W);
}

function yAt(value: number, max: number): number {
  return PAD_T + INNER_H - (value / max) * INNER_H;
}

function linePath(
  points: readonly LendingHistoryPoint[],
  pick: (point: LendingHistoryPoint) => number | null,
  max: number,
): string | null {
  let path = "";
  let drawing = false;
  points.forEach((point, index) => {
    const value = pick(point);
    if (value === null || value < 0) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${xAt(index, points.length).toFixed(1)} ${yAt(value, max).toFixed(1)}`;
    drawing = true;
  });
  return path.includes("L") ? path : null;
}

function dot(points: readonly LendingHistoryPoint[], index: number, value: number | null, max: number, opacity: number) {
  if (value === null || value < 0) return null;
  return <circle cx={xAt(index, points.length)} cy={yAt(value, max)} r="2.5" fill="currentColor" opacity={opacity} />;
}
