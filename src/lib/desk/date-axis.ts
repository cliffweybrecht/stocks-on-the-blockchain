/**
 * Closed-day axis labels. Every plotted day stays on the series; this only
 * chooses which of those days get a label, on one row.
 *
 * 7D labels every day when the centers clear the gap, otherwise every other day.
 * 14D labels every other day, anchored on the latest day.
 * 30D and 90D label every third day, anchored on the latest day, and step
 * wider when that would still collide.
 * A chart with no range pill uses dateAxisRangeForCount.
 * 24H is not a closed-day axis and does not come through here.
 */

export type DateAxisRangeId = "7d" | "14d" | "30d" | "90d";

/**
 * Minimum center-to-center gap for a 10px "Oct 19" label.
 * The label is about 42 viewBox units wide; 64 keeps a gap so neighbors
 * do not touch. Shorter than the hourly "10:00 PM" gap.
 */
export const DATE_AXIS_LABEL_MIN_GAP = 64;

/** Baseline inset from the bottom of the chart viewBox. One row, never staggered. */
export const DATE_AXIS_LABEL_BASELINE = 8;

function baseStride(range: DateAxisRangeId): number {
  if (range === "7d") return 1;
  if (range === "14d") return 2;
  return 3;
}

/** 7D stops at every other day. Longer ranges may step wider until the labels clear. */
function strideCap(range: DateAxisRangeId, count: number): number {
  if (range === "7d") return Math.min(2, count);
  return count;
}

interface Placed<T> {
  tick: T;
  x: number;
}

function byPosition<T>(placed: readonly Placed<T>[], stride: number): Placed<T>[] {
  const chosen: Placed<T>[] = [];
  for (let index = placed.length - 1; index >= 0; index -= stride) {
    chosen.push(placed[index]!);
  }
  chosen.reverse();
  return chosen;
}

function centersClear<T>(chosen: readonly Placed<T>[], minGap: number): boolean {
  for (let index = 1; index < chosen.length; index += 1) {
    if (chosen[index]!.x - chosen[index - 1]!.x < minGap) return false;
  }
  return true;
}

/**
 * Label ticks for a closed-day axis, oldest first.
 * `ticks` is the plotted days. The newest day (rightmost finite x) is always labeled.
 * `xOf` is the viewBox x of that tick. Non-finite positions are not labeled.
 */
export function selectDateAxisLabelTicks<T>(
  ticks: readonly T[],
  range: DateAxisRangeId,
  xOf: (tick: T, index: number) => number,
  minGap = DATE_AXIS_LABEL_MIN_GAP,
): T[] {
  const placed: Placed<T>[] = [];
  for (let index = 0; index < ticks.length; index += 1) {
    const tick = ticks[index]!;
    const x = xOf(tick, index);
    if (!Number.isFinite(x)) continue;
    placed.push({ tick, x });
  }
  if (placed.length === 0) return [];
  placed.sort((a, b) => a.x - b.x);
  const gap = Number.isFinite(minGap) && minGap > 0 ? minGap : 0;
  const cap = strideCap(range, placed.length);
  let stride = Math.min(baseStride(range), cap);
  let chosen = byPosition(placed, stride);
  while (stride < cap && !centersClear(chosen, gap)) {
    stride += 1;
    chosen = byPosition(placed, stride);
  }
  return chosen.map((row) => row.tick);
}

/**
 * Range rule for a date axis that is not tied to the 7D/14D/30D pills.
 * Short windows follow 7D, two-week windows follow 14D, longer windows follow 30D.
 */
export function dateAxisRangeForCount(count: number): DateAxisRangeId {
  if (!Number.isFinite(count) || count <= 7) return "7d";
  if (count <= 14) return "14d";
  return "30d";
}
