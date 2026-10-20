"use client";

import { useDeskVolumeRange } from "@/components/desk-volume-range";
import { DESK_CHART_STROKE, monotoneLinePath } from "@/lib/desk/chart-curve";
import { VOLUME_CHART_RANGES, type VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import { formatCount, formatTokenAmount, formatUsdCompact } from "@/lib/market/format";
import {
  consecutiveChange,
  holderDaySlots,
  type HolderAssetPoint,
} from "@/lib/market/holder-snapshots";

const WIDTH = 800;
const HEIGHT = 156;
const PAD = { top: 12, right: 12, bottom: 32, left: 44 };
const INNER_W = WIDTH - PAD.left - PAD.right;
const INNER_H = HEIGHT - PAD.top - PAD.bottom;

function signedCount(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "0";
  const body = formatCount(Math.abs(value));
  return value > 0 ? `+${body}` : `−${body}`;
}

function signedUsd(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "$0";
  const body = formatUsdCompact(Math.abs(value));
  return value > 0 ? `+${body}` : `−${body}`;
}

function signedUnits(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0) return "0";
  const body = formatTokenAmount(Math.abs(value));
  return value > 0 ? `+${body}` : `−${body}`;
}

function roundedTopBar(x: number, y: number, width: number, height: number): string {
  if (width <= 0 || height <= 0) return "";
  const radius = Math.min(6, width / 2, height);
  const right = x + width;
  const bottom = y + height;
  return [
    `M ${x.toFixed(2)} ${bottom.toFixed(2)}`,
    `L ${x.toFixed(2)} ${(y + radius).toFixed(2)}`,
    `Q ${x.toFixed(2)} ${y.toFixed(2)} ${(x + radius).toFixed(2)} ${y.toFixed(2)}`,
    `L ${(right - radius).toFixed(2)} ${y.toFixed(2)}`,
    `Q ${right.toFixed(2)} ${y.toFixed(2)} ${right.toFixed(2)} ${(y + radius).toFixed(2)}`,
    `L ${right.toFixed(2)} ${bottom.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function Change({ value, format }: { value: number | null; format: (value: number | null) => string | null }) {
  const text = format(value);
  if (!text) return null;
  const tone = value !== null && value > 0 ? "text-[#B7FF3C]" : value !== null && value < 0 ? "text-price-down" : "text-neutral-400";
  return (
    <span className={`num ${tone}`} data-holder-change-text>
      {text}
    </span>
  );
}

/**
 * Holders and tokenized supply, separate from volume.
 * The range toggle is the desk's 24H | 7D | 14D | 30D control.
 * Missing Eastern days are empty slots. Changes sum only consecutive real days.
 */
export function HolderSupplyPanel({
  kicker,
  points,
  footnote,
  showUnits = false,
}: {
  kicker: string;
  points: readonly HolderAssetPoint[];
  footnote: string;
  /** Asset pages also show token units. Chain totals are dollars only. */
  showUnits?: boolean;
}) {
  const { range, setRange } = useDeskVolumeRange("7d");
  const slots = holderDaySlots(points, range, (row) => row);
  const latest = [...slots].reverse().find((slot) => !slot.empty && slot.value)?.value ?? null;
  const holderChange = consecutiveChange(slots.map((slot) => ({ ...slot, value: slot.value?.holderCount ?? null })));
  const supplyUsdChange = consecutiveChange(slots.map((slot) => ({ ...slot, value: slot.value?.supplyUsd ?? null })));
  const supplyChange = consecutiveChange(slots.map((slot) => ({ ...slot, value: slot.value?.totalSupply ?? null })));
  const holderSlots = slots.map((slot) => ({ ...slot, value: slot.empty ? null : slot.value?.holderCount ?? null }));
  const finite = holderSlots.map((slot) => slot.value).filter((value): value is number => value !== null && Number.isFinite(value));
  const max = finite.length > 0 ? Math.max(...finite, 0) : 0;
  const plotBottom = PAD.top + INNER_H;
  const slotW = slots.length > 0 ? INNER_W / slots.length : INNER_W;
  const barW = Math.max(4, Math.min(28, slotW * 0.62));
  const curve = holderSlots
    .map((slot, index) => {
      if (slot.value === null) return null;
      const x = PAD.left + slotW * index + slotW / 2;
      const y = max <= 0 ? plotBottom : PAD.top + INNER_H - (slot.value / max) * INNER_H;
      return { x, y, index };
    })
    .filter((point): point is { x: number; y: number; index: number } => point !== null);
  const runs: { x: number; y: number }[][] = [];
  for (const point of curve) {
    const previous = runs[runs.length - 1];
    const last = previous?.[previous.length - 1];
    const lastIndex = last ? curve.find((row) => row.x === last.x)?.index : undefined;
    if (!previous || lastIndex === undefined || point.index !== lastIndex + 1) runs.push([{ x: point.x, y: point.y }]);
    else previous.push({ x: point.x, y: point.y });
  }
  const rangeLabel = VOLUME_CHART_RANGES.find((row) => row.id === range)?.label ?? "7D";

  return (
    <section
      className="rounded-xl border border-border bg-card/80 px-4 py-4 sm:px-5"
      data-holder-supply
      data-holder-range={range}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3">
        <div className="min-w-0">
          <h2 className="font-heading text-[9px] leading-tight font-medium tracking-wide text-foreground/90">{kicker}</h2>
          <p className="num mt-1 text-3xl font-medium text-primary" data-holder-count>
            {formatCount(latest?.holderCount ?? null)}
            {holderChange !== null ? (
              <span className="ml-2 align-middle text-sm font-medium">
                <Change value={holderChange} format={signedCount} />
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground" data-holder-caption>
            {footnote}
            {holderChange === null ? ` ${rangeLabel} change needs consecutive snapshot days.` : ` ${rangeLabel} change is consecutive snapshot days only.`}
          </p>
          <p className="num mt-3 text-xl font-medium tracking-tight text-foreground" data-supply-usd>
            {formatUsdCompact(latest?.supplyUsd ?? null)}
            {supplyUsdChange !== null ? (
              <span className="ml-2 text-sm font-medium">
                <Change value={supplyUsdChange} format={signedUsd} />
              </span>
            ) : null}
            <span className="ml-2 text-sm font-normal text-neutral-400">supply</span>
          </p>
          {showUnits ? (
            <p className="num mt-1 text-sm text-neutral-300" data-supply-units>
              {formatTokenAmount(latest?.totalSupply ?? null)}
              {supplyChange !== null ? (
                <span className="ml-2">
                  <Change value={supplyChange} format={signedUnits} />
                </span>
              ) : null}
              <span className="ml-2 text-neutral-500">units</span>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-nowrap items-center justify-end gap-1 justify-self-end self-start" data-holder-ranges>
          {VOLUME_CHART_RANGES.map((row) => (
            <button
              key={row.id}
              type="button"
              data-holder-range-button={row.id}
              aria-pressed={range === row.id}
              onClick={() => setRange(row.id as VolumeChartRangeId)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
                range === row.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {row.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3 overflow-hidden rounded-xl" data-holder-plot>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-[140px] w-full"
          role="img"
          aria-label={`${kicker}. Rounded bars are per-token holder totals by Eastern day. A day without a snapshot is empty.`}
        >
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" />
          {slots.map((slot, index) => {
            const x = PAD.left + slotW * index + (slotW - barW) / 2;
            const value = slot.empty ? null : slot.value?.holderCount ?? null;
            if (value === null || max <= 0) {
              return (
                <line
                  key={slot.date}
                  x1={PAD.left + slotW * index + slotW / 2}
                  x2={PAD.left + slotW * index + slotW / 2}
                  y1={plotBottom}
                  y2={plotBottom + 4}
                  stroke="currentColor"
                  className="text-neutral-700"
                  data-holder-slot={slot.date}
                  data-holder-slot-empty="true"
                />
              );
            }
            const height = Math.max((value / max) * INNER_H, value > 0 ? 3 : 0);
            const y = plotBottom - height;
            return (
              <path
                key={slot.date}
                d={roundedTopBar(x, y, barW, height)}
                fill={DESK_CHART_STROKE}
                data-holder-slot={slot.date}
                data-holder-slot-empty="false"
                data-holder-slot-count={value}
              />
            );
          })}
          {runs.map((run, index) =>
            run.length > 1 ? (
              <path
                key={index}
                d={monotoneLinePath(run)}
                fill="none"
                stroke={DESK_CHART_STROKE}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                data-holder-curve="true"
              />
            ) : null,
          )}
          {slots.map((slot, index) => {
            const crowded = slots.length > 10;
            return (
              <text
                key={`${slot.date}-label`}
                x={PAD.left + slotW * index + slotW / 2}
                y={crowded && index % 2 === 1 ? HEIGHT - 6 : HEIGHT - (crowded ? 18 : 8)}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={crowded ? 9 : 10}
                data-holder-tick={slot.date.slice(5)}
              >
                {slot.date.slice(5)}
              </text>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
