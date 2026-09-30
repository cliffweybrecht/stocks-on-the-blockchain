import { combinedPublicPrivateVolume24h } from "./aggregate";
import { asNonNegativeNumber, sumNullable } from "./numbers";
import type { ChainVolume, EquityVolumeHistoryResult, VolumeHistoryPoint } from "./types";

/**
 * Rolling DexScreener h24 desk totals, one row per America/New_York hour.
 * This is not a closed Eastern day bar and must not be written into
 * `solana.json` or mixed into the 7D/14D/30D closed-day series.
 * The chart's 24H mode reads these rows through `buildHourlyRollingVolumeHistory`.
 */
export const DESK_HOURLY_VOLUME_KIND = "rolling_h24_totals";

/** Clock window for the desk chart's 24H series. Filter on `t`, not civil-hour labels. */
export const HOURLY_ROLLING_VOLUME_WINDOW_SECONDS = 24 * 60 * 60;

/** One Eastern hour in unix time, including both fall-back hours and the spring-forward jump. */
export const EASTERN_HOUR_STEP_SECONDS = 60 * 60;

/**
 * A pinned hour may be the current Eastern hour or up to two hours behind.
 * That covers a DexScreener fetch that finishes after the scheduled hour rolls.
 * Older pins are refused so this path cannot backfill a past miss.
 */
export const PINNED_EASTERN_HOUR_MAX_LAG_SECONDS = 2 * EASTERN_HOUR_STEP_SECONDS;

export const DESK_HOURLY_ROLLING_VOLUME_SOURCE_LABEL = "Desk DexScreener rolling 24h snapshots";

export const DESK_HOURLY_ROLLING_VOLUME_DEFINITION =
  "Each point is a DexScreener rolling h24 desk total (public + private + ETF/index) captured at an America/New_York hour. The value is that snapshot’s rolling 24h total, not volume during the hour alone. The 24H chart shows every Eastern hour in the window; a missing capture stays an empty slot and is not invented.";

export const DESK_HOURLY_VOLUME_NOTE =
  "One compact row per America/New_York hour. Rolling DexScreener h24 desk totals (public, private, ETF/index, combined) and displayed-liquidity totals. Not a per-asset or per-pool dump, and not a closed Eastern day bar.";

export const SOLANA_HOURLY_VOLUME_SNAPSHOT_FILE = "solana-hourly.json";

const HOUR_RE = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3])$/;
const OFFSET_RE = /^[+-]\d{2}:\d{2}$/;
const OFFSET_LABEL_RE = /^(?:GMT|UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/i;

const EASTERN_HOUR_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  timeZoneName: "longOffset",
});

export interface DeskHourlyVolumeSnapshot {
  /** America/New_York civil hour, `YYYY-MM-DDTHH` (00–23). */
  hour: string;
  /** Zone offset of that civil hour (`-04:00` or `-05:00`). Distinguishes the repeated fall-back hour. */
  offset: string;
  /** Unix seconds at the start of this Eastern hour. Same hour replaces. */
  t: number;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
  publicLiquidityUsd: number | null;
  privateLiquidityUsd: number | null;
  etfIndexLiquidityUsd: number | null;
  combinedLiquidityUsd: number | null;
  generatedAt: string;
}

export interface DeskHourlyVolumeSnapshotStore {
  load(): Promise<DeskHourlyVolumeSnapshot[]>;
  save(records: readonly DeskHourlyVolumeSnapshot[]): Promise<void>;
}

interface LaneLiquidity {
  displayedLiquidityUsd: number | null;
}

export interface DeskHourlyVolumeDetail {
  chain: Pick<
    ChainVolume,
    "volume24hUsd" | "privateVolume24hUsd" | "etfVolume24hUsd" | "displayedLiquidityUsd"
  >;
  /** Public-equity lane. Liquidity on the chain rollup is used; these rows are not stored. */
  assets?: readonly LaneLiquidity[];
  etfAssets?: readonly LaneLiquidity[];
  privateAssets?: readonly LaneLiquidity[];
}

export class MemoryDeskHourlyVolumeSnapshotStore implements DeskHourlyVolumeSnapshotStore {
  constructor(private records: DeskHourlyVolumeSnapshot[] = []) {}

  async load(): Promise<DeskHourlyVolumeSnapshot[]> {
    return this.records.map(canonicalHourlySnapshot);
  }

  async save(records: readonly DeskHourlyVolumeSnapshot[]): Promise<void> {
    this.records = records.map(canonicalHourlySnapshot);
  }
}

function reportedUsd(value: number | null | undefined): number | null {
  return asNonNegativeNumber(value);
}

function laneLiquidity(assets: readonly LaneLiquidity[] | undefined): number | null {
  if (!assets) return null;
  return sumNullable(assets.map((asset) => asset.displayedLiquidityUsd));
}

/** `GMT-4` / `GMT-04:00` → `-04:00`. Empty when the label is not an offset. */
export function normalizeEasternOffset(label: string): string {
  const match = OFFSET_LABEL_RE.exec(label.trim());
  if (!match) return "";
  const hours = match[2]?.padStart(2, "0");
  const minutes = (match[3] ?? "00").padStart(2, "0");
  if (!hours || Number(hours) > 14 || Number(minutes) > 59) return "";
  return `${match[1]}${hours}:${minutes}`;
}

/** Unix seconds at the start of an Eastern civil hour. `0` when the pair is not a real instant. */
export function easternHourStartUnix(hour: string, offset: string): number {
  if (!HOUR_RE.test(hour) || !OFFSET_RE.test(offset)) return 0;
  const parsed = Date.parse(`${hour}:00:00${offset}`);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed / 1000);
}

/**
 * America/New_York hour containing `unixSeconds`.
 * The fall-back hour (01:00 twice) stays two rows because the offsets differ.
 */
export function easternHourStamp(unixSeconds: number): { hour: string; offset: string; t: number } | null {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const parts = EASTERN_HOUR_PARTS.formatToParts(new Date(unixSeconds * 1000));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hourPart = parts.find((part) => part.type === "hour")?.value;
  const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  if (!year || !month || !day || !hourPart) return null;
  const hour = `${year}-${month}-${day}T${hourPart}`;
  const offset = normalizeEasternOffset(zone);
  const t = easternHourStartUnix(hour, offset);
  if (t <= 0) return null;
  return { hour, offset, t };
}

export function deskHourlyVolumeSnapshotLabel(row: Pick<DeskHourlyVolumeSnapshot, "hour" | "offset">): string {
  return `${row.hour}${row.offset}`;
}

function canonicalHourlySnapshot(row: DeskHourlyVolumeSnapshot): DeskHourlyVolumeSnapshot {
  return {
    hour: row.hour,
    offset: row.offset,
    t: row.t,
    publicEquity24hUsd: row.publicEquity24hUsd,
    private24hUsd: row.private24hUsd,
    etfIndex24hUsd: row.etfIndex24hUsd,
    combined24hUsd: row.combined24hUsd,
    publicLiquidityUsd: row.publicLiquidityUsd,
    privateLiquidityUsd: row.privateLiquidityUsd,
    etfIndexLiquidityUsd: row.etfIndexLiquidityUsd,
    combinedLiquidityUsd: row.combinedLiquidityUsd,
    generatedAt: row.generatedAt,
  };
}

/**
 * Totals only. Public liquidity is the desk chain rollup. Private and ETF
 * liquidity are in-memory lane sums when those lanes were loaded. Asset and
 * pool rows are not copied onto the snapshot.
 */
export function deskHourlyVolumeSnapshotFromDetail(
  detail: DeskHourlyVolumeDetail,
  generatedAt: string,
  nowT?: number,
): DeskHourlyVolumeSnapshot | null {
  const parsed = Date.parse(generatedAt);
  const tSource =
    nowT !== undefined && Number.isFinite(nowT) && nowT > 0
      ? nowT
      : Number.isFinite(parsed) && parsed > 0
        ? parsed / 1000
        : Date.now() / 1000;
  const stamp = easternHourStamp(tSource);
  if (!stamp) return null;
  const publicEquity24hUsd = reportedUsd(detail.chain.volume24hUsd);
  const private24hUsd = reportedUsd(detail.chain.privateVolume24hUsd);
  const etfIndex24hUsd = reportedUsd(detail.chain.etfVolume24hUsd);
  const publicLiquidityUsd = reportedUsd(detail.chain.displayedLiquidityUsd);
  const privateLiquidityUsd = laneLiquidity(detail.privateAssets);
  const etfIndexLiquidityUsd = laneLiquidity(detail.etfAssets);
  return {
    hour: stamp.hour,
    offset: stamp.offset,
    t: stamp.t,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd: combinedPublicPrivateVolume24h(publicEquity24hUsd, private24hUsd, etfIndex24hUsd),
    publicLiquidityUsd,
    privateLiquidityUsd,
    etfIndexLiquidityUsd,
    combinedLiquidityUsd: sumNullable([publicLiquidityUsd, privateLiquidityUsd, etfIndexLiquidityUsd]),
    generatedAt,
  };
}

/** Same Eastern hour (`t`) is replaced. All-null volume hours are never written. */
export function upsertDeskHourlyVolumeSnapshot(
  records: readonly DeskHourlyVolumeSnapshot[],
  incoming: DeskHourlyVolumeSnapshot,
): DeskHourlyVolumeSnapshot[] {
  if (incoming.t <= 0 || !incoming.hour || incoming.combined24hUsd === null) {
    return records.map(canonicalHourlySnapshot);
  }
  const next = records.filter((row) => row.t !== incoming.t).map(canonicalHourlySnapshot);
  next.push(canonicalHourlySnapshot(incoming));
  next.sort((a, b) => a.t - b.t);
  return next;
}

export type RecordDeskHourlyVolumeResult =
  | { ok: true; written: boolean; unchanged: boolean; snapshot: DeskHourlyVolumeSnapshot }
  | { ok: false; reason: string };

/**
 * Awaited persist of one compact hourly totals row. Does not read or write the
 * closed-day snapshot file. Null volume is omitted, not stored as $0.
 */
export async function recordDeskHourlyVolumeFromDetail(
  store: DeskHourlyVolumeSnapshotStore,
  detail: DeskHourlyVolumeDetail,
  generatedAt: string,
  nowT?: number,
): Promise<RecordDeskHourlyVolumeResult> {
  const incoming = deskHourlyVolumeSnapshotFromDetail(detail, generatedAt, nowT);
  if (!incoming) {
    return {
      ok: false,
      reason: "DexScreener desk hourly snapshot has no America/New_York hour — snapshot not written.",
    };
  }
  if (incoming.combined24hUsd === null) {
    return {
      ok: false,
      reason: "DexScreener desk 24h is all-null (null omitted, not $0) — hourly snapshot not written.",
    };
  }
  try {
    const existing = await store.load();
    const next = upsertDeskHourlyVolumeSnapshot(existing, incoming);
    if (JSON.stringify(existing) === JSON.stringify(next)) {
      return { ok: true, written: false, unchanged: true, snapshot: incoming };
    }
    await store.save(next);
    return { ok: true, written: true, unchanged: false, snapshot: incoming };
  } catch (error) {
    const message = error instanceof Error ? error.message : "desk hourly volume snapshot write failed.";
    return { ok: false, reason: `DexScreener desk hourly snapshot persist failed: ${message}` };
  }
}

export function parseDeskHourlyVolumeSnapshotRecords(payload: unknown): DeskHourlyVolumeSnapshot[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (payload as { records?: unknown }).records;
  if (!Array.isArray(list)) return [];
  const byHour = new Map<number, DeskHourlyVolumeSnapshot>();
  for (const row of list) {
    const snapshot = parseOneHourlySnapshot(row);
    if (snapshot) byHour.set(snapshot.t, snapshot);
  }
  return [...byHour.values()].sort((a, b) => a.t - b.t);
}

function parseOneHourlySnapshot(row: unknown): DeskHourlyVolumeSnapshot | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const hour = typeof rec.hour === "string" ? rec.hour : "";
  const offset = typeof rec.offset === "string" ? rec.offset : "";
  const t = easternHourStartUnix(hour, offset);
  const generatedAt = typeof rec.generatedAt === "string" && rec.generatedAt.trim() ? rec.generatedAt : null;
  if (t <= 0 || !generatedAt) return null;
  const publicEquity24hUsd = asNonNegativeNumber(rec.publicEquity24hUsd);
  const private24hUsd = asNonNegativeNumber(rec.private24hUsd);
  const etfIndex24hUsd = asNonNegativeNumber(rec.etfIndex24hUsd);
  const combined =
    asNonNegativeNumber(rec.combined24hUsd) ??
    combinedPublicPrivateVolume24h(publicEquity24hUsd, private24hUsd, etfIndex24hUsd);
  if (combined === null) return null;
  const publicLiquidityUsd = asNonNegativeNumber(rec.publicLiquidityUsd);
  const privateLiquidityUsd = asNonNegativeNumber(rec.privateLiquidityUsd);
  const etfIndexLiquidityUsd = asNonNegativeNumber(rec.etfIndexLiquidityUsd);
  return {
    hour,
    offset,
    t,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd: combined,
    publicLiquidityUsd,
    privateLiquidityUsd,
    etfIndexLiquidityUsd,
    combinedLiquidityUsd:
      asNonNegativeNumber(rec.combinedLiquidityUsd) ??
      sumNullable([publicLiquidityUsd, privateLiquidityUsd, etfIndexLiquidityUsd]),
    generatedAt,
  };
}

/**
 * Every America/New_York hour start in `[nowT - 24h, nowT]`, oldest first.
 * Steps by unix hour, so the repeated fall-back hour stays two slots and the
 * spring-forward gap is not invented. These are axis slots, not volume points.
 */
export function easternRollingHourStarts(nowT: number): number[] {
  if (!Number.isFinite(nowT) || nowT <= 0) return [];
  const end = easternHourStamp(nowT);
  if (!end) return [];
  const cutoff = nowT - HOURLY_ROLLING_VOLUME_WINDOW_SECONDS;
  const starts: number[] = [];
  const seen = new Set<number>();
  let cursor = end.t;
  while (starts.length < 30) {
    if (cursor < cutoff) break;
    const stamp = easternHourStamp(cursor);
    if (!stamp || stamp.t < cutoff || stamp.t > nowT) break;
    if (seen.has(stamp.t)) break;
    seen.add(stamp.t);
    starts.push(stamp.t);
    cursor = stamp.t - EASTERN_HOUR_STEP_SECONDS;
  }
  return starts.reverse();
}

const PINNED_HOUR_RE = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]))([+-](?:0\d|1[0-4]):[0-5]\d)?$/;

export type PinnedEasternHourResult =
  | { ok: true; stamp: { hour: string; offset: string; t: number } | null }
  | { ok: false; reason: string };

function matchingEasternHour(hour: string, offset: string): { hour: string; offset: string; t: number } | null {
  const t = easternHourStartUnix(hour, offset);
  if (t <= 0) return null;
  const stamp = easternHourStamp(t);
  if (!stamp || stamp.hour !== hour || stamp.offset !== offset) return null;
  return stamp;
}

/**
 * `HOURLY_TARGET_HOUR` / `SNAPSHOT_HOUR` / `--hour`.
 * Blank means "stamp the fetch clock" (the unpinned path).
 * A civil hour without an offset is resolved in America/New_York. The fall-back
 * 01:00 needs an explicit offset. The spring-forward 02:00 is rejected.
 * The pin must be the current Eastern hour or at most two hours behind `nowT`.
 */
export function resolvePinnedEasternHour(raw: string | null | undefined, nowT: number): PinnedEasternHourResult {
  const text = raw?.trim() ?? "";
  if (!text) return { ok: true, stamp: null };
  if (!Number.isFinite(nowT) || nowT <= 0) {
    return { ok: false, reason: "Pinned Eastern hour cannot be checked against an invalid clock — snapshot not written." };
  }
  const match = PINNED_HOUR_RE.exec(text);
  if (!match) {
    return {
      ok: false,
      reason: `Pinned Eastern hour ${JSON.stringify(text)} must be YYYY-MM-DDTHH or YYYY-MM-DDTHH±HH:MM (America/New_York). Snapshot not written.`,
    };
  }
  const hour = match[1] ?? "";
  const explicitOffset = match[2] ?? "";
  let stamp: { hour: string; offset: string; t: number } | null = null;
  if (explicitOffset) {
    stamp = matchingEasternHour(hour, explicitOffset);
    if (!stamp) {
      return {
        ok: false,
        reason: `Pinned Eastern hour ${text} is not a real America/New_York hour — snapshot not written.`,
      };
    }
  } else {
    const matches = ["-04:00", "-05:00"]
      .map((offset) => matchingEasternHour(hour, offset))
      .filter((row): row is { hour: string; offset: string; t: number } => row !== null);
    if (matches.length > 1) {
      return {
        ok: false,
        reason: `Pinned Eastern hour ${hour} is ambiguous (fall-back). Pass the offset, for example ${hour}-04:00 or ${hour}-05:00. Snapshot not written.`,
      };
    }
    stamp = matches[0] ?? null;
    if (!stamp) {
      return {
        ok: false,
        reason: `Pinned Eastern hour ${hour} is not a real America/New_York hour — snapshot not written.`,
      };
    }
  }
  const nowHour = easternHourStamp(nowT);
  if (!nowHour) {
    return { ok: false, reason: "Pinned Eastern hour cannot be checked against an invalid clock — snapshot not written." };
  }
  if (stamp.t > nowHour.t) {
    return {
      ok: false,
      reason: `Pinned Eastern hour ${deskHourlyVolumeSnapshotLabel(stamp)} is still in the future — snapshot not written.`,
    };
  }
  if (nowHour.t - stamp.t > PINNED_EASTERN_HOUR_MAX_LAG_SECONDS) {
    return {
      ok: false,
      reason: `Pinned Eastern hour ${deskHourlyVolumeSnapshotLabel(stamp)} is more than two Eastern hours behind the clock. Historical gaps are not backfilled — snapshot not written.`,
    };
  }
  return { ok: true, stamp };
}

/**
 * Last 24 hours of captured Eastern-hour DexScreener rolling h24 desk totals.
 * `volumeUsd` is `combined24hUsd`. `t` is the unix start of that Eastern hour.
 * Keeps rows with `t` in `[nowT - 24h, nowT]`. Skips a null combined total.
 * Does not insert hours that are absent from `snapshots` and does not invent volume.
 * The 24H axis uses `easternRollingHourStarts` for the empty slots.
 */
export function buildHourlyRollingVolumeHistory(
  snapshots: readonly DeskHourlyVolumeSnapshot[],
  nowT: number,
): VolumeHistoryPoint[] {
  if (!Number.isFinite(nowT) || nowT <= 0) return [];
  const cutoff = nowT - HOURLY_ROLLING_VOLUME_WINDOW_SECONDS;
  const byT = new Map<number, VolumeHistoryPoint>();
  for (const row of snapshots) {
    if (!Number.isFinite(row.t) || row.t <= 0 || row.t < cutoff || row.t > nowT) continue;
    const volumeUsd = row.combined24hUsd;
    if (volumeUsd === null || !Number.isFinite(volumeUsd) || volumeUsd < 0) continue;
    byT.set(row.t, { t: row.t, volumeUsd, kind: "rolling_24h" });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

export function emptyHourlyRollingVolumeHistory(
  reason: string,
  generatedAt = new Date().toISOString(),
): EquityVolumeHistoryResult {
  return {
    available: false,
    points: [],
    seriesByMint: {},
    definition: DESK_HOURLY_ROLLING_VOLUME_DEFINITION,
    sourceLabel: DESK_HOURLY_ROLLING_VOLUME_SOURCE_LABEL,
    poolCount: 0,
    poolCountAttempted: 0,
    mintCount: 0,
    volume24hUsd: null,
    firstObservableAt: null,
    lastObservableAt: null,
    generatedAt,
    emptyReason: reason,
  };
}

/** History object the Solana desk page passes beside the closed-day series. */
export function buildHourlyRollingEquityVolumeHistory(input: {
  snapshots: readonly DeskHourlyVolumeSnapshot[];
  nowT: number;
  generatedAt: string;
}): EquityVolumeHistoryResult {
  const points = buildHourlyRollingVolumeHistory(input.snapshots, input.nowT);
  if (points.length === 0) {
    return emptyHourlyRollingVolumeHistory(
      "No DexScreener rolling 24h hourly snapshots in the last 24 hours. Missing hours are not invented.",
      input.generatedAt,
    );
  }
  const first = points[0];
  const last = points[points.length - 1];
  return {
    available: true,
    points,
    seriesByMint: {},
    definition: DESK_HOURLY_ROLLING_VOLUME_DEFINITION,
    sourceLabel: DESK_HOURLY_ROLLING_VOLUME_SOURCE_LABEL,
    poolCount: 0,
    poolCountAttempted: 0,
    mintCount: 0,
    volume24hUsd: last?.volumeUsd ?? null,
    firstObservableAt: first ? new Date(first.t * 1000).toISOString() : null,
    lastObservableAt: last ? new Date(last.t * 1000).toISOString() : null,
    generatedAt: input.generatedAt,
    emptyReason: null,
  };
}

/** Pretty envelope, one JSON object per hour, so an append stays a short diff. */
export function serializeDeskHourlyVolumeSnapshots(records: readonly DeskHourlyVolumeSnapshot[]): string {
  const rows = records.map((row) => `    ${JSON.stringify(canonicalHourlySnapshot(row))}`).join(",\n");
  const recordsBody = rows ? `\n${rows}\n  ` : "";
  return `{
  "version": 1,
  "hourKey": "America/New_York",
  "kind": ${JSON.stringify(DESK_HOURLY_VOLUME_KIND)},
  "units": {
    "volume24hUsd": "USD",
    "liquidityUsd": "USD"
  },
  "note": ${JSON.stringify(DESK_HOURLY_VOLUME_NOTE)},
  "records": [${recordsBody}]
}
`;
}
