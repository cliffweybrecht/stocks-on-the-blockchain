import { sumNullable } from "./numbers";
import type { PerpsCompactTicker } from "./perps-compact";
import { perpsFeedKind } from "./perps-sources";
import { perpsVenueQuality, selectPerpsRange, type PerpsDeskModel, type PerpsTier, type PerpsViewDay } from "./perps-snapshot";

/**
 * CSV downloads for the equity-perp desk. Built from the parsed snapshot,
 * including Ostium lifetime differences already applied on the view model.
 * Null stays an empty cell.
 */

export const PERPS_CSV_FILES = [
  {
    id: "daily",
    href: "/perps/downloads/daily.csv",
    filename: "perps-daily.csv",
    label: "Daily history",
    detail: "One row per Eastern day: headline and tier totals.",
  },
  {
    id: "venues",
    href: "/perps/downloads/venues.csv",
    filename: "perps-venues.csv",
    label: "Per venue",
    detail: "One row per venue per day, with source and capture time.",
  },
  {
    id: "tickers",
    href: "/perps/downloads/tickers.csv",
    filename: "perps-tickers.csv",
    label: "Per ticker",
    detail: "One row per stored ticker per day. Names outside the stored set are absent, not zero.",
  },
] as const;

export type PerpsCsvId = (typeof PERPS_CSV_FILES)[number]["id"];

const DAILY_HEADERS = [
  "date",
  "headlineUsd",
  "onchainUsd",
  "binanceBybitUsd",
  "majorCexUsd",
  "longTailUsd",
  "unverifiedUsd",
  "excludedUsd",
  "leveragedEtfUsd",
  "preipoUsd",
  "closed",
] as const;

const VENUE_HEADERS = [
  "date",
  "venue",
  "tier",
  "credible",
  "volumeUsd",
  "openInterestUsd",
  "marketCount",
  "feed",
  "source",
  "volumeWindow",
  "capturedAt",
  "quality",
  "lastGoodAt",
  "noEquity",
] as const;

const TICKER_HEADERS = [
  "date",
  "ticker",
  "category",
  "volumeUsd",
  "openInterestUsd",
  "onchainUsd",
  "majorCexUsd",
  "binanceBybitUsd",
  "longTailUsd",
  "unverifiedUsd",
  "headlineUsd",
  "venues",
  "funding",
  "books",
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function csvNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return String(value);
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvEscape).join(",");
}

function tierSlot(ticker: PerpsCompactTicker, tier: PerpsTier): number | null {
  const value = ticker.tiers[tier]?.volumeUsd;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tierOi(ticker: PerpsCompactTicker, tier: PerpsTier): number | null {
  const value = ticker.tiers[tier]?.openInterestUsd;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildPerpsDailyCsv(model: PerpsDeskModel): string {
  const lines = [DAILY_HEADERS.join(",")];
  for (const day of [...model.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const view = selectPerpsRange([day], "24h", false, false);
    lines.push(
      csvRow([
        day.date,
        csvNumber(view.headlineUsd),
        csvNumber(view.onchainUsd),
        csvNumber(view.cexCoingeckoUsd),
        csvNumber(view.cexDirectUsd),
        csvNumber(view.longTailUsd),
        csvNumber(view.unverifiedUsd),
        csvNumber(view.excludedUsd),
        csvNumber(view.leveragedUsd),
        csvNumber(view.preipoUsd),
        day.closed ? "true" : "false",
      ]),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function buildPerpsVenueCsv(model: PerpsDeskModel): string {
  const lines = [VENUE_HEADERS.join(",")];
  for (const day of [...model.days].sort((a, b) => a.date.localeCompare(b.date))) {
    const view = selectPerpsRange([day], "24h", false, true);
    const venues = [...view.venues].sort((a, b) => a.venue.localeCompare(b.venue));
    for (const venue of venues) {
      lines.push(
        csvRow([
          day.date,
          venue.venue,
          venue.tier,
          venue.credible ? "true" : "false",
          csvNumber(venue.volumeUsd),
          csvNumber(venue.openInterestUsd),
          String(venue.marketCount),
          perpsFeedKind(venue.source),
          venue.source,
          venue.volumeWindow,
          venue.capturedAt,
          perpsVenueQuality(venue),
          venue.lastGoodAt || (perpsVenueQuality(venue) === "fresh" ? venue.capturedAt : ""),
          venue.noEquity ? "true" : "",
        ]),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function tickerVenues(ticker: PerpsCompactTicker): string {
  const names = new Set<string>();
  for (const slot of Object.values(ticker.tiers)) {
    for (const name of slot?.venues ?? []) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b)).join("; ");
}

function tickerFunding(ticker: PerpsCompactTicker): string {
  if (!ticker.funding) return "";
  return Object.entries(ticker.funding)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([venue, rate]) => {
      const hours = ticker.fundingHours?.[venue];
      return typeof hours === "number" ? `${venue}=${rate}@${hours}h` : `${venue}=${rate}`;
    })
    .join("; ");
}

function tickerBooks(ticker: PerpsCompactTicker): string {
  return (ticker.books ?? [])
    .map((book) => `${book.venue}=${typeof book.volumeUsd === "number" ? book.volumeUsd : ""}`)
    .join("; ");
}

function tickerLines(day: PerpsViewDay): string[] {
  const tickers = [...(day.tickers ?? [])].sort((a, b) => a.group.localeCompare(b.group));
  return tickers.map((ticker) => {
    const onchain = tierSlot(ticker, "onchain");
    const major = tierSlot(ticker, "cex-direct");
    const binanceBybit = tierSlot(ticker, "cex-coingecko");
    const longTail = tierSlot(ticker, "long-tail");
    const unverified = tierSlot(ticker, "unverified");
    const headline = sumNullable([onchain, major, binanceBybit]);
    const volume = sumNullable([headline, longTail, unverified]);
    const oi = sumNullable([
      tierOi(ticker, "onchain"),
      tierOi(ticker, "cex-direct"),
      tierOi(ticker, "cex-coingecko"),
      tierOi(ticker, "long-tail"),
      tierOi(ticker, "unverified"),
    ]);
    return csvRow([
      day.date,
      ticker.group,
      ticker.category,
      csvNumber(volume),
      csvNumber(oi),
      csvNumber(onchain),
      csvNumber(major),
      csvNumber(binanceBybit),
      csvNumber(longTail),
      csvNumber(unverified),
      csvNumber(headline),
      tickerVenues(ticker),
      tickerFunding(ticker),
      tickerBooks(ticker),
    ]);
  });
}

export function buildPerpsTickerCsv(model: PerpsDeskModel): string {
  const lines = [TICKER_HEADERS.join(",")];
  for (const day of [...model.days].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(...tickerLines(day));
  }
  return `${lines.join("\n")}\n`;
}

export function buildPerpsCsv(id: PerpsCsvId, model: PerpsDeskModel): string {
  if (id === "daily") return buildPerpsDailyCsv(model);
  if (id === "venues") return buildPerpsVenueCsv(model);
  return buildPerpsTickerCsv(model);
}
