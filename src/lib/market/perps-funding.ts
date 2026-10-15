/**
 * Funding quotes are stored as the venue's native decimal. Intervals are not
 * the same across venues, and most older rows did not store one.
 *
 * Annualized percent and the 8h equivalent are derived, and only when the
 * quote interval is known. A stored interval wins. Otherwise a documented
 * interval is used only when it does not vary by contract. No venue is given
 * a single catalog interval. OKX equity hours come from that capture's bulk
 * funding-rate call. Lighter's public rate has no interval.
 */

export type FundingHoursSource = "stored" | "documented" | "unknown";

export interface NormalizedFunding {
  venue: string;
  /** Native decimal quote. */
  rate: number;
  hours: number | null;
  hoursSource: FundingHoursSource;
  /** rate × (8 / hours). Null when the interval is unknown. */
  eightHour: number | null;
  /** rate × (365 × 24 / hours) × 100. Null when the interval is unknown. */
  annualizedPct: number | null;
}

export interface FundingSpreadRow {
  group: string;
  lowVenue: string;
  highVenue: string;
  spreadEightHour: number;
  spreadAnnualizedPct: number;
}

/** Hyperliquid `funding` is the hourly payment. Every HIP-3 market uses that quote. */
export function documentedFundingHours(venue: string): number | null {
  if (venue === "Hyperliquid HIP-3" || venue.startsWith("Hyperliquid HIP-3 (")) return 1;
  return null;
}

/**
 * Accept a feed interval only when it lands on a quarter hour from 15 minutes
 * through 24 hours. Anything else is left unknown rather than annualized.
 */
export function perpsFundingIntervalHours(value: unknown, unit: "hours" | "seconds"): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !(parsed > 0)) return null;
  const hours = unit === "hours" ? parsed : parsed / 3600;
  if (!(hours >= 0.25) || hours > 24) return null;
  const snapped = Math.round(hours * 4) / 4;
  if (Math.abs(snapped - hours) > 1e-4) return null;
  return snapped;
}

export function normalizeFunding(venue: string, rate: number, storedHours?: number | null): NormalizedFunding {
  const stored = typeof storedHours === "number" && Number.isFinite(storedHours) && storedHours > 0 ? storedHours : null;
  const documented = documentedFundingHours(venue);
  const hours = stored ?? documented;
  const hoursSource: FundingHoursSource = stored !== null ? "stored" : documented !== null ? "documented" : "unknown";
  if (hours === null) {
    return { venue, rate, hours: null, hoursSource, eightHour: null, annualizedPct: null };
  }
  return {
    venue,
    rate,
    hours,
    hoursSource,
    eightHour: rate * (8 / hours),
    annualizedPct: rate * ((365 * 24) / hours) * 100,
  };
}

export function fundingSpreads(
  tickers: readonly {
    group: string;
    category: string;
    funding?: Record<string, number>;
    fundingHours?: Record<string, number>;
  }[],
  excludeLeveraged: boolean,
): FundingSpreadRow[] {
  const rows: FundingSpreadRow[] = [];
  for (const ticker of tickers) {
    if (excludeLeveraged && ticker.category === "leveraged-etf") continue;
    const quotes = Object.entries(ticker.funding ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
      .map(([venue, rate]) => normalizeFunding(venue, rate, ticker.fundingHours?.[venue]))
      .filter((quote) => quote.eightHour !== null);
    if (quotes.length < 2) continue;
    const sorted = [...quotes].sort(
      (a, b) => (a.eightHour ?? 0) - (b.eightHour ?? 0) || a.venue.localeCompare(b.venue),
    );
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (!low || !high || low.eightHour === null || high.eightHour === null) continue;
    rows.push({
      group: ticker.group,
      lowVenue: low.venue,
      highVenue: high.venue,
      spreadEightHour: high.eightHour - low.eightHour,
      spreadAnnualizedPct: (high.annualizedPct ?? 0) - (low.annualizedPct ?? 0),
    });
  }
  return rows
    .sort((a, b) => Math.abs(b.spreadEightHour) - Math.abs(a.spreadEightHour) || a.group.localeCompare(b.group))
    .slice(0, 10);
}

export function formatFundingPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  const abs = Math.abs(pct);
  const digits = abs === 0 || abs >= 0.001 ? (abs >= 1 ? 2 : 3) : 6;
  return `${pct >= 0 ? "" : "−"}${abs.toFixed(digits)}%`;
}

export function formatAnnualizedPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "—";
  const digits = Math.abs(pct) >= 10 ? 1 : 2;
  return `${pct >= 0 ? "" : "−"}${Math.abs(pct).toFixed(digits)}%`;
}

export function fundingIntervalLabel(quote: NormalizedFunding): string {
  if (quote.hours === null) return "not on this feed";
  const hours = Number.isInteger(quote.hours) ? String(quote.hours) : quote.hours.toFixed(2);
  if (quote.hoursSource === "stored") return `${hours}h · stored`;
  return `${hours}h · documented`;
}
