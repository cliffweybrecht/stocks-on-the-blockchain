import { VOLUME_CHART_RANGES, type VolumeChartRangeId } from "./daily-volume-view";
import {
  isStoredEquityCategory,
  perpGroupLabel,
  perpVenueZeroFee,
  type PerpsCategory,
} from "./perps-classify";
import { compareNullableDesc, sumNullable } from "./numbers";
import { easternDayKey, utcInstantForDayKey } from "./volume-snapshots";

/**
 * Equity perpetual snapshots. Separate from tokenized-stock spot files.
 * One record per America/New_York date. Null is unreported, never coerced to 0.
 * Ostium stores lifetime volume; a daily figure is derived only when the
 * previous Eastern date also has a real lifetime number.
 */

export const PERPS_SNAPSHOT_SCHEMA = "equity-perps-v1";
export const PERPS_SNAPSHOT_FILE = "perps.json";

export type PerpsTier = "onchain" | "cex-direct" | "cex-coingecko";
export type PerpsVolumeWindow = "rolling-24h" | "et-day" | "lifetime" | "unavailable";

export interface PerpsMarketSnapshot {
  symbol: string;
  underlying: string;
  category: PerpsCategory;
  volume24hUsd: number | null;
  openInterestUsd: number | null;
  /** Ostium cumulative volumeInUsd. Absent when the venue has no lifetime field. */
  lifetimeVolumeUsd?: number | null;
  priceUsd: number | null;
}

export interface PerpsVenueSnapshot {
  venue: string;
  tier: PerpsTier;
  source: string;
  volumeWindow: PerpsVolumeWindow;
  windowNote: string;
  capturedAt: string;
  error: string | null;
  markets: PerpsMarketSnapshot[];
}

export interface PerpsDaySnapshot {
  date: string;
  capturedAt: string;
  venues: PerpsVenueSnapshot[];
}

export interface PerpsSnapshotFile {
  schema: typeof PERPS_SNAPSHOT_SCHEMA;
  records: PerpsDaySnapshot[];
  readError?: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIERS = new Set<PerpsTier>(["onchain", "cex-direct", "cex-coingecko"]);
const WINDOWS = new Set<PerpsVolumeWindow>(["rolling-24h", "et-day", "lifetime", "unavailable"]);
const CATEGORIES = new Set<PerpsCategory>(["stock", "etf", "leveraged-etf", "index"]);

export function emptyPerpsSnapshotFile(readError?: string): PerpsSnapshotFile {
  return readError
    ? { schema: PERPS_SNAPSHOT_SCHEMA, records: [], readError }
    : { schema: PERPS_SNAPSHOT_SCHEMA, records: [] };
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMarket(value: unknown): PerpsMarketSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const symbol = typeof row.symbol === "string" ? row.symbol : "";
  const underlying = typeof row.underlying === "string" ? row.underlying : "";
  const category = row.category;
  if (!symbol || !underlying || typeof category !== "string" || !CATEGORIES.has(category as PerpsCategory)) {
    return null;
  }
  if (!isStoredEquityCategory(category as PerpsCategory)) return null;
  const market: PerpsMarketSnapshot = {
    symbol,
    underlying,
    category: category as PerpsCategory,
    volume24hUsd: finiteOrNull(row.volume24hUsd),
    openInterestUsd: finiteOrNull(row.openInterestUsd),
    priceUsd: finiteOrNull(row.priceUsd),
  };
  if (row.lifetimeVolumeUsd !== undefined) {
    market.lifetimeVolumeUsd = finiteOrNull(row.lifetimeVolumeUsd);
  }
  return market;
}

function parseVenue(value: unknown): PerpsVenueSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const venue = typeof row.venue === "string" ? row.venue : "";
  const tier = row.tier;
  const source = typeof row.source === "string" ? row.source : "";
  const volumeWindow = row.volumeWindow;
  if (!venue || typeof tier !== "string" || !TIERS.has(tier as PerpsTier)) return null;
  if (typeof volumeWindow !== "string" || !WINDOWS.has(volumeWindow as PerpsVolumeWindow)) return null;
  const markets = Array.isArray(row.markets)
    ? row.markets.map(parseMarket).filter((market): market is PerpsMarketSnapshot => market !== null)
    : [];
  return {
    venue,
    tier: tier as PerpsTier,
    source,
    volumeWindow: volumeWindow as PerpsVolumeWindow,
    windowNote: typeof row.windowNote === "string" ? row.windowNote : "",
    capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : "",
    error: typeof row.error === "string" && row.error ? row.error : null,
    markets,
  };
}

export function parsePerpsSnapshotFile(raw: unknown): PerpsSnapshotFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return emptyPerpsSnapshotFile("Equity-perp snapshot file is not an object.");
  }
  const recordsRaw = (raw as { records?: unknown }).records;
  if (!Array.isArray(recordsRaw)) return emptyPerpsSnapshotFile("Equity-perp snapshot file has no records array.");
  const records: PerpsDaySnapshot[] = [];
  for (const row of recordsRaw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const date = (row as { date?: unknown }).date;
    if (typeof date !== "string" || !DAY_KEY.test(date)) continue;
    const venuesRaw = (row as { venues?: unknown }).venues;
    const venues = Array.isArray(venuesRaw)
      ? venuesRaw.map(parseVenue).filter((venue): venue is PerpsVenueSnapshot => venue !== null)
      : [];
    const capturedAt = (row as { capturedAt?: unknown }).capturedAt;
    records.push({
      date,
      capturedAt: typeof capturedAt === "string" ? capturedAt : "",
      venues,
    });
  }
  records.sort((a, b) => a.date.localeCompare(b.date));
  return { schema: PERPS_SNAPSHOT_SCHEMA, records };
}

export function serializePerpsSnapshot(file: PerpsSnapshotFile): string {
  const body: PerpsSnapshotFile = {
    schema: PERPS_SNAPSHOT_SCHEMA,
    records: [...file.records].sort((a, b) => a.date.localeCompare(b.date)),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Replace the same Eastern date. Older dates stay byte-stable inputs to the land guard. */
export function mergePerpsDay(file: PerpsSnapshotFile, day: PerpsDaySnapshot): PerpsSnapshotFile {
  if (!DAY_KEY.test(day.date)) throw new Error(`Refusing perps snapshot: ${day.date} is not YYYY-MM-DD.`);
  const records = file.records.filter((row) => row.date !== day.date);
  records.push(day);
  records.sort((a, b) => a.date.localeCompare(b.date));
  return { schema: PERPS_SNAPSHOT_SCHEMA, records };
}

export function previousEasternDayKey(day: string): string | null {
  if (!DAY_KEY.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 86_400_000).toISOString().slice(0, 10);
}

export function perpsDayIsClosed(date: string, nowUnixSeconds: number): boolean {
  const today = easternDayKey(nowUnixSeconds);
  return DAY_KEY.test(date) && today !== "" && date < today;
}

export interface PerpsViewMarket {
  underlying: string;
  group: string;
  category: PerpsCategory;
  volume24hUsd: number | null;
  openInterestUsd: number | null;
}

export interface PerpsViewVenue {
  venue: string;
  tier: PerpsTier;
  source: string;
  volumeWindow: PerpsVolumeWindow | "lifetime-diff";
  windowNote: string;
  capturedAt: string;
  error: string | null;
  zeroFee: boolean;
  markets: PerpsViewMarket[];
}

export interface PerpsViewDay {
  date: string;
  t: number;
  capturedAt: string;
  closed: boolean;
  venues: PerpsViewVenue[];
}

export interface PerpsDeskModel {
  days: PerpsViewDay[];
  readError: string | null;
}

function lifetimeBySymbol(venue: PerpsVenueSnapshot | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!venue) return map;
  for (const market of venue.markets) {
    const lifetime = market.lifetimeVolumeUsd;
    if (typeof lifetime === "number" && Number.isFinite(lifetime)) map.set(market.symbol, lifetime);
  }
  return map;
}

function toViewMarket(market: PerpsMarketSnapshot, volume24hUsd: number | null): PerpsViewMarket {
  return {
    underlying: market.underlying,
    group: perpGroupLabel(market.underlying),
    category: market.category,
    volume24hUsd,
    openInterestUsd: market.openInterestUsd,
  };
}

/**
 * Ostium daily volume is lifetime(today) − lifetime(previous Eastern date).
 * A gap, a missing prior print, or a lifetime that fell is left null.
 */
export function buildPerpsDeskModel(file: PerpsSnapshotFile, nowUnixSeconds: number): PerpsDeskModel {
  const byDate = new Map(file.records.map((row) => [row.date, row]));
  const days: PerpsViewDay[] = file.records.map((day) => {
    const prior = byDate.get(previousEasternDayKey(day.date) ?? "");
    const venues = day.venues.map((venue) => {
      if (venue.venue !== "Ostium") {
        return {
          venue: venue.venue,
          tier: venue.tier,
          source: venue.source,
          volumeWindow: venue.volumeWindow,
          windowNote: venue.windowNote,
          capturedAt: venue.capturedAt,
          error: venue.error,
          zeroFee: perpVenueZeroFee(venue.venue),
          markets: venue.markets.map((market) => toViewMarket(market, market.volume24hUsd)),
        } satisfies PerpsViewVenue;
      }
      const priorLifetime = lifetimeBySymbol(prior?.venues.find((row) => row.venue === "Ostium"));
      let diffs = 0;
      const markets = venue.markets.map((market) => {
        const lifetime = market.lifetimeVolumeUsd;
        const before = priorLifetime.get(market.symbol);
        let daily: number | null = null;
        if (
          typeof lifetime === "number" &&
          Number.isFinite(lifetime) &&
          typeof before === "number" &&
          lifetime >= before
        ) {
          daily = lifetime - before;
          diffs += 1;
        }
        return toViewMarket(market, daily);
      });
      return {
        venue: venue.venue,
        tier: venue.tier,
        source: venue.source,
        volumeWindow: diffs > 0 ? "lifetime-diff" : "lifetime",
        windowNote:
          diffs > 0
            ? "Daily change in Ostium lifetime volume versus the previous Eastern snapshot."
            : "Ostium reports lifetime volume only. A daily figure needs a snapshot on the previous Eastern date.",
        capturedAt: venue.capturedAt,
        error: venue.error,
        zeroFee: false,
        markets,
      } satisfies PerpsViewVenue;
    });
    return {
      date: day.date,
      t: utcInstantForDayKey(day.date),
      capturedAt: day.capturedAt,
      closed: perpsDayIsClosed(day.date, nowUnixSeconds),
      venues,
    };
  });
  return { days, readError: file.readError ?? null };
}

export interface PerpsChartPoint {
  date: string;
  t: number;
  volumeUsd: number | null;
  open: boolean;
}

export interface PerpsVenueRow {
  venue: string;
  tier: PerpsTier;
  source: string;
  volumeWindow: string;
  windowNote: string;
  error: string | null;
  zeroFee: boolean;
  volumeUsd: number | null;
  openInterestUsd: number | null;
  marketCount: number;
}

export interface PerpsUnderlyingRow {
  group: string;
  category: PerpsCategory;
  volumeUsd: number | null;
  openInterestUsd: number | null;
}

export interface PerpsRangeView {
  range: VolumeChartRangeId;
  excludeLeveraged: boolean;
  headlineUsd: number | null;
  onchainUsd: number | null;
  cexDirectUsd: number | null;
  cexCoingeckoUsd: number | null;
  leveragedUsd: number | null;
  caption: string;
  openDay: boolean;
  capturedAt: string | null;
  chart: PerpsChartPoint[];
  venues: PerpsVenueRow[];
  underlyings: PerpsUnderlyingRow[];
  /** Closed days inside the window that contributed a number. */
  reportedDays: number;
  windowDays: number;
}

interface DayRollup {
  total: number | null;
  onchain: number | null;
  cexDirect: number | null;
  cexCoingecko: number | null;
  leveraged: number | null;
}

function marketIncluded(category: PerpsCategory, excludeLeveraged: boolean): boolean {
  return !(excludeLeveraged && category === "leveraged-etf");
}

function rollupDay(day: PerpsViewDay, excludeLeveraged: boolean): DayRollup {
  const onchain: (number | null)[] = [];
  const cexDirect: (number | null)[] = [];
  const cexCoingecko: (number | null)[] = [];
  const leveraged: (number | null)[] = [];
  for (const venue of day.venues) {
    const volumes: (number | null)[] = [];
    for (const market of venue.markets) {
      if (market.category === "leveraged-etf") leveraged.push(market.volume24hUsd);
      if (!marketIncluded(market.category, excludeLeveraged)) continue;
      volumes.push(market.volume24hUsd);
    }
    const venueVolume = sumNullable(volumes);
    if (venue.tier === "onchain") onchain.push(venueVolume);
    else if (venue.tier === "cex-direct") cexDirect.push(venueVolume);
    else cexCoingecko.push(venueVolume);
  }
  const onchainUsd = sumNullable(onchain);
  const cexDirectUsd = sumNullable(cexDirect);
  const cexCoingeckoUsd = sumNullable(cexCoingecko);
  return {
    total: sumNullable([onchainUsd, cexDirectUsd, cexCoingeckoUsd]),
    onchain: onchainUsd,
    cexDirect: cexDirectUsd,
    cexCoingecko: cexCoingeckoUsd,
    leveraged: sumNullable(leveraged),
  };
}

function dayKeysEnding(endDate: string, count: number): string[] {
  const keys: string[] = [];
  let cursor: string | null = endDate;
  for (let i = 0; i < count && cursor; i += 1) {
    keys.push(cursor);
    cursor = previousEasternDayKey(cursor);
  }
  return keys;
}

function rangeLabel(range: VolumeChartRangeId): string {
  return VOLUME_CHART_RANGES.find((row) => row.id === range)?.label ?? range;
}

function formatEt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(t));
}

export function selectPerpsRange(
  days: readonly PerpsViewDay[],
  range: VolumeChartRangeId,
  excludeLeveraged: boolean,
): PerpsRangeView {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const closed = ordered.filter((day) => day.closed);
  const latest = ordered[ordered.length - 1] ?? null;
  const lastClosed = closed[closed.length - 1] ?? null;

  let selected: PerpsViewDay[] = [];
  let chartDays: PerpsViewDay[] = [];
  let openDay = false;
  let windowDays = 1;

  if (range === "24h") {
    const day = lastClosed ?? latest;
    selected = day ? [day] : [];
    chartDays = selected;
    openDay = Boolean(day && !day.closed);
    windowDays = 1;
  } else {
    const spec = VOLUME_CHART_RANGES.find((row) => row.id === range);
    windowDays = spec && "days" in spec ? spec.days : 7;
    if (lastClosed) {
      const keys = new Set(dayKeysEnding(lastClosed.date, windowDays));
      selected = ordered.filter((day) => day.closed && keys.has(day.date));
      chartDays = selected;
    }
  }

  const rollups = selected.map((day) => rollupDay(day, excludeLeveraged));
  const headlineUsd = sumNullable(rollups.map((row) => row.total));
  const onchainUsd = sumNullable(rollups.map((row) => row.onchain));
  const cexDirectUsd = sumNullable(rollups.map((row) => row.cexDirect));
  const cexCoingeckoUsd = sumNullable(rollups.map((row) => row.cexCoingecko));
  const leveragedUsd = sumNullable(rollups.map((row) => row.leveraged));
  const reportedDays = rollups.filter((row) => row.total !== null).length;
  const newest = selected[selected.length - 1] ?? null;
  const capturedAt = newest?.capturedAt || null;

  let caption: string;
  if (ordered.length === 0) {
    caption = "No equity-perp snapshot yet. The nightly capture runs at 11:59 PM America/New_York.";
  } else if (!newest) {
    caption = `${rangeLabel(range)} · no closed Eastern day in this range. 24H is the latest capture, and it is not a closed-day total until 11:59 PM America/New_York.`;
  } else if (range === "24h" && openDay) {
    caption = `Latest capture ${formatEt(newest.capturedAt)} · Eastern day ${newest.date} has not closed · rolling 24h venue totals, not the 11:59 PM ET snapshot`;
  } else if (range === "24h") {
    caption = `24H · ${newest.date} America/New_York · last closed snapshot${capturedAt ? ` · captured ${formatEt(newest.capturedAt)}` : ""}`;
  } else {
    caption = `${rangeLabel(range)} · sum of closed Eastern snapshots · ${reportedDays} of ${windowDays} days with a reported total`;
  }

  const venueMap = new Map<string, PerpsVenueRow>();
  for (const day of selected) {
    for (const venue of day.venues) {
      const existing = venueMap.get(venue.venue) ?? {
        venue: venue.venue,
        tier: venue.tier,
        source: venue.source,
        volumeWindow: venue.volumeWindow,
        windowNote: venue.windowNote,
        error: venue.error,
        zeroFee: venue.zeroFee,
        volumeUsd: null,
        openInterestUsd: null,
        marketCount: 0,
      };
      const volumes: (number | null)[] = [];
      const ois: (number | null)[] = [];
      let count = 0;
      for (const market of venue.markets) {
        if (!marketIncluded(market.category, excludeLeveraged)) continue;
        volumes.push(market.volume24hUsd);
        ois.push(market.openInterestUsd);
        count += 1;
      }
      existing.volumeUsd = sumNullable([existing.volumeUsd, sumNullable(volumes)]);
      existing.error = venue.error ?? existing.error;
      existing.windowNote = venue.windowNote || existing.windowNote;
      existing.volumeWindow = venue.volumeWindow;
      existing.source = venue.source || existing.source;
      if (newest && day.date === newest.date) {
        existing.openInterestUsd = sumNullable(ois);
        existing.marketCount = count;
      }
      venueMap.set(venue.venue, existing);
    }
  }

  const venues = [...venueMap.values()].sort((a, b) => {
    const byVolume = compareNullableDesc(a.volumeUsd, b.volumeUsd);
    if (byVolume !== 0) return byVolume;
    return a.venue.localeCompare(b.venue);
  });

  const underlyingMap = new Map<
    string,
    {
      group: string;
      volumeUsd: number | null;
      openInterestUsd: number | null;
      categories: Map<PerpsCategory, { weight: number; count: number }>;
    }
  >();
  for (const day of selected) {
    for (const venue of day.venues) {
      for (const market of venue.markets) {
        if (!marketIncluded(market.category, excludeLeveraged)) continue;
        const row = underlyingMap.get(market.group) ?? {
          group: market.group,
          volumeUsd: null,
          openInterestUsd: null,
          categories: new Map<PerpsCategory, { weight: number; count: number }>(),
        };
        row.volumeUsd = sumNullable([row.volumeUsd, market.volume24hUsd]);
        const slot = row.categories.get(market.category) ?? { weight: 0, count: 0 };
        slot.count += 1;
        slot.weight += market.volume24hUsd ?? 0;
        row.categories.set(market.category, slot);
        if (newest && day.date === newest.date) {
          row.openInterestUsd = sumNullable([row.openInterestUsd, market.openInterestUsd]);
        }
        underlyingMap.set(market.group, row);
      }
    }
  }

  const underlyings: PerpsUnderlyingRow[] = [...underlyingMap.values()]
    .map((row) => {
      let category: PerpsCategory = "stock";
      let bestWeight = -1;
      let bestCount = -1;
      for (const [cat, slot] of row.categories) {
        if (slot.weight > bestWeight || (slot.weight === bestWeight && slot.count > bestCount)) {
          bestWeight = slot.weight;
          bestCount = slot.count;
          category = cat;
        }
      }
      return {
        group: row.group,
        category,
        volumeUsd: row.volumeUsd,
        openInterestUsd: row.openInterestUsd,
      };
    })
    .sort((a, b) => compareNullableDesc(a.volumeUsd, b.volumeUsd) || a.group.localeCompare(b.group));

  return {
    range,
    excludeLeveraged,
    headlineUsd,
    onchainUsd,
    cexDirectUsd,
    cexCoingeckoUsd,
    leveragedUsd,
    caption,
    openDay,
    capturedAt,
    chart: chartDays.map((day) => ({
      date: day.date,
      t: day.t,
      volumeUsd: rollupDay(day, excludeLeveraged).total,
      open: !day.closed,
    })),
    venues,
    underlyings: underlyings.slice(0, 20),
    reportedDays,
    windowDays,
  };
}

export interface PerpsHomeSummary {
  hasSnapshot: boolean;
  readError: string | null;
  date: string | null;
  capturedAt: string | null;
  closed: boolean;
  totalUsd: number | null;
  onchainUsd: number | null;
  cexDirectUsd: number | null;
  cexCoingeckoUsd: number | null;
  caption: string;
}

export function perpsHomeSummary(model: PerpsDeskModel): PerpsHomeSummary {
  const view = selectPerpsRange(model.days, "24h", false);
  return {
    hasSnapshot: model.days.length > 0 && !model.readError,
    readError: model.readError,
    date: view.chart[0]?.date ?? null,
    capturedAt: view.capturedAt,
    closed: view.chart.length > 0 && !view.openDay,
    totalUsd: view.headlineUsd,
    onchainUsd: view.onchainUsd,
    cexDirectUsd: view.cexDirectUsd,
    cexCoingeckoUsd: view.cexCoingeckoUsd,
    caption: view.caption,
  };
}

export function perpsTierLabel(tier: PerpsTier): string {
  switch (tier) {
    case "onchain":
      return "Onchain";
    case "cex-direct":
      return "CEX";
    case "cex-coingecko":
      return "CoinGecko";
  }
}

export function shortPerpsSource(source: string): string {
  const match = source.match(/https?:\/\/[^\s"']+/);
  if (!match) return source.slice(0, 42);
  try {
    return new URL(match[0]).hostname.replace(/^www\./, "");
  } catch {
    return match[0];
  }
}
