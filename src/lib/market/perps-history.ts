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
  /**
   * book: both days store the full name set.
   * stored-tickers: only the capped ticker list, so nothing is called a listing.
   * partial: only one day has the full name set.
   */
  scope: "book" | "stored-tickers" | "partial" | "unavailable";
  /** In the newer full book and absent from the older full book. */
  listed: string[];
  /** In the older full book, or in the older cap when only the newer day has a full book, and absent from that book. */
  delisted: string[];
  /** Moved into the capped ticker list without being a new listing. */
  enteredCap: string[];
  /** Left the capped ticker list and is still in the book, or the cap is all we have. */
  leftCap: string[];
  note: string;
}

function bookNames(day: PerpsViewDay): Set<string> | null {
  if (day.names && day.names.length > 0) return new Set(day.names);
  return null;
}

function tickerNames(day: PerpsViewDay): Set<string> {
  return new Set((day.tickers ?? []).map((ticker) => ticker.group));
}

function sortedNames(names: Iterable<string>): string[] {
  return [...names].sort((a, b) => a.localeCompare(b));
}

function emptyListing(date: string, previousDate: string | null, note: string): PerpsListingChange {
  return {
    date,
    previousDate,
    scope: "unavailable",
    listed: [],
    delisted: [],
    enteredCap: [],
    leftCap: [],
    note,
  };
}

export function perpsListingChanges(days: readonly PerpsViewDay[]): PerpsListingChange | null {
  const closed = [...days].filter((day) => day.closed).sort((a, b) => a.date.localeCompare(b.date));
  const latest = closed[closed.length - 1];
  if (!latest) return null;
  const previous = closed[closed.length - 2] ?? null;
  if (!previous) {
    return emptyListing(latest.date, null, "Listing changes need two consecutive stored days. This is the first closed day.");
  }
  const nextBook = bookNames(latest);
  const prevBook = bookNames(previous);
  const nextTickers = tickerNames(latest);
  const prevTickers = tickerNames(previous);
  if (!nextBook && nextTickers.size === 0) {
    return emptyListing(latest.date, previous.date, "This pair of days does not store a name set or a ticker list, so listings are not invented.");
  }
  if (!prevBook && prevTickers.size === 0) {
    return emptyListing(latest.date, previous.date, "This pair of days does not store a name set or a ticker list, so listings are not invented.");
  }
  if (nextBook && prevBook) {
    return {
      date: latest.date,
      previousDate: previous.date,
      scope: "book",
      listed: sortedNames([...nextBook].filter((name) => !prevBook.has(name))),
      delisted: sortedNames([...prevBook].filter((name) => !nextBook.has(name))),
      enteredCap: sortedNames([...nextTickers].filter((name) => prevBook.has(name) && !prevTickers.has(name))),
      leftCap: sortedNames([...prevTickers].filter((name) => nextBook.has(name) && !nextTickers.has(name))),
      note: `Names in the ${latest.date} book that were absent on ${previous.date}, and the reverse. A name can disappear because the price band missed it, not only because the venue delisted it. A name that leaves the capped ticker list but stays in the book is not a delisting.`,
    };
  }
  if (!nextBook && !prevBook) {
    return {
      date: latest.date,
      previousDate: previous.date,
      scope: "stored-tickers",
      listed: [],
      delisted: [],
      enteredCap: sortedNames([...nextTickers].filter((name) => !prevTickers.has(name))),
      leftCap: sortedNames([...prevTickers].filter((name) => !nextTickers.has(name))),
      note: "Compared on the capped ticker list only. A name that leaves this list is omitted from the stored rows, not delisted. Earlier days do not store the full book.",
    };
  }
  if (nextBook && !prevBook) {
    return {
      date: latest.date,
      previousDate: previous.date,
      scope: "partial",
      listed: [],
      delisted: sortedNames([...prevTickers].filter((name) => !nextBook.has(name))),
      enteredCap: [],
      leftCap: sortedNames([...prevTickers].filter((name) => nextBook.has(name) && !nextTickers.has(name))),
      note: `The ${latest.date} book is the full name set. ${previous.date} only has the capped ticker list, so a name that shows up on ${latest.date} is not counted as a new listing. A capped name absent from the ${latest.date} book is treated as gone. A capped name still in that book but outside the new cap left the stored list.`,
    };
  }
  return {
    date: latest.date,
    previousDate: previous.date,
    scope: "partial",
    listed: [],
    delisted: [],
    enteredCap: sortedNames([...nextTickers].filter((name) => prevBook?.has(name) && !prevTickers.has(name))),
    leftCap: sortedNames([...prevTickers].filter((name) => !nextTickers.has(name))),
    note: `The ${latest.date} row only has the capped ticker list, so a name missing from that list is not a delisting. A name that enters the cap and was already in the ${previous.date} book is cap movement.`,
  };
}

export function perpsQualityCounts(day: PerpsViewDay | null): { fresh: number; stale: number; failed: number } {
  const counts = { fresh: 0, stale: 0, failed: 0 };
  if (!day) return counts;
  for (const venue of day.venues) counts[perpsVenueQuality(venue)] += 1;
  return counts;
}
