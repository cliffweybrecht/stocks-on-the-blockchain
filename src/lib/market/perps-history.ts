import { perpPlace } from "./perps-meta";
import { sumNullable } from "./numbers";
import {
  perpsVenueInHeadline,
  perpsVenueQuality,
  type PerpsStoredCategory,
  type PerpsViewDay,
  type PerpsViewVenue,
} from "./perps-snapshot";

/**
 * Read-time series for the desk. Open interest is a stock, so these helpers
 * do not sum it across days. Share uses each day's own headline.
 */

const EQUITY: readonly PerpsStoredCategory[] = ["stock", "etf", "leveraged-etf", "index"];

function included(
  venue: PerpsViewVenue,
  excludeLeveraged: boolean,
  includeLongTail: boolean,
): { volumeUsd: number | null; openInterestUsd: number | null } {
  if (!perpsVenueInHeadline(venue, includeLongTail)) return { volumeUsd: null, openInterestUsd: null };
  if (!venue.parts) {
    const volumes: (number | null)[] = [];
    const ois: (number | null)[] = [];
    for (const market of venue.markets) {
      if (market.category === "preipo") continue;
      if (excludeLeveraged && market.category === "leveraged-etf") continue;
      volumes.push(market.volume24hUsd);
      ois.push(market.openInterestUsd);
    }
    return { volumeUsd: sumNullable(volumes), openInterestUsd: sumNullable(ois) };
  }
  const volumes: (number | null)[] = [];
  const ois: (number | null)[] = [];
  for (const category of EQUITY) {
    if (excludeLeveraged && category === "leveraged-etf") continue;
    const part = venue.parts[category];
    if (!part) continue;
    volumes.push(part.volumeUsd ?? null);
    ois.push(part.openInterestUsd ?? null);
  }
  return { volumeUsd: sumNullable(volumes), openInterestUsd: sumNullable(ois) };
}

export interface PerpsOiPoint {
  date: string;
  t: number;
  openInterestUsd: number | null;
  volumeUsd: number | null;
  /** Volume divided by open interest for that day. Null when either side is missing. */
  volOi: number | null;
}

export function perpsOiSeries(
  days: readonly PerpsViewDay[],
  excludeLeveraged: boolean,
  includeLongTail: boolean,
): PerpsOiPoint[] {
  return [...days]
    .filter((day) => day.closed)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => {
      const volumes: (number | null)[] = [];
      const ois: (number | null)[] = [];
      for (const venue of day.venues) {
        const row = included(venue, excludeLeveraged, includeLongTail);
        volumes.push(row.volumeUsd);
        ois.push(row.openInterestUsd);
      }
      const volumeUsd = sumNullable(volumes);
      const openInterestUsd = sumNullable(ois);
      const volOi =
        volumeUsd !== null && openInterestUsd !== null && openInterestUsd > 0 ? volumeUsd / openInterestUsd : null;
      return { date: day.date, t: day.t, openInterestUsd, volumeUsd, volOi };
    });
}

export interface PerpsShareSlice {
  name: string;
  /** Null when that day has no headline, or this name was absent. Absence is not zero. */
  share: number | null;
  volumeUsd: number | null;
}

export interface PerpsShareColumn {
  date: string;
  headlineUsd: number | null;
  rows: PerpsShareSlice[];
}

function shareColumns(
  days: readonly PerpsViewDay[],
  excludeLeveraged: boolean,
  includeLongTail: boolean,
  keyOf: (venue: PerpsViewVenue) => string | null,
  limit: number,
): PerpsShareColumn[] {
  const closed = [...days].filter((day) => day.closed).sort((a, b) => a.date.localeCompare(b.date));
  const latest = closed[closed.length - 1];
  const rank = new Map<string, number>();
  if (latest) {
    for (const venue of latest.venues) {
      const name = keyOf(venue);
      if (!name) continue;
      const volume = included(venue, excludeLeveraged, includeLongTail).volumeUsd;
      if (volume === null) continue;
      rank.set(name, (rank.get(name) ?? 0) + volume);
    }
  }
  const names = [...rank.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
  return closed.map((day) => {
    const byName = new Map<string, (number | null)[]>();
    const headline: (number | null)[] = [];
    for (const venue of day.venues) {
      const row = included(venue, excludeLeveraged, includeLongTail);
      headline.push(row.volumeUsd);
      const name = keyOf(venue);
      if (!name || !names.includes(name)) continue;
      const list = byName.get(name) ?? [];
      list.push(row.volumeUsd);
      byName.set(name, list);
    }
    const headlineUsd = sumNullable(headline);
    return {
      date: day.date,
      headlineUsd,
      rows: names.map((name) => {
        const volumeUsd = byName.has(name) ? sumNullable(byName.get(name) ?? []) : null;
        const share =
          headlineUsd !== null && headlineUsd > 0 && volumeUsd !== null ? volumeUsd / headlineUsd : null;
        return { name, share, volumeUsd };
      }),
    };
  });
}

export function perpsVenueShareSeries(
  days: readonly PerpsViewDay[],
  excludeLeveraged: boolean,
  includeLongTail: boolean,
  limit = 8,
): PerpsShareColumn[] {
  return shareColumns(days, excludeLeveraged, includeLongTail, (venue) => venue.venue, limit);
}

export function perpsChainShareSeries(
  days: readonly PerpsViewDay[],
  excludeLeveraged: boolean,
  includeLongTail: boolean,
): PerpsShareColumn[] {
  return shareColumns(
    days,
    excludeLeveraged,
    includeLongTail,
    (venue) => (venue.tier === "onchain" ? venue.onchainChain || perpPlace(venue.venue)?.onchainChain || null : null),
    12,
  );
}

export interface PerpsListingChange {
  date: string;
  previousDate: string | null;
  /** book: full stored name set. stored-tickers: only the capped ticker list. */
  scope: "book" | "stored-tickers" | "unavailable";
  listed: string[];
  delisted: string[];
  note: string;
}

function nameSet(day: PerpsViewDay): { names: Set<string>; scope: "book" | "stored-tickers" } | null {
  if (day.names && day.names.length > 0) return { names: new Set(day.names), scope: "book" };
  const tickers = day.tickers ?? [];
  if (tickers.length === 0) return null;
  return { names: new Set(tickers.map((ticker) => ticker.group)), scope: "stored-tickers" };
}

export function perpsListingChanges(days: readonly PerpsViewDay[]): PerpsListingChange | null {
  const closed = [...days].filter((day) => day.closed).sort((a, b) => a.date.localeCompare(b.date));
  const latest = closed[closed.length - 1];
  if (!latest) return null;
  const previous = closed[closed.length - 2] ?? null;
  if (!previous) {
    return {
      date: latest.date,
      previousDate: null,
      scope: "unavailable",
      listed: [],
      delisted: [],
      note: "Listing changes need two consecutive stored days. This is the first closed day.",
    };
  }
  const nextSet = nameSet(latest);
  const prevSet = nameSet(previous);
  if (!nextSet || !prevSet) {
    return {
      date: latest.date,
      previousDate: previous.date,
      scope: "unavailable",
      listed: [],
      delisted: [],
      note: "This pair of days does not store a name set or a ticker list, so listings are not invented.",
    };
  }
  const scope = nextSet.scope === "book" && prevSet.scope === "book" ? "book" : "stored-tickers";
  const listed = [...nextSet.names].filter((name) => !prevSet.names.has(name)).sort((a, b) => a.localeCompare(b));
  const delisted = [...prevSet.names].filter((name) => !nextSet.names.has(name)).sort((a, b) => a.localeCompare(b));
  const note =
    scope === "book"
      ? `Names in the ${latest.date} book that were absent on ${previous.date}, and the reverse. A name can disappear because the price band missed it, not only because the venue delisted it.`
      : `Compared on the capped ticker list only. A name outside that list is omitted, not delisted. Earlier days do not store the full book.`;
  return { date: latest.date, previousDate: previous.date, scope, listed, delisted, note };
}

export function perpsQualityCounts(day: PerpsViewDay | null): { fresh: number; stale: number; failed: number } {
  const counts = { fresh: 0, stale: 0, failed: 0 };
  if (!day) return counts;
  for (const venue of day.venues) counts[perpsVenueQuality(venue)] += 1;
  return counts;
}
