import { combinedPublicPrivateVolume24h } from "./aggregate";
import { asNonNegativeNumber, sumNullable } from "./numbers";
import type {
  AssetPoolMark,
  AssetSummary,
  ChainVolume,
  EquityVolumeHistoryResult,
  InstrumentKind,
  VolumeHistoryPoint,
} from "./types";
import { emptyEquityVolumeHistory, utcDayStart } from "./volume-history";

export const DESK_VOLUME_SNAPSHOT_SOURCE_LABEL = "Desk DexScreener 24h snapshots";

export const DESK_VOLUME_SNAPSHOT_DEFINITION =
  "History is this desk’s closed DexScreener 24h snapshots (public + private + ETF/index, null omitted not $0). Days before snapshots began have no series — past DexScreener totals are not invented from GeckoTerminal. The in-progress Eastern day is omitted until that America/New_York date has closed.";

export const DEFAULT_VOLUME_SNAPSHOT_DIR = "data/volume-snapshots";
export const SOLANA_VOLUME_SNAPSHOT_FILE = "solana.json";

/**
 * One classified pool at snapshot time.
 * `volume24hUsd` is DexScreener `volume.h24`. `liquidityUsd` is `liquidity.usd`.
 * Missing liquidity is null, not $0.
 */
export interface DeskSnapshotPool {
  pairAddress: string;
  dexId: string;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
}

/**
 * One mint on this Eastern day. Same shape Base writes: address, symbol,
 * issuer when the desk knows it, instrumentKind, volume24hUsd,
 * displayedLiquidityUsd, and pools. Pre-IPO is "private".
 */
export interface DeskSnapshotAsset {
  address: string;
  symbol: string;
  issuer?: string;
  instrumentKind: InstrumentKind;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  pools: DeskSnapshotPool[];
}

export type DeskSnapshotAssetSource = Pick<
  AssetSummary,
  "contractAddress" | "symbol" | "issuer" | "instrumentKind" | "volume24hUsd" | "displayedLiquidityUsd"
> & {
  pools: readonly Pick<AssetPoolMark, "pairAddress" | "dexId" | "volume24hUsd" | "liquidityUsd">[];
};

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
  /** Gecko Eastern candles, DexScreener h24 fallback, or a mix. */
  volumeSource?: string;
  dexCombined24hUsd?: number | null;
  geckoCombined24hUsd?: number | null;
  /** Set when DexScreener and Gecko totals differ by more than 5%. */
  crossCheck?: string | null;
  gapPct?: number | null;
  /** Previous stored dollars when a day was replaced from Gecko coverage. */
  correction?: Record<string, unknown>;
  /**
   * Per-mint DexScreener rows for this Eastern day.
   * Absent on totals-only rewrites and on days recorded before per-asset rows.
   * An explicit empty list is a live sample that had no mint rows.
   */
  assets?: DeskSnapshotAsset[];
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

const EASTERN_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
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

function easternOffsetMs(utcMs: number): number {
  const parts = EASTERN_CLOCK.formatToParts(new Date(utcMs));
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second"));
  return utcMs - asUtc;
}

/**
 * Unix seconds of 00:00:00 America/New_York on `dayKey`.
 * The desk day runs from this instant until the next Eastern midnight, exclusive.
 */
export function easternMidnightUnix(dayKey: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return 0;
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return 0;
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const start = Math.trunc((guess + easternOffsetMs(guess)) / 1000);
  if (easternDayKey(start) === dayKey && easternDayKey(start - 1) !== dayKey) return start;
  for (let delta = -8 * 3600; delta <= 8 * 3600; delta += 3600) {
    const t = start + delta;
    if (easternDayKey(t) === dayKey && easternDayKey(t - 1) !== dayKey) return t;
  }
  return 0;
}

/**
 * Unix seconds of America/New_York midnight on a YYYY-MM-DD key.
 * Snapshot `t` is that instant. The name is historical; this is not 00:00:00Z.
 * During EDT that midnight is 04:00Z, and during EST it is 05:00Z, so the UTC
 * calendar date still matches the Eastern day key.
 */
export function utcInstantForDayKey(dayKey: string): number {
  return easternMidnightUnix(dayKey);
}

function snapshotChartDayKey(row: DeskVolumeSnapshot): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return row.date;
  return utcDayKey(row.t);
}

function clonePool(pool: DeskSnapshotPool): DeskSnapshotPool {
  return { ...pool };
}

function cloneAsset(asset: DeskSnapshotAsset): DeskSnapshotAsset {
  return { ...asset, pools: asset.pools.map(clonePool) };
}

function cloneSnapshot(row: DeskVolumeSnapshot): DeskVolumeSnapshot {
  if (!row.assets) return { ...row };
  return { ...row, assets: row.assets.map(cloneAsset) };
}

function roundUsd(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Asset rows for the nightly JSON. Displayed liquidity is the sum of classified
 * pool `liquidity.usd`, matching Base. The mint's `volume24hUsd` is the live
 * desk figure. A pool sum is used only when the desk left that figure null.
 * Assets with no pools and no reported volume or liquidity are omitted.
 */
export function deskSnapshotAssetsFromSummaries(
  assets: readonly DeskSnapshotAssetSource[],
): DeskSnapshotAsset[] {
  const byAddress = new Map<string, DeskSnapshotAsset>();
  for (const asset of assets) {
    const address = asset.contractAddress.trim();
    const symbol = asset.symbol.trim();
    if (!address || !symbol || byAddress.has(address)) continue;
    const pools: DeskSnapshotPool[] = [];
    const seenPairs = new Set<string>();
    for (const pool of asset.pools) {
      const pairAddress = pool.pairAddress.trim();
      if (!pairAddress || seenPairs.has(pairAddress)) continue;
      seenPairs.add(pairAddress);
      pools.push({
        pairAddress,
        dexId: pool.dexId.trim() || "unknown",
        volume24hUsd: roundUsd(asNonNegativeNumber(pool.volume24hUsd)),
        liquidityUsd: roundUsd(asNonNegativeNumber(pool.liquidityUsd)),
      });
    }
    const displayedFromPools = roundUsd(sumNullable(pools.map((pool) => pool.liquidityUsd)));
    const displayedLiquidityUsd =
      displayedFromPools ?? roundUsd(asNonNegativeNumber(asset.displayedLiquidityUsd));
    const volume24hUsd =
      roundUsd(asNonNegativeNumber(asset.volume24hUsd)) ??
      roundUsd(sumNullable(pools.map((pool) => pool.volume24hUsd)));
    if (pools.length === 0 && volume24hUsd === null && displayedLiquidityUsd === null) continue;
    const row: DeskSnapshotAsset = {
      address,
      symbol,
      instrumentKind: asset.instrumentKind,
      volume24hUsd,
      displayedLiquidityUsd,
      pools,
    };
    const issuer = asset.issuer?.trim() ?? "";
    if (issuer) row.issuer = issuer;
    byAddress.set(address, row);
  }
  return [...byAddress.values()].sort(
    (a, b) => a.symbol.toUpperCase().localeCompare(b.symbol.toUpperCase()) || a.address.localeCompare(b.address),
  );
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
  assetSource?: readonly DeskSnapshotAssetSource[],
  extras?: Pick<
    DeskVolumeSnapshot,
    "volumeSource" | "dexCombined24hUsd" | "geckoCombined24hUsd" | "crossCheck" | "gapPct" | "correction"
  >,
): DeskVolumeSnapshot {
  const parsed = Date.parse(generatedAt);
  const tSource =
    nowT !== undefined && Number.isFinite(nowT) && nowT > 0
      ? nowT
      : Number.isFinite(parsed) && parsed > 0
        ? parsed / 1000
        : Date.now() / 1000;
  // Day key is the America/New_York date. 00:00Z is still the previous Eastern
  // evening, so a UTC date must not open tomorrow on the desk.
  const date = easternDayKey(tSource);
  const t = utcInstantForDayKey(date);
  const publicEquity24hUsd = reportedUsd(chain.volume24hUsd);
  const private24hUsd = reportedUsd(chain.privateVolume24hUsd);
  const etfIndex24hUsd = reportedUsd(chain.etfVolume24hUsd);
  const snapshot: DeskVolumeSnapshot = {
    date,
    t,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd: combinedPublicPrivateVolume24h(publicEquity24hUsd, private24hUsd, etfIndex24hUsd),
    publicMintCount: Number.isFinite(chain.assetCount) ? chain.assetCount : null,
    publicPoolCount: Number.isFinite(chain.reportedPoolCount) ? chain.reportedPoolCount : null,
    generatedAt,
  };
  // Only a live desk sample sets `assets`. A totals-only rewrite leaves the key
  // off so a previous nightly row for this date is kept.
  if (assetSource) snapshot.assets = deskSnapshotAssetsFromSummaries(assetSource);
  if (extras?.volumeSource) snapshot.volumeSource = extras.volumeSource;
  if (extras && "dexCombined24hUsd" in extras) snapshot.dexCombined24hUsd = extras.dexCombined24hUsd;
  if (extras && "geckoCombined24hUsd" in extras) snapshot.geckoCombined24hUsd = extras.geckoCombined24hUsd;
  if (extras?.crossCheck) snapshot.crossCheck = extras.crossCheck;
  if (extras?.gapPct !== undefined && extras.gapPct !== null) snapshot.gapPct = extras.gapPct;
  if (extras?.correction) snapshot.correction = extras.correction;
  return snapshot;
}

/** Same America/New_York day is replaced. All-null days are never written (null is not $0). */
export function upsertDeskVolumeSnapshot(
  records: readonly DeskVolumeSnapshot[],
  incoming: DeskVolumeSnapshot,
): DeskVolumeSnapshot[] {
  if (incoming.t <= 0 || !incoming.date) return records.map(cloneSnapshot);
  if (incoming.combined24hUsd === null) return records.map(cloneSnapshot);
  const prior = records.find((row) => row.date === incoming.date);
  const next = records
    .filter((row) => row.date !== incoming.date && row.t !== incoming.t)
    .map(cloneSnapshot);
  const row = cloneSnapshot(incoming);
  if (incoming.assets === undefined && prior?.assets && prior.assets.length > 0) {
    row.assets = prior.assets.map(cloneAsset);
  }
  next.push(row);
  next.sort((a, b) => a.t - b.t);
  return next;
}

export type RecordDeskVolumeResult =
  | { ok: true; written: boolean; unchanged: boolean; snapshot: DeskVolumeSnapshot }
  | { ok: false; reason: string };

/**
 * Awaited persist of the DexScreener desk 24h for the America/New_York date of
 * `nowT`. Same upsert rules as the live desk: null omitted not $0; all-null
 * days are refused; the same Eastern day is replaced. The nightly
 * `snapshot:volume` writer calls this at the 11:59 PM ET close. Page and API
 * loads must not. Callers that must fail closed (CLI) should treat `ok: false`
 * as a hard error. The chart does not plot that day until New York has moved on.
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
  assetSource?: readonly DeskSnapshotAssetSource[],
  extras?: Pick<
    DeskVolumeSnapshot,
    "volumeSource" | "dexCombined24hUsd" | "geckoCombined24hUsd" | "crossCheck" | "gapPct" | "correction"
  >,
): Promise<RecordDeskVolumeResult> {
  const incoming = deskVolumeSnapshotFromChain(chain, generatedAt, nowT, assetSource, extras);
  if (incoming.t <= 0 || !incoming.date) {
    return { ok: false, reason: "DexScreener desk snapshot has no America/New_York day — snapshot not written." };
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
 * Chart points sit on America/New_York midnight of an Eastern date. That day is
 * closed only after New York has moved on to a later date. Today and any later
 * day stay off the series — a rolling 24h row is not a closed snapshot, and a
 * UTC date New York has not reached is not plotted.
 */
export function isClosedEasternSnapshotDay(unixSeconds: number, nowT: number): boolean {
  const todayKey = easternDayKey(nowT);
  if (!todayKey) return false;
  const key = utcDayKey(unixSeconds);
  return key !== "" && key < todayKey;
}

/**
 * Closed desk snapshot days only. Drops a live rolling-24h tip, the in-progress
 * America/New_York day, and any later day. Does not invent a tip from the
 * current DexScreener ~24h rollup.
 */
export function closedSnapshotVolumePoints(
  points: readonly VolumeHistoryPoint[],
  nowT: number,
): VolumeHistoryPoint[] {
  return points
    .filter(
      (point) =>
        isPlottableVolumePoint(point) &&
        point.kind !== "rolling_24h" &&
        isClosedEasternSnapshotDay(point.t, nowT),
    )
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
  // Hourly totals use `hour` (`YYYY-MM-DDTHH`) and no Eastern `date`. Their `t`
  // is an hour start, which can fall on the next UTC date. Never promote that
  // rolling row into a closed-day bar.
  if (typeof rec.hour === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(rec.hour)) return null;
  const rawT = typeof rec.t === "number" && Number.isFinite(rec.t) && rec.t > 0 ? rec.t : 0;
  const dateFromField =
    typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
  // Prefer the recorded Eastern date. `t` is America/New_York midnight of that
  // date (04:00Z in EDT, 05:00Z in EST). The UTC calendar date of that instant
  // matches the day key, so axis labels do not jump to the next UTC day.
  const date = dateFromField || utcDayKey(utcDayStart(rawT));
  const t = utcInstantForDayKey(date);
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
  const snapshot: DeskVolumeSnapshot = {
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
  if (typeof rec.volumeSource === "string" && rec.volumeSource.trim()) snapshot.volumeSource = rec.volumeSource;
  if ("dexCombined24hUsd" in rec) snapshot.dexCombined24hUsd = asNonNegativeNumber(rec.dexCombined24hUsd);
  if ("geckoCombined24hUsd" in rec) snapshot.geckoCombined24hUsd = asNonNegativeNumber(rec.geckoCombined24hUsd);
  if (typeof rec.crossCheck === "string" && rec.crossCheck.trim()) snapshot.crossCheck = rec.crossCheck;
  if (typeof rec.gapPct === "number" && Number.isFinite(rec.gapPct)) snapshot.gapPct = rec.gapPct;
  if (rec.correction && typeof rec.correction === "object" && !Array.isArray(rec.correction)) {
    snapshot.correction = rec.correction as Record<string, unknown>;
  }
  if (Array.isArray(rec.assets)) snapshot.assets = parseSnapshotAssets(rec.assets);
  return snapshot;
}

function parseSnapshotPool(row: unknown): DeskSnapshotPool | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  const pairAddress = typeof rec.pairAddress === "string" ? rec.pairAddress.trim() : "";
  if (!pairAddress) return null;
  const dexId = typeof rec.dexId === "string" && rec.dexId.trim() ? rec.dexId.trim() : "unknown";
  return {
    pairAddress,
    dexId,
    volume24hUsd: asNonNegativeNumber(rec.volume24hUsd),
    liquidityUsd: asNonNegativeNumber(rec.liquidityUsd),
  };
}

function parseSnapshotAssets(rows: readonly unknown[]): DeskSnapshotAsset[] {
  const parsed: DeskSnapshotAsset[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const address = typeof rec.address === "string" ? rec.address.trim() : "";
    const symbol = typeof rec.symbol === "string" ? rec.symbol.trim() : "";
    if (!address || !symbol || seen.has(address)) continue;
    seen.add(address);
    const kind = rec.instrumentKind;
    const instrumentKind: InstrumentKind = kind === "etf" || kind === "private" || kind === "equity" ? kind : "equity";
    const pools = Array.isArray(rec.pools)
      ? rec.pools.map(parseSnapshotPool).filter((pool): pool is DeskSnapshotPool => pool !== null)
      : [];
    const asset: DeskSnapshotAsset = {
      address,
      symbol,
      instrumentKind,
      volume24hUsd: asNonNegativeNumber(rec.volume24hUsd),
      displayedLiquidityUsd: asNonNegativeNumber(rec.displayedLiquidityUsd),
      pools,
    };
    if (typeof rec.issuer === "string" && rec.issuer.trim()) asset.issuer = rec.issuer.trim();
    parsed.push(asset);
  }
  return parsed;
}

export function serializeDeskVolumeSnapshots(records: readonly DeskVolumeSnapshot[]): string {
  return `${JSON.stringify({ version: 1, records }, null, 2)}\n`;
}

const PRESERVED_SNAPSHOT_RECORD_KEYS = ["assets", "symbolsWithVolume"] as const;

/**
 * A totals-only save omits `assets`. Keep per-asset rows already stored for
 * that date, and the file's day-key metadata, or equity-card ranges lose
 * history. A live sample that already set `assets` wins. A date that is not
 * in the new record list is not put back.
 */
export function mergePreservedSnapshotFile(serialized: string, previousRaw: string | null): string {
  if (!previousRaw) return serialized;
  let previous: unknown;
  let next: unknown;
  try {
    previous = JSON.parse(previousRaw);
    next = JSON.parse(serialized);
  } catch {
    return serialized;
  }
  if (!next || typeof next !== "object" || Array.isArray(next)) return serialized;
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return serialized;
  const prevObj = previous as Record<string, unknown>;
  const nextObj = next as Record<string, unknown>;
  let changed = false;
  for (const [key, value] of Object.entries(prevObj)) {
    if (key === "records" || key === "version") continue;
    if (nextObj[key] === undefined) {
      nextObj[key] = value;
      changed = true;
    }
  }
  const prevRecords = Array.isArray(prevObj.records) ? prevObj.records : [];
  const nextRecords = Array.isArray(nextObj.records) ? nextObj.records : [];
  const byDate = new Map<string, Record<string, unknown>>();
  for (const row of prevRecords) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.date === "string") byDate.set(rec.date, rec);
  }
  for (const row of nextRecords) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const prev = typeof rec.date === "string" ? byDate.get(rec.date) : undefined;
    if (!prev) continue;
    for (const key of PRESERVED_SNAPSHOT_RECORD_KEYS) {
      if (rec[key] === undefined && prev[key] !== undefined) {
        rec[key] = prev[key];
        changed = true;
      }
    }
  }
  if (!changed) return serialized;
  // Keep dayKey, units, and any other file metadata where the previous file
  // had them. Appending copied keys would move them to the end of the object.
  const ordered: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const key of Object.keys(prevObj)) {
    if (Object.prototype.hasOwnProperty.call(nextObj, key)) {
      ordered[key] = nextObj[key];
      seen.add(key);
    }
  }
  for (const key of Object.keys(nextObj)) {
    if (!seen.has(key)) ordered[key] = nextObj[key];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
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
