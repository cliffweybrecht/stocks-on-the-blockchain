import { combinedPublicPrivateVolume24h } from "./aggregate";
import { asNonNegativeNumber } from "./numbers";
import type { ChainVolume, EquityVolumeHistoryResult, VolumeHistoryPoint } from "./types";
import { emptyEquityVolumeHistory, utcDayStart } from "./volume-history";

export const DESK_VOLUME_SNAPSHOT_SOURCE_LABEL = "Desk DexScreener 24h snapshots";

export const DESK_VOLUME_SNAPSHOT_DEFINITION =
  "History is this desk’s closed DexScreener 24h snapshots (public + private + ETF/index, null omitted not $0). Days before snapshots began have no series — past DexScreener totals are not invented from GeckoTerminal. The in-progress Eastern day is omitted until that day’s desk snapshot exists.";

export const DEFAULT_VOLUME_SNAPSHOT_DIR = "data/volume-snapshots";
export const SOLANA_VOLUME_SNAPSHOT_FILE = "solana.json";

export interface DeskVolumeSnapshot {
  date: string;
  t: number;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
  publicMintCount: number | null;
  publicPoolCount: number | null;
  generatedAt: string;
}

export interface DeskVolumeSnapshotStore {
  load(): Promise<DeskVolumeSnapshot[]>;
  save(records: readonly DeskVolumeSnapshot[]): Promise<void>;
}

export class MemoryDeskVolumeSnapshotStore implements DeskVolumeSnapshotStore {
  constructor(private records: DeskVolumeSnapshot[] = []) {}

  async load(): Promise<DeskVolumeSnapshot[]> {
    return this.records.map(cloneSnapshot);
  }

  async save(records: readonly DeskVolumeSnapshot[]): Promise<void> {
    this.records = records.map(cloneSnapshot);
  }
}

export function utcDayKey(unixSeconds: number): string {
  const start = utcDayStart(unixSeconds);
  if (start <= 0) return "";
  return new Date(start * 1000).toISOString().slice(0, 10);
}

const EASTERN_DAY_KEY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * America/New_York calendar date (YYYY-MM-DD). Desk snapshot days are this
 * date, not the UTC date: 00:00Z is still the previous Eastern evening.
 */
export function easternDayKey(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "";
  const parts = EASTERN_DAY_KEY.formatToParts(new Date(unixSeconds * 1000));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

/** UTC midnight of a YYYY-MM-DD key. UTC axis labels then read as that Eastern date. */
export function utcInstantForDayKey(dayKey: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return 0;
  const t = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Number.isFinite(t) ? Math.trunc(t / 1000) : 0;
}

function snapshotChartDayKey(row: DeskVolumeSnapshot): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return row.date;
  return utcDayKey(row.t);
}

function cloneSnapshot(row: DeskVolumeSnapshot): DeskVolumeSnapshot {
  return { ...row };
}

function reportedUsd(value: number | null | undefined): number | null {
  return asNonNegativeNumber(value);
}

export function deskVolumeSnapshotFromChain(
  chain: Pick<
    ChainVolume,
    | "volume24hUsd"
    | "privateVolume24hUsd"
    | "etfVolume24hUsd"
    | "assetCount"
    | "reportedPoolCount"
  >,
  generatedAt: string,
  nowT?: number,
): DeskVolumeSnapshot {
  const parsed = Date.parse(generatedAt);
  const tSource =
    nowT !== undefined && Number.isFinite(nowT) && nowT > 0
      ? nowT
      : Number.isFinite(parsed) && parsed > 0
        ? parsed / 1000
        : Date.now() / 1000;
  const t = utcDayStart(tSource);
  const publicEquity24hUsd = reportedUsd(chain.volume24hUsd);
  const private24hUsd = reportedUsd(chain.privateVolume24hUsd);
  const etfIndex24hUsd = reportedUsd(chain.etfVolume24hUsd);
  return {
    date: utcDayKey(t),
    t,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd: combinedPublicPrivateVolume24h(publicEquity24hUsd, private24hUsd, etfIndex24hUsd),
    publicMintCount: Number.isFinite(chain.assetCount) ? chain.assetCount : null,
    publicPoolCount: Number.isFinite(chain.reportedPoolCount) ? chain.reportedPoolCount : null,
    generatedAt,
  };
}

/** Same UTC day is replaced. All-null days are never written (null is not $0). */
export function upsertDeskVolumeSnapshot(
  records: readonly DeskVolumeSnapshot[],
  incoming: DeskVolumeSnapshot,
): DeskVolumeSnapshot[] {
  if (incoming.t <= 0 || !incoming.date) return records.map(cloneSnapshot);
  if (incoming.combined24hUsd === null) return records.map(cloneSnapshot);
  const next = records.filter((row) => row.t !== incoming.t).map(cloneSnapshot);
  next.push(cloneSnapshot(incoming));
  next.sort((a, b) => a.t - b.t);
  return next;
}

export type RecordDeskVolumeResult =
  | { ok: true; written: boolean; unchanged: boolean; snapshot: DeskVolumeSnapshot }
  | { ok: false; reason: string };

/**
 * Awaited persist of today’s DexScreener desk 24h. Same upsert rules as the
 * live desk: null omitted not $0; all-null days are refused; same UTC day is
 * replaced. Callers that must fail closed (CLI) should treat `ok: false` as
 * a hard error. The UI persist path still swallows this.
 */
export async function recordDeskVolumeFromChain(
  store: DeskVolumeSnapshotStore,
  chain: Pick<
    ChainVolume,
    | "volume24hUsd"
    | "privateVolume24hUsd"
    | "etfVolume24hUsd"
    | "assetCount"
    | "reportedPoolCount"
  >,
  generatedAt: string,
  nowT?: number,
): Promise<RecordDeskVolumeResult> {
  const incoming = deskVolumeSnapshotFromChain(chain, generatedAt, nowT);
  if (incoming.t <= 0 || !incoming.date) {
    return { ok: false, reason: "DexScreener desk snapshot has no UTC day — snapshot not written." };
  }
  if (incoming.combined24hUsd === null) {
    return {
      ok: false,
      reason: "DexScreener desk 24h is all-null (null omitted, not $0) — snapshot not written.",
    };
  }
  try {
    const existing = await store.load();
    const next = upsertDeskVolumeSnapshot(existing, incoming);
    if (JSON.stringify(existing) === JSON.stringify(next)) {
      return { ok: true, written: false, unchanged: true, snapshot: incoming };
    }
    await store.save(next);
    return { ok: true, written: true, unchanged: false, snapshot: incoming };
  } catch (error) {
    const message = error instanceof Error ? error.message : "desk volume snapshot write failed.";
    return { ok: false, reason: `DexScreener desk snapshot persist failed: ${message}` };
  }
}

export function pointsFromDeskVolumeSnapshots(
  snapshots: readonly DeskVolumeSnapshot[],
): VolumeHistoryPoint[] {
  const byDay = new Map<string, VolumeHistoryPoint>();
  const sorted = snapshots
    .filter(
      (row) =>
        row.t > 0 &&
        row.combined24hUsd !== null &&
        Number.isFinite(row.combined24hUsd) &&
        row.combined24hUsd >= 0,
    )
    .sort((a, b) => a.t - b.t);
  for (const row of sorted) {
    const dayKey = snapshotChartDayKey(row);
    const t = utcInstantForDayKey(dayKey);
    if (!dayKey || t <= 0) continue;
    byDay.set(dayKey, {
      t,
      volumeUsd: row.combined24hUsd as number,
      kind: "calendar_day",
    });
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t);
}

/**
 * UTC day of `unixSeconds` is on or before the America/New_York date of `nowT`.
 * Daily Gecko candles are UTC-midnight buckets. 00:00Z is still the previous
 * Eastern evening, so that bucket is tomorrow until New York's calendar day starts.
 */
export function utcDayOnOrBeforeEasternToday(unixSeconds: number, nowT: number): boolean {
  const todayKey = easternDayKey(nowT);
  if (!todayKey) return Number.isFinite(unixSeconds) && unixSeconds > 0;
  const key = utcDayKey(unixSeconds);
  return key !== "" && key <= todayKey;
}

/**
 * Drop chart points whose day key is after the America/New_York date of `nowT`.
 * A UTC date rollover (00:00Z while New York is still the previous evening)
 * must not plot that next calendar day.
 */
export function clipVolumeThroughEasternDay(
  points: readonly VolumeHistoryPoint[],
  nowT: number,
): VolumeHistoryPoint[] {
  return points.filter(
    (point) => isPlottableVolumePoint(point) && utcDayOnOrBeforeEasternToday(point.t, nowT),
  );
}

function isPlottableVolumePoint(point: VolumeHistoryPoint): boolean {
  return (
    Number.isFinite(point.t) &&
    point.t > 0 &&
    Number.isFinite(point.volumeUsd) &&
    point.volumeUsd >= 0
  );
}

/**
 * Closed desk snapshot days only. Drops a live rolling-24h tip and any point
 * after the America/New_York date of `nowT`. Does not invent an in-progress day
 * from the current DexScreener ~24h rollup.
 */
export function closedSnapshotVolumePoints(
  points: readonly VolumeHistoryPoint[],
  nowT: number,
): VolumeHistoryPoint[] {
  return clipVolumeThroughEasternDay(points, nowT)
    .filter((point) => point.kind !== "rolling_24h")
    .sort((a, b) => a.t - b.t);
}

export function parseDeskVolumeSnapshotRecords(payload: unknown): DeskVolumeSnapshot[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { records?: unknown }).records;
  if (!Array.isArray(list)) return [];
  const parsed: DeskVolumeSnapshot[] = [];
  for (const row of list) {
    const snapshot = parseOneSnapshot(row);
    if (snapshot) parsed.push(snapshot);
  }
  parsed.sort((a, b) => a.t - b.t);
  return parsed;
}

function parseOneSnapshot(row: unknown): DeskVolumeSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const t = typeof rec.t === "number" && Number.isFinite(rec.t) && rec.t > 0 ? utcDayStart(rec.t) : 0;
  const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : utcDayKey(t);
  if (t <= 0 || !date) return null;
  const generatedAt = typeof rec.generatedAt === "string" && rec.generatedAt.trim() ? rec.generatedAt : null;
  if (!generatedAt) return null;
  const publicEquity24hUsd = asNonNegativeNumber(rec.publicEquity24hUsd);
  const private24hUsd = asNonNegativeNumber(rec.private24hUsd);
  const etfIndex24hUsd = asNonNegativeNumber(rec.etfIndex24hUsd);
  const combined =
    asNonNegativeNumber(rec.combined24hUsd) ??
    combinedPublicPrivateVolume24h(publicEquity24hUsd, private24hUsd, etfIndex24hUsd);
  if (combined === null) return null;
  return {
    date,
    t,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd: combined,
    publicMintCount: Number.isFinite(rec.publicMintCount as number) ? (rec.publicMintCount as number) : null,
    publicPoolCount: Number.isFinite(rec.publicPoolCount as number) ? (rec.publicPoolCount as number) : null,
    generatedAt,
  };
}

export function serializeDeskVolumeSnapshots(records: readonly DeskVolumeSnapshot[]): string {
  return `${JSON.stringify({ version: 1, records }, null, 2)}\n`;
}

export function buildSnapshotEquityVolumeHistory(input: {
  snapshots: readonly DeskVolumeSnapshot[];
  liveCombined24hUsd: number | null;
  livePublic24hUsd?: number | null;
  nowT: number;
  generatedAt: string;
  mintCount?: number;
  poolCount?: number;
}): EquityVolumeHistoryResult {
  const fromStore = pointsFromDeskVolumeSnapshots(input.snapshots);
  const points = closedSnapshotVolumePoints(fromStore, input.nowT);
  if (points.length === 0) {
    return emptyEquityVolumeHistory(
      "No DexScreener desk snapshots yet. History starts when this desk records a 24h snapshot. Past days are not invented from GeckoTerminal.",
      input.generatedAt,
    );
  }
  const first = points[0];
  const last = points[points.length - 1];
  return {
    available: true,
    points,
    seriesByMint: {},
    definition: DESK_VOLUME_SNAPSHOT_DEFINITION,
    sourceLabel: DESK_VOLUME_SNAPSHOT_SOURCE_LABEL,
    poolCount: input.poolCount ?? 0,
    poolCountAttempted: input.poolCount ?? 0,
    mintCount: input.mintCount ?? 0,
    volume24hUsd: input.livePublic24hUsd ?? input.liveCombined24hUsd,
    firstObservableAt: first ? new Date(first.t * 1000).toISOString() : null,
    lastObservableAt: last ? new Date(last.t * 1000).toISOString() : null,
    generatedAt: input.generatedAt,
    emptyReason: null,
  };
}
