import {
  filterVolumeRange,
  sumVolumePoints,
  type ClosedVolumeChartRangeId,
} from "./daily-volume-view";
import { equityCardRangeCoverageHint } from "./equity-card-range-volume";
import { mergeAdditionalDeskDays, mergeHomeDeskSnapshotPoints } from "./home-desk-volume";
import type { RobinhoodDeskDay } from "./robinhood-desk-volume";
import type { SnapshotDeskDay } from "./snapshot-desk-volume";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type VolumeHistoryPoint } from "./types";

/**
 * One closed desk day with the same lane fields the snapshot files store.
 * Null is unreported. A recorded 0 stays 0.
 */
export interface HomeDeskLaneDay {
  t: number;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
}

export interface HomeChainRangeLegs {
  /** Public lane sum. Null when every day in the window left public unreported. */
  volume24hUsd: number | null;
  privateVolume24hUsd: number | null;
  etfVolume24hUsd: number | null;
  /** Combined desk total for the days this chain recorded inside the chart window. */
  combinedUsd: number | null;
  /** How many window days recorded a combined total for this chain. */
  days: number;
}

export interface HomeClosedRangeSnapshot {
  /** Same sum the volume chart headline uses for this range. */
  headlineUsd: number | null;
  /** Closed days in the shared window. May be shorter than the range length. */
  windowDayCount: number;
  byChainId: Record<string, HomeChainRangeLegs>;
}

export type HomeClosedRangeBoard = Record<ClosedVolumeChartRangeId, HomeClosedRangeSnapshot>;

const CLOSED_RANGES: readonly ClosedVolumeChartRangeId[] = ["7d", "14d", "30d"];

/** Same partial-window sentence the equity cards use: `n of N days`. */
export function homeChainRangeCoverageHint(
  range: ClosedVolumeChartRangeId,
  days: number,
): string | null {
  return equityCardRangeCoverageHint(range, days);
}

const CHAIN_SUM_ORDER = [SOLANA_CHAIN_ID, ROBINHOOD_CHAIN_ID, BASE_CHAIN_ID, BNB_CHAIN_ID] as const;

/**
 * Make the reporting chains add to the chart headline bit-for-bit.
 * The residue is a float ulp from addition order, not an extra dollar.
 */
function alignChainSumsToHeadline(
  byChainId: Record<string, HomeChainRangeLegs>,
  headlineUsd: number | null,
): void {
  if (headlineUsd === null) return;
  const present = CHAIN_SUM_ORDER.filter((id) => {
    const value = byChainId[id]?.combinedUsd;
    return value !== null && value !== undefined && Number.isFinite(value);
  });
  if (present.length === 0) return;
  let running = 0;
  for (const id of present.slice(0, -1)) {
    running += byChainId[id]!.combinedUsd ?? 0;
  }
  const last = present[present.length - 1]!;
  byChainId[last]!.combinedUsd = headlineUsd - running;
}

function emptyLegs(): HomeChainRangeLegs {
  return {
    volume24hUsd: null,
    privateVolume24hUsd: null,
    etfVolume24hUsd: null,
    combinedUsd: null,
    days: 0,
  };
}

function addLane(current: number, any: boolean, value: number | null): { sum: number; any: boolean } {
  if (value === null || !Number.isFinite(value) || value < 0) return { sum: current, any };
  return { sum: current + value, any: true };
}

/**
 * Sum lane days whose `t` is in the chart window.
 * Days are added in time order. A missing lane is skipped, not added as 0.
 */
export function sumHomeDeskLaneDays(
  days: readonly HomeDeskLaneDay[],
  windowTimes: ReadonlySet<number>,
): HomeChainRangeLegs {
  const ordered = days
    .filter(
      (day) =>
        windowTimes.has(day.t) &&
        day.combined24hUsd !== null &&
        Number.isFinite(day.combined24hUsd) &&
        day.combined24hUsd >= 0,
    )
    .sort((a, b) => a.t - b.t);
  const seen = new Set<number>();
  let publicSum = 0;
  let privateSum = 0;
  let etfSum = 0;
  let combinedSum = 0;
  let publicAny = false;
  let privateAny = false;
  let etfAny = false;
  let combinedAny = false;
  let counted = 0;
  for (const day of ordered) {
    if (seen.has(day.t)) continue;
    seen.add(day.t);
    const combined = addLane(combinedSum, combinedAny, day.combined24hUsd);
    combinedSum = combined.sum;
    combinedAny = combined.any;
    const publicLane = addLane(publicSum, publicAny, day.publicEquity24hUsd);
    publicSum = publicLane.sum;
    publicAny = publicLane.any;
    const privateLane = addLane(privateSum, privateAny, day.private24hUsd);
    privateSum = privateLane.sum;
    privateAny = privateLane.any;
    const etfLane = addLane(etfSum, etfAny, day.etfIndex24hUsd);
    etfSum = etfLane.sum;
    etfAny = etfLane.any;
    counted += 1;
  }
  return {
    volume24hUsd: publicAny ? publicSum : null,
    privateVolume24hUsd: privateAny ? privateSum : null,
    etfVolume24hUsd: etfAny ? etfSum : null,
    combinedUsd: combinedAny ? combinedSum : null,
    days: counted,
  };
}

function toLaneDay(day: HomeDeskLaneDay): HomeDeskLaneDay {
  return {
    t: day.t,
    publicEquity24hUsd: day.publicEquity24hUsd,
    private24hUsd: day.private24hUsd,
    etfIndex24hUsd: day.etfIndex24hUsd,
    combined24hUsd: day.combined24hUsd,
  };
}

/**
 * Closed-range totals for the home chain rows.
 * The window is the newest N days of the merged desk series, the same series
 * `filterVolumeRange` feeds the volume chart headline.
 */
export function homeChainClosedRangeBoard(input: {
  solanaClosed: readonly VolumeHistoryPoint[];
  solanaLanes: readonly HomeDeskLaneDay[];
  robinhoodDays: readonly RobinhoodDeskDay[];
  baseDays: readonly SnapshotDeskDay[];
  bnbDays: readonly SnapshotDeskDay[];
}): HomeClosedRangeBoard {
  const robinhood = input.robinhoodDays.map(toLaneDay);
  const base = input.baseDays.map(toLaneDay);
  const bnb = input.bnbDays.map(toLaneDay);
  let merged = mergeHomeDeskSnapshotPoints(input.solanaClosed, input.robinhoodDays);
  merged = mergeAdditionalDeskDays(merged, input.baseDays);
  merged = mergeAdditionalDeskDays(merged, input.bnbDays);

  const board = {} as HomeClosedRangeBoard;
  for (const range of CLOSED_RANGES) {
    const visible = filterVolumeRange(merged, range);
    const times = new Set(visible.map((point) => point.t));
    const solanaTimes = new Set(
      input.solanaClosed.filter((point) => times.has(point.t)).map((point) => point.t),
    );
    const solanaLanes = sumHomeDeskLaneDays(input.solanaLanes, solanaTimes);
    const solanaFromPoints = sumVolumePoints(input.solanaClosed.filter((point) => solanaTimes.has(point.t)));
    const headlineUsd = sumVolumePoints(visible);
    const byChainId: Record<string, HomeChainRangeLegs> = {
      [SOLANA_CHAIN_ID]: {
        ...solanaLanes,
        combinedUsd: solanaFromPoints,
        days: solanaTimes.size,
      },
      [ROBINHOOD_CHAIN_ID]: sumHomeDeskLaneDays(robinhood, times),
      [BASE_CHAIN_ID]: sumHomeDeskLaneDays(base, times),
      [BNB_CHAIN_ID]: sumHomeDeskLaneDays(bnb, times),
    };
    // Chain sums and the chart sum add the same dollars in a different order.
    // Fold the rounding residue into the last reporting chain so the rows equal the headline.
    alignChainSumsToHeadline(byChainId, headlineUsd);
    board[range] = {
      headlineUsd,
      windowDayCount: visible.length,
      byChainId,
    };
  }
  return board;
}

export function homeChainRangeLegsOrEmpty(
  board: HomeClosedRangeBoard,
  chainId: string,
  range: ClosedVolumeChartRangeId,
): HomeChainRangeLegs {
  return board[range].byChainId[chainId] ?? emptyLegs();
}
