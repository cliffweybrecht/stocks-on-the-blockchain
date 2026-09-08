"use client";

import { useMemo, useState } from "react";
import { formatChartDate, formatChartTick, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";

const RANGES = [
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "180d", label: "180D", days: 180 },
  { id: "all", label: "All", days: null },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

const WIDTH = 800;
const HEIGHT = 280;
const PAD = { top: 16, right: 16, bottom: 28, left: 52 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

function filterRange(points: readonly VolumeHistoryPoint[], range: RangeId): VolumeHistoryPoint[] {
  if (points.length === 0) return [];
  const spec = RANGES.find((row) => row.id === range);
  if (!spec || spec.days === null) return [...points];
  const last = points[points.length - 1];
  if (!last) return [...points];
  const cutoff = last.t - spec.days * 86_400;
  const filtered = points.filter((point) => point.t >= cutoff);
  return filtered.length > 0 ? filtered : [...points];
}

function scale(points: readonly VolumeHistoryPoint[]) {
  const minT = points[0]?.t ?? 0;
  const maxT = points[points.length - 1]?.t ?? 1;
  const maxY = Math.max(...points.map((point) => point.cumulativeUsd), 0);
  const spanT = Math.max(maxT - minT, 1);
  const spanY = maxY > 0 ? maxY : 1;
  return {
    minT,
    maxT,
    maxY,
    x: (t: number) => PAD.left + ((t - minT) / spanT) * INNER_W,
    y: (value: number) => PAD.top + INNER_H - (value / spanY) * INNER_H,
  };
}

function areaPath(points: readonly VolumeHistoryPoint[], map: ReturnType<typeof scale>): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "";
  const line = points.map((point) => `${map.x(point.t).toFixed(2)},${map.y(point.cumulativeUsd).toFixed(2)}`).join(" L ");
  return `M ${map.x(first.t).toFixed(2)},${(PAD.top + INNER_H).toFixed(2)} L ${line} L ${map.x(last.t).toFixed(2)},${(PAD.top + INNER_H).toFixed(2)} Z`;
}

function linePath(points: readonly VolumeHistoryPoint[], map: ReturnType<typeof scale>): string {
  if (points.length === 0) return "";
  return `M ${points.map((point) => `${map.x(point.t).toFixed(2)},${map.y(point.cumulativeUsd).toFixed(2)}`).join(" L ")}`;
}

function nearestPoint(points: readonly VolumeHistoryPoint[], map: ReturnType<typeof scale>, svgX: number) {
  let best = points[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const dist = Math.abs(map.x(point.t) - svgX);
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best ?? null;
}

export function VolumeSinceInceptionChart({ history }: { history: EquityVolumeHistoryResult }) {
  const [range, setRange] = useState<RangeId>("all");
  const [hover, setHover] = useState<VolumeHistoryPoint | null>(null);

  const visible = useMemo(() => filterRange(history.points, range), [history.points, range]);
  const map = useMemo(() => scale(visible), [visible]);
  const latest = visible[visible.length - 1] ?? history.points[history.points.length - 1] ?? null;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => map.maxY * frac);
  const xTicks = visible.length > 1
    ? [0, 0.33, 0.66, 1].map((frac) => {
        const t = map.minT + (map.maxT - map.minT) * frac;
        const closest = nearestPoint(visible, map, map.x(t));
        return closest?.t ?? t;
      })
    : visible[0]
      ? [visible[0].t]
      : [];

  return (
    <section className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium tracking-tight">Total Volume Since Inception</h2>
          {history.available && latest ? (
            <p className="num mt-1 text-3xl font-medium text-primary">{formatUsdCompact(latest.cumulativeUsd)}</p>
          ) : null}
        </div>
        {history.available ? (
          <div className="flex flex-wrap gap-1">
            {RANGES.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setRange(row.id)}
                className={`rounded-md px-2 py-1 text-xs ${
                  range === row.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {row.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {history.available && visible.length > 0 ? (
        <div className="relative mt-3">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-[240px] w-full sm:h-[280px]"
            role="img"
            aria-label="Cumulative Solana tokenized equity volume"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH;
              setHover(nearestPoint(visible, map, svgX));
            }}
          >
            <defs>
              <linearGradient id="volume-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--volume)" stopOpacity="0.38" />
                <stop offset="100%" stopColor="var(--volume)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={map.y(tick)}
                  y2={map.y(tick)}
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 8}
                  y={map.y(tick) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize="10"
                >
                  {formatUsdCompact(tick)}
                </text>
              </g>
            ))}
            {xTicks.map((tick, index) => (
              <text
                key={`${tick}-${index}`}
                x={map.x(tick)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {formatChartTick(tick)}
              </text>
            ))}
            <path d={areaPath(visible, map)} fill="url(#volume-area)" />
            <path
              d={linePath(visible, map)}
              fill="none"
              stroke="var(--volume)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hover ? (
              <g>
                <line
                  x1={map.x(hover.t)}
                  x2={map.x(hover.t)}
                  y1={PAD.top}
                  y2={PAD.top + INNER_H}
                  stroke="var(--volume)"
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                />
                <circle cx={map.x(hover.t)} cy={map.y(hover.cumulativeUsd)} r="3.5" fill="var(--volume)" />
              </g>
            ) : null}
          </svg>
          {hover ? (
            <div className="pointer-events-none absolute top-2 right-2 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs shadow-sm">
              <p className="text-muted-foreground">{formatChartDate(hover.t)}</p>
              <p className="num mt-0.5 text-foreground">{formatUsdFull(hover.cumulativeUsd)}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 text-center">
          <p className="max-w-md text-sm text-muted-foreground">
            {history.emptyReason ?? "Historical volume series is unavailable. The desk does not invent points."}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{history.definition}</p>
    </section>
  );
}
