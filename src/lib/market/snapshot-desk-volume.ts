import { combinedPublicPrivateVolume24h } from "./aggregate";
import {
  deskRangeVolumeHeadline,
  filterVolumeRange,
  type VolumeChartRangeId,
} from "./daily-volume-view";
import { asNonNegativeNumber, sumNullable } from "./numbers";
import type { ChainVolume, VolumeHistoryPoint } from "./types";
import { easternDayKey, utcInstantForDayKey } from "./volume-snapshots";

/**
 * Closed-day desk bars for a chain that records DexScreener samples in
 * `data/volume-snapshots`. The day key is America/New_York. `t` is UTC
 * midnight of that key so chart labels match the Eastern date, even when an
 * older row stored a different instant. Null lane volume is omitted, not $0.
 */
export interface SnapshotDeskIssuerCell {
  slug: string;
  label: string;
  official: boolean;
  usd: number | null;
  liquidityUsd: number | null;
}

export interface SnapshotDeskDay {
  date: string;
  t: number;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  equity: SnapshotDeskIssuerCell[];
  etf: SnapshotDeskIssuerCell[];
  private: SnapshotDeskIssuerCell[];
}

export interface SnapshotDeskIssuerRow {
  slug: string;
  label: string;
  official: boolean;
  equityUsd: number | null;
  etfUsd: number | null;
  privateUsd: number | null;
}

export interface SnapshotDeskConfig {
  file: string;
  chainId: string;
  nativeChainId: string;
  /** DexScreener path slug. BNB Chain records `bsc`. */
  chainSlug: string;
  name: string;
  shortName: string;
  sourceLabel: string;
  issuerPresentation: (slug: string) => { label: string; official: boolean };
}

export const SNAPSHOT_DESK_VOLUME_NOTE =
  "Public equity, private, and ETF/index are summed with null omitted, not stored as $0. The in-progress Eastern day is omitted. Days before snapshots began are not invented.";

const LANE_KEYS = ["equity", "etf", "private"] as const;
type LaneKey = (typeof LANE_KEYS)[number];

export function snapshotDeskChainShell(config: SnapshotDeskConfig): ChainVolume {
  return {
    id: config.chainId,
    name: config.name,
    shortName: config.shortName,
    nativeChainId: config.nativeChainId,
    sourceId: "terminal",
    sourceLabel: config.sourceLabel,
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
    etfCount: 0,
    etfVolume24hUsd: null,
    privateCount: 0,
    privateVolume24hUsd: null,
    volumeAggregation: "all-pools",
    completenessPct: null,
    coverageNote: `${config.name} volume stays empty until a closed snapshot day is recorded.`,
  };
}

export function parseSnapshotDeskDays(payload: unknown, config: SnapshotDeskConfig): SnapshotDeskDay[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { records?: unknown }).records;
  if (!Array.isArray(list)) return [];
  const byDate = new Map<string, SnapshotDeskDay>();
  for (const row of list) {
    const day = parseSnapshotDeskDay(row, config);
    if (!day) continue;
    byDate.set(day.date, day);
  }
  return [...byDate.values()].sort((a, b) => a.t - b.t);
}

/** Drop the in-progress America/New_York date and anything later. */
export function closedSnapshotDeskDays(
  days: readonly SnapshotDeskDay[],
  nowT: number,
): SnapshotDeskDay[] {
  const today = easternDayKey(nowT);
  if (!today) return [];
  return days
    .filter((day) => day.date < today && day.combined24hUsd !== null)
    .sort((a, b) => a.t - b.t);
}

/** 24H is the newest closed day. 7D/14D/30D are the newest N recorded closed days. */
export function snapshotDeskDaysForRange(
  closedDays: readonly SnapshotDeskDay[],
  range: VolumeChartRangeId,
): SnapshotDeskDay[] {
  const ordered = [...closedDays].sort((a, b) => a.t - b.t);
  if (range === "24h") {
    const last = ordered[ordered.length - 1];
    return last ? [last] : [];
  }
  const visible = new Set(filterVolumeRange(snapshotDeskVolumePoints(ordered), range).map((point) => point.t));
  return ordered.filter((day) => visible.has(day.t));
}

export function snapshotDeskVolumePoints(days: readonly SnapshotDeskDay[]): VolumeHistoryPoint[] {
  return days
    .filter((day) => day.t > 0 && day.combined24hUsd !== null)
    .map((day) => ({
      t: day.t,
      volumeUsd: day.combined24hUsd as number,
      kind: "calendar_day" as const,
    }));
}

export function snapshotDeskHeadline(
  days: readonly SnapshotDeskDay[],
  range: VolumeChartRangeId,
  chainName: string,
): { volumeUsd: number | null; caption: string; kind: "closed_day" | "range_sum" } {
  if (range === "24h") {
    const day = days[days.length - 1];
    if (!day || day.combined24hUsd === null) {
      return {
        volumeUsd: null,
        caption: `24H · no closed ${chainName} snapshot day yet`,
        kind: "closed_day",
      };
    }
    return {
      volumeUsd: day.combined24hUsd,
      caption: `24H · ${day.date} America/New_York · last closed snapshot`,
      kind: "closed_day",
    };
  }
  return deskRangeVolumeHeadline(snapshotDeskVolumePoints(days), range);
}

export function snapshotDeskIssuerRows(days: readonly SnapshotDeskDay[]): SnapshotDeskIssuerRow[] {
  const bySlug = new Map<string, SnapshotDeskIssuerRow>();
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

/** Displayed liquidity is a stock. Only a single closed day reports it. */
export function snapshotDeskDisplayedLiquidity(
  days: readonly SnapshotDeskDay[],
): { date: string; usd: number } | null {
  if (days.length !== 1) return null;
  const day = days[0];
  if (!day || day.displayedLiquidityUsd === null) return null;
  return { date: day.date, usd: day.displayedLiquidityUsd };
}

function parseSnapshotDeskDay(row: unknown, config: SnapshotDeskConfig): SnapshotDeskDay | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (!recordChainAllowed(rec, config)) return null;
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
  const lanes = parseIssuerLanes(rec, config);
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

function recordChainAllowed(rec: Record<string, unknown>, config: SnapshotDeskConfig): boolean {
  const sources = rec.sources;
  if (!sources || typeof sources !== "object") return true;
  const source = sources as { chainId?: unknown; chainSlug?: unknown };
  if (source.chainId !== undefined && source.chainId !== null && String(source.chainId) !== config.nativeChainId) {
    return false;
  }
  if (typeof source.chainSlug === "string" && source.chainSlug.trim()) {
    if (source.chainSlug.trim().toLowerCase() !== config.chainSlug) return false;
  }
  return true;
}

function parseIssuerLanes(
  rec: Record<string, unknown>,
  config: SnapshotDeskConfig,
): Pick<SnapshotDeskDay, LaneKey> {
  const fromLanes = parseIssuersByLane(rec.issuersByLane, config);
  if (fromLanes.equity.length + fromLanes.etf.length + fromLanes.private.length > 0) return fromLanes;
  return parseIssuerList(rec.issuers, config);
}

function parseIssuersByLane(value: unknown, config: SnapshotDeskConfig): Pick<SnapshotDeskDay, LaneKey> {
  const empty = { equity: [], etf: [], private: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const lanes = value as Record<string, unknown>;
  return {
    equity: parseLaneObject(lanes.equity, config),
    etf: parseLaneObject(lanes.etf, config),
    private: parseLaneObject(lanes.private, config),
  };
}

function parseLaneObject(value: unknown, config: SnapshotDeskConfig): SnapshotDeskIssuerCell[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const cells: SnapshotDeskIssuerCell[] = [];
  for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const key = slug.trim().toLowerCase();
    if (!key) continue;
    const presentation = config.issuerPresentation(key);
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

/** Base records issuers as a list with lane fields, not `issuersByLane`. */
function parseIssuerList(value: unknown, config: SnapshotDeskConfig): Pick<SnapshotDeskDay, LaneKey> {
  const lanes: Pick<SnapshotDeskDay, LaneKey> = { equity: [], etf: [], private: [] };
  if (!Array.isArray(value)) return lanes;
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const slug = typeof row.issuer === "string" ? row.issuer.trim().toLowerCase() : "";
    if (!slug) continue;
    const presentation = config.issuerPresentation(slug);
    const equity = asNonNegativeNumber(row.publicEquity24hUsd);
    const etf = asNonNegativeNumber(row.etfIndex24hUsd);
    const priv = asNonNegativeNumber(row.private24hUsd);
    const cell = (usd: number | null): SnapshotDeskIssuerCell => ({
      slug,
      label: presentation.label,
      official: presentation.official,
      usd,
      liquidityUsd: asNonNegativeNumber(row.liquidityUsd),
    });
    lanes.equity.push(cell(equity));
    lanes.etf.push(cell(etf));
    lanes.private.push(cell(priv));
  }
  return lanes;
}
