import { combinedPublicPrivateVolume24h, robinhoodChainMeta } from "./aggregate";
import {
  deskRangeVolumeHeadline,
  filterVolumeRange,
  type VolumeChartRangeId,
} from "./daily-volume-view";
import { asNonNegativeNumber, sumNullable } from "./numbers";
import {
  ROBINHOOD_CHAIN_NATIVE_ID,
  type ChainVolume,
  type VolumeHistoryPoint,
} from "./types";
import { easternDayKey, utcInstantForDayKey } from "./volume-snapshots";

/**
 * Robinhood Chain desk bars. Same file the nightly snapshot writer force-adds.
 * DexScreener slug `robinhood`, EVM chain 4663. Each row is a trailing
 * `volume.h24` sample for an America/New_York date, not a true
 * 12:00 AM–11:59 PM ET window.
 */
export const ROBINHOOD_VOLUME_SNAPSHOT_FILE = "robinhood.json";

export const ROBINHOOD_DESK_VOLUME_NOTE =
  "Public equity, private, and ETF/index are summed with null omitted, not stored as $0. The in-progress Eastern day is omitted. A day without a nightly snapshot is the sum of that day's per-asset backfill.";

export interface RobinhoodIssuerCell {
  slug: string;
  label: string;
  /** RHJ is the verified issuer. Ondo-named clones on 4663 are not official Ondo. */
  official: boolean;
  usd: number | null;
  liquidityUsd: number | null;
}

export interface RobinhoodDeskDay {
  date: string;
  /** UTC midnight of `date`, so chart labels match the Eastern day key. */
  t: number;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  equity: RobinhoodIssuerCell[];
  etf: RobinhoodIssuerCell[];
  private: RobinhoodIssuerCell[];
  /** Present when this day was summed from per-asset backfill. Nightly DexScreener rows omit it. */
  source?: "asset-backfill";
}

export interface RobinhoodIssuerRow {
  slug: string;
  label: string;
  official: boolean;
  equityUsd: number | null;
  etfUsd: number | null;
  privateUsd: number | null;
}

const LANE_KEYS = ["equity", "etf", "private"] as const;
type LaneKey = (typeof LANE_KEYS)[number];

/**
 * Chain shell when Liquidity Terminal did not return a stock list.
 * Volume stays null here — the desk chart reads snapshot bars, and this
 * object does not invent a live 24h total.
 */
export function robinhoodSnapshotChainShell(): ChainVolume {
  return {
    ...robinhoodChainMeta(),
    volume24hUsd: null,
    displayedLiquidityUsd: null,
    usdGLiquidityUsd: null,
    assetCount: 0,
    assetsWithVolume: 0,
    assetsWithPools: 0,
    assetsStillHydrating: 0,
    assetsWithNoIndexedPools: 0,
    reportedPoolCount: 0,
    peakDexCount: 0,
    coverageNote: "Names stay empty until Robinhood Liquidity Terminal responds.",
  };
}

/** RHJ is verified. `(Ondo Tokenized)` clones on 4663 stay visible and are not official Ondo. */
export function robinhoodIssuerPresentation(slug: string): { label: string; official: boolean } {
  const key = slug.trim().toLowerCase();
  if (key === "rhj") return { label: "RHJ", official: true };
  if (key === "ondo") return { label: "Ondo-named (unverified)", official: false };
  return { label: slug.trim() || key, official: false };
}

export function parseRobinhoodDeskDays(payload: unknown): RobinhoodDeskDay[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { records?: unknown }).records;
  if (!Array.isArray(list)) return [];
  const byDate = new Map<string, RobinhoodDeskDay>();
  for (const row of list) {
    const day = parseRobinhoodDeskDay(row);
    if (!day) continue;
    byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t);
}

/**
 * Drop the in-progress America/New_York date and anything later.
 * `date` is the Eastern day key. A row dated today is not a closed bar.
 */
export function closedRobinhoodDeskDays(
  days: readonly RobinhoodDeskDay[],
  nowT: number,
): RobinhoodDeskDay[] {
  const today = easternDayKey(nowT);
  if (!today) return [];
  return days
    .filter((day) => day.date < today && day.combined24hUsd !== null)
    .sort((a, b) => a.t - b.t);
}

/** 24H is the newest closed day. 7D/14D/30D are the newest N recorded closed days. */
export function robinhoodDaysForRange(
  closedDays: readonly RobinhoodDeskDay[],
  range: VolumeChartRangeId,
): RobinhoodDeskDay[] {
  const ordered = [...closedDays].sort((a, b) => a.t - b.t);
  if (range === "24h") {
    const last = ordered[ordered.length - 1];
    return last ? [last] : [];
  }
  const visible = new Set(filterVolumeRange(robinhoodVolumePoints(ordered), range).map((point) => point.t));
  return ordered.filter((day) => visible.has(day.t));
}

export function robinhoodVolumePoints(days: readonly RobinhoodDeskDay[]): VolumeHistoryPoint[] {
  return days
    .filter((day) => day.t > 0 && day.combined24hUsd !== null)
    .map((day) => ({
      t: day.t,
      volumeUsd: day.combined24hUsd as number,
      kind: "calendar_day" as const,
    }));
}

export function robinhoodDeskHeadline(
  days: readonly RobinhoodDeskDay[],
  range: VolumeChartRangeId,
): { volumeUsd: number | null; caption: string; kind: "closed_day" | "range_sum" } {
  if (range === "24h") {
    const day = days[days.length - 1];
    if (!day || day.combined24hUsd === null) {
      return {
        volumeUsd: null,
        caption: "24H · no closed Robinhood snapshot day yet",
        kind: "closed_day",
      };
    }
    return {
      volumeUsd: day.combined24hUsd,
      caption: `24H · ${day.date} America/New_York · last closed snapshot`,
      kind: "closed_day",
    };
  }
  const summed = deskRangeVolumeHeadline(robinhoodVolumePoints(days), range);
  return summed;
}

/** Issuer × type for the days in view. Null lane volume is omitted, not stored as $0. */
export function robinhoodIssuerRows(days: readonly RobinhoodDeskDay[]): RobinhoodIssuerRow[] {
  const bySlug = new Map<string, RobinhoodIssuerRow>();
  for (const day of days) {
    for (const lane of LANE_KEYS) {
      for (const cell of day[lane]) {
        const row = bySlug.get(cell.slug) ?? {
          slug: cell.slug,
          label: cell.label,
          official: cell.official,
          equityUsd: null,
          etfUsd: null,
          privateUsd: null,
        };
        row.official = row.official || cell.official;
        const key = lane === "equity" ? "equityUsd" : lane === "etf" ? "etfUsd" : "privateUsd";
        row[key] = sumNullable([row[key], cell.usd]);
        bySlug.set(cell.slug, row);
      }
    }
  }
  return [...bySlug.values()].sort((a, b) => {
    if (a.official !== b.official) return a.official ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Displayed liquidity is a stock, not a flow. Only a single closed day reports it.
 * Missing liquidity stays null and does not drop the volume bar.
 */
export function robinhoodDisplayedLiquidity(
  days: readonly RobinhoodDeskDay[],
): { date: string; usd: number } | null {
  if (days.length !== 1) return null;
  const day = days[0];
  if (!day || day.displayedLiquidityUsd === null) return null;
  return { date: day.date, usd: day.displayedLiquidityUsd };
}

function parseRobinhoodDeskDay(row: unknown): RobinhoodDeskDay | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (!recordChainAllowed(rec)) return null;
  const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
  const t = utcInstantForDayKey(date);
  if (!date || t <= 0) return null;
  const publicEquity24hUsd = asNonNegativeNumber(rec.publicEquity24hUsd);
  const private24hUsd = asNonNegativeNumber(rec.private24hUsd);
  const etfIndex24hUsd = asNonNegativeNumber(rec.etfIndex24hUsd);
  const combined24hUsd =
    asNonNegativeNumber(rec.combined24hUsd) ??
    combinedPublicPrivateVolume24h(publicEquity24hUsd, private24hUsd, etfIndex24hUsd);
  if (combined24hUsd === null) return null;
  const lanes = parseIssuerLanes(rec.issuersByLane);
  return {
    date,
    t,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd,
    displayedLiquidityUsd: asNonNegativeNumber(rec.displayedLiquidityUsd),
    equity: lanes.equity,
    etf: lanes.etf,
    private: lanes.private,
  };
}

function recordChainAllowed(rec: Record<string, unknown>): boolean {
  const sources = rec.sources;
  if (!sources || typeof sources !== "object") return true;
  const chainId = (sources as { chainId?: unknown }).chainId;
  if (chainId === undefined || chainId === null) return true;
  return String(chainId) === ROBINHOOD_CHAIN_NATIVE_ID;
}

function parseIssuerLanes(value: unknown): Pick<RobinhoodDeskDay, LaneKey> {
  const empty = { equity: [], etf: [], private: [] };
  if (!value || typeof value !== "object") return empty;
  const lanes = value as Record<string, unknown>;
  return {
    equity: parseLane(lanes.equity),
    etf: parseLane(lanes.etf),
    private: parseLane(lanes.private),
  };
}

function parseLane(value: unknown): RobinhoodIssuerCell[] {
  if (!value || typeof value !== "object") return [];
  const cells: RobinhoodIssuerCell[] = [];
  for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const presentation = robinhoodIssuerPresentation(slug);
    const key = slug.trim().toLowerCase();
    if (!key) continue;
    const row = raw as Record<string, unknown>;
    cells.push({
      slug: key,
      label: presentation.label,
      official: presentation.official,
      usd: asNonNegativeNumber(row.usd),
      liquidityUsd: asNonNegativeNumber(row.liquidityUsd),
    });
  }
  return cells;
}
