import type { DeskRolling24hVolumes } from "./daily-volume-view";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "./types";
import {
  DESK_HOURLY_ROLLING_VOLUME_DEFINITION,
  DESK_HOURLY_ROLLING_VOLUME_SOURCE_LABEL,
  emptyHourlyRollingVolumeHistory,
} from "./volume-hourly-snapshots";

/** Polled while the desk is on Volume + 24H. Inside the 5 minute DexScreener cache. */
export const DESK_VOLUME_24H_POLL_MS = 45_000;

export const DESK_VOLUME_24H_LIVE_PATH = "/api/solana/desk-volume-24h";

/** Focus and visibility often fire together. Collapse them into one request. */
export const DESK_VOLUME_24H_POLL_MIN_GAP_MS = 5_000;

export function deskVolumePollDue(
  nowMs: number,
  lastPullMs: number,
  minGapMs = DESK_VOLUME_24H_POLL_MIN_GAP_MS,
): boolean {
  return nowMs - lastPullMs >= minGapMs;
}

export interface DeskVolumeLivePayload {
  hourlyHistory: EquityVolumeHistoryResult;
  /** Null means the headline was missing or invalid. Keep the previous headline. */
  rolling24h: DeskRolling24hVolumes | null;
}

/**
 * Keep the newer hourly series. Equal timestamps take the incoming payload so a
 * poll that shares a clock with the server still replaces the points.
 */
export function preferFresherHourlyHistory(
  current: EquityVolumeHistoryResult | null | undefined,
  incoming: EquityVolumeHistoryResult | null | undefined,
): EquityVolumeHistoryResult | null {
  if (!incoming) return current ?? null;
  if (!current) return incoming;
  const nextAt = Date.parse(incoming.generatedAt);
  const currentAt = Date.parse(current.generatedAt);
  if (!Number.isFinite(nextAt)) return current;
  if (!Number.isFinite(currentAt) || nextAt >= currentAt) return incoming;
  return current;
}

function rollingLeg(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/** Drop a leg that is not null or a finite non-negative number. Do not coerce garbage to zero. */
export function sanitizeDeskRolling24h(value: unknown): DeskRolling24hVolumes | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const publicVolume24hUsd = rollingLeg(row.publicVolume24hUsd);
  const privateVolume24hUsd = rollingLeg(row.privateVolume24hUsd);
  const etfVolume24hUsd = rollingLeg(row.etfVolume24hUsd);
  if (
    publicVolume24hUsd === undefined ||
    privateVolume24hUsd === undefined ||
    etfVolume24hUsd === undefined
  ) {
    return null;
  }
  if (publicVolume24hUsd === null && privateVolume24hUsd === null && etfVolume24hUsd === null) return null;
  return { publicVolume24hUsd, privateVolume24hUsd, etfVolume24hUsd };
}

/**
 * Accept captured rolling-24h points only. Invalid rows are dropped.
 * Hours that are absent stay absent — nothing is inserted between captures.
 */
export function sanitizeHourlyRollingHistory(value: unknown): EquityVolumeHistoryResult | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<EquityVolumeHistoryResult>;
  if (!Array.isArray(row.points)) return null;
  if (typeof row.generatedAt !== "string" || !Number.isFinite(Date.parse(row.generatedAt))) return null;

  const seen = new Set<number>();
  const points: VolumeHistoryPoint[] = [];
  for (const point of row.points) {
    if (!point || typeof point !== "object") continue;
    const t = (point as VolumeHistoryPoint).t;
    const volumeUsd = (point as VolumeHistoryPoint).volumeUsd;
    const kind = (point as VolumeHistoryPoint).kind;
    if (kind !== "rolling_24h") continue;
    if (typeof t !== "number" || !Number.isFinite(t) || t <= 0) continue;
    if (typeof volumeUsd !== "number" || !Number.isFinite(volumeUsd) || volumeUsd < 0) continue;
    const hour = Math.trunc(t);
    if (seen.has(hour)) continue;
    seen.add(hour);
    points.push({ t: hour, volumeUsd, kind: "rolling_24h" });
  }
  points.sort((a, b) => a.t - b.t);

  if (points.length === 0) {
    const reason =
      typeof row.emptyReason === "string" && row.emptyReason.trim().length > 0
        ? row.emptyReason
        : "No DexScreener rolling 24h hourly snapshots in the last 24 hours. Missing hours are not invented.";
    return emptyHourlyRollingVolumeHistory(reason, row.generatedAt);
  }

  const first = points[0];
  const last = points[points.length - 1];
  return {
    available: true,
    points,
    seriesByMint: {},
    definition:
      typeof row.definition === "string" && row.definition.trim().length > 0
        ? row.definition
        : DESK_HOURLY_ROLLING_VOLUME_DEFINITION,
    sourceLabel:
      typeof row.sourceLabel === "string" && row.sourceLabel.trim().length > 0
        ? row.sourceLabel
        : DESK_HOURLY_ROLLING_VOLUME_SOURCE_LABEL,
    poolCount: 0,
    poolCountAttempted: 0,
    mintCount: 0,
    volume24hUsd: last?.volumeUsd ?? null,
    firstObservableAt: first ? new Date(first.t * 1000).toISOString() : null,
    lastObservableAt: last ? new Date(last.t * 1000).toISOString() : null,
    generatedAt: row.generatedAt,
    emptyReason: null,
  };
}

/** Null when the hourly series is unusable. A null rolling24h keeps the previous headline. */
export function parseDeskVolumeLivePayload(body: unknown): DeskVolumeLivePayload | null {
  if (!body || typeof body !== "object") return null;
  const row = body as { hourlyHistory?: unknown; rolling24h?: unknown };
  const hourlyHistory = sanitizeHourlyRollingHistory(row.hourlyHistory);
  if (!hourlyHistory) return null;
  return {
    hourlyHistory,
    rolling24h: sanitizeDeskRolling24h(row.rolling24h),
  };
}
