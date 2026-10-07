import { chainCombinedVolume24h } from "./aggregate";
import type { VolumeChartRangeId } from "./daily-volume-view";
import { compareNullableDesc, sumNullable } from "./numbers";
import {
  closedRobinhoodDeskDays,
  robinhoodSnapshotChainShell,
  type RobinhoodDeskDay,
} from "./robinhood-desk-volume";
import { ROBINHOOD_CHAIN_ID, type ChainVolume, type VolumeHistoryPoint } from "./types";

/**
 * Home hero + chain list. Solana keeps its own 24H live rollup and its closed
 * snapshot days. Robinhood contributes recorded desk bars only: Eastern day
 * keys, in-progress day omitted, null omitted rather than stored as $0.
 * Robinhood 24H is the newest closed snapshot, a DexScreener trailing h24
 * sample. Robinhood has no hourly series.
 */

export const HOME_24H_ROBINHOOD_HEADLINE =
  "24h · Solana live public + private + ETF/index, plus the last closed Robinhood Chain snapshot. Missing legs are omitted, not zero.";

/** True when a plotted day is also a Robinhood snapshot day. Same `t` means that day was summed. */
export function snapshotSeriesIncludesRobinhood(
  points: readonly VolumeHistoryPoint[],
  robinhoodDays: readonly RobinhoodDeskDay[] | null | undefined,
): boolean {
  if (!robinhoodDays || robinhoodDays.length === 0 || points.length === 0) return false;
  const times = new Set(
    robinhoodDays.filter((day) => day.combined24hUsd !== null && day.t > 0).map((day) => day.t),
  );
  return points.some((point) => times.has(point.t));
}

export function lastReportedRobinhoodDay(
  days: readonly RobinhoodDeskDay[] | null | undefined,
): RobinhoodDeskDay | null {
  if (!days || days.length === 0) return null;
  const reported = days.filter((day) => day.combined24hUsd !== null && day.t > 0);
  reported.sort((a, b) => a.t - b.t);
  return reported[reported.length - 1] ?? null;
}

/**
 * Per Eastern day, Solana snapshot + Robinhood snapshot.
 * A day with only one chain keeps that chain's volume. The other chain is
 * omitted, not added as $0. Days with nothing reported are left out.
 * Pass `nowT` to drop the in-progress America/New_York date from Robinhood.
 */
export function mergeHomeDeskSnapshotPoints(
  solanaClosed: readonly VolumeHistoryPoint[],
  robinhoodDays: readonly RobinhoodDeskDay[] | null | undefined,
  nowT?: number,
): VolumeHistoryPoint[] {
  const robinhood =
    nowT === undefined
      ? (robinhoodDays ?? [])
      : closedRobinhoodDeskDays(robinhoodDays ?? [], nowT);
  const byT = new Map<number, { solana: number | null; robinhood: number | null }>();

  for (const point of solanaClosed) {
    if (point.kind === "rolling_24h") continue;
    if (!Number.isFinite(point.t) || point.t <= 0) continue;
    if (!Number.isFinite(point.volumeUsd) || point.volumeUsd < 0) continue;
    const row = byT.get(point.t) ?? { solana: null, robinhood: null };
    row.solana = point.volumeUsd;
    byT.set(point.t, row);
  }

  for (const day of robinhood) {
    if (!Number.isFinite(day.t) || day.t <= 0) continue;
    if (day.combined24hUsd === null || day.combined24hUsd < 0) continue;
    const row = byT.get(day.t) ?? { solana: null, robinhood: null };
    row.robinhood = day.combined24hUsd;
    byT.set(day.t, row);
  }

  const points: VolumeHistoryPoint[] = [];
  for (const [t, row] of byT) {
    const volumeUsd = sumNullable([row.solana, row.robinhood]);
    if (volumeUsd === null) continue;
    points.push({ t, volumeUsd, kind: "calendar_day" });
  }
  points.sort((a, b) => a.t - b.t);
  return points;
}

export function includeRobinhoodInDeskHeadline<T extends { volumeUsd: number | null; caption: string }>(
  headline: T,
  range: VolumeChartRangeId,
  robinhoodDays: readonly RobinhoodDeskDay[] | null | undefined,
): T {
  const latest = lastReportedRobinhoodDay(robinhoodDays);
  if (!latest || latest.combined24hUsd === null) return headline;

  if (range === "24h") {
    const volumeUsd = sumNullable([headline.volumeUsd, latest.combined24hUsd]);
    if (volumeUsd === null) return headline;
    return { ...headline, volumeUsd, caption: HOME_24H_ROBINHOOD_HEADLINE };
  }

  if (headline.volumeUsd === null) return headline;
  return {
    ...headline,
    caption: `${headline.caption} · Solana + Robinhood Chain`,
  };
}

/** Home chain row. Volume legs are the last closed snapshot. No closed day stays null. */
export function robinhoodHomeChainVolume(days: readonly RobinhoodDeskDay[] | null | undefined): ChainVolume {
  const shell = robinhoodSnapshotChainShell();
  const day = lastReportedRobinhoodDay(days);
  if (!day) return shell;
  return {
    ...shell,
    volume24hUsd: day.publicEquity24hUsd,
    privateVolume24hUsd: day.private24hUsd,
    etfVolume24hUsd: day.etfIndex24hUsd,
    displayedLiquidityUsd: day.displayedLiquidityUsd,
    coverageNote: "Robinhood Chain 24H on the home desk is the last closed America/New_York snapshot.",
  };
}

export function robinhoodHomeVolumeDetail(days: readonly RobinhoodDeskDay[] | null | undefined): string {
  const day = lastReportedRobinhoodDay(days);
  if (!day) {
    return "No closed Robinhood snapshot day yet. Missing volume is not reported as zero.";
  }
  return `${day.date} America/New_York · last closed snapshot.`;
}

/** Most combined 24H first. Unreported volume ranks last. One Robinhood row. */
export function rankHomeChains(chains: readonly ChainVolume[]): ChainVolume[] {
  return [...chains].sort((a, b) => {
    const byVolume = compareNullableDesc(chainCombinedVolume24h(a), chainCombinedVolume24h(b));
    if (byVolume !== 0) return byVolume;
    return a.name.localeCompare(b.name);
  });
}

export function homeChainsWithRobinhood(
  listed: readonly ChainVolume[],
  robinhoodDays: readonly RobinhoodDeskDay[] | null | undefined,
): ChainVolume[] {
  const rest = listed.filter((chain) => chain.id !== ROBINHOOD_CHAIN_ID);
  return rankHomeChains([...rest, robinhoodHomeChainVolume(robinhoodDays)]);
}
