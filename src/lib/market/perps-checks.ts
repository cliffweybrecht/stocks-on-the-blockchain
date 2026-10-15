import { perpsArchiveVariance } from "./perps-archive";
import { perpsFeedKind } from "./perps-sources";
import {
  buildPerpsDeskModel,
  mergePerpsDay,
  perpsVenueInHeadline,
  perpsVenueQuality,
  selectPerpsRange,
  type PerpsDataCheck,
  type PerpsDaySnapshot,
  type PerpsSnapshotFile,
  type PerpsVenueRow,
  type PerpsViewDay,
} from "./perps-snapshot";

/**
 * Informational flags for one new row against the previous stored day.
 * They never change volume, open interest, or the headline. A throw is
 * swallowed by {@link withPerpsChecks} so the nightly land still writes the day.
 */

export const PERPS_CHECK_CAP = 12;
export const PERPS_CHECK_TEXT_MAX = 120;
export const PERPS_CHECK_HEADLINE_SWING = 0.4;
export const PERPS_CHECK_TIER_SWING = 0.5;
export const PERPS_CHECK_VENUE_SWING = 0.6;
export const PERPS_CHECK_VENUE_MIN_USD = 50_000_000;
export const PERPS_CHECK_SWING_MIN_USD = 1_000_000;
export const PERPS_CHECK_VENUE_COUNT_DELTA = 5;
export const PERPS_CHECK_MARKET_REL = 0.2;
export const PERPS_CHECK_MARKET_ABS = 200;
export const PERPS_CHECK_VANISH_VOLUME_USD = 10_000_000;
export const PERPS_CHECK_VANISH_OI_USD = 5_000_000;
export const PERPS_CHECK_CG_SHARE = 0.6;
export const PERPS_CHECK_CG_SHARE_MOVE = 0.1;
export const PERPS_CHECK_ARCHIVE_VARIANCE = 0.25;
export const PERPS_CHECK_ARCHIVE_COVERED = 5;
export const PERPS_CHECK_VENUE_SWING_CAP = 4;

function flag(code: string, text: string): PerpsDataCheck {
  return { code: code.slice(0, 40), text: text.slice(0, PERPS_CHECK_TEXT_MAX) };
}

function signedPercent(ratio: number): string {
  const pct = Math.round(ratio * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function rel(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || !(previous > 0)) return null;
  return (current - previous) / previous;
}

function blank(value: number | null): boolean {
  return value === null || value === 0;
}

function headlineVenue(venue: PerpsVenueRow): boolean {
  return perpsVenueInHeadline(venue, false) && venue.noEquity !== true;
}

function cgShare(view: ReturnType<typeof selectPerpsRange>): number | null {
  const headline = view.headlineUsd;
  if (headline === null || !(headline > 0)) return null;
  let cg = 0;
  for (const venue of view.venues) {
    if (!headlineVenue(venue) || perpsFeedKind(venue.source) !== "CoinGecko") continue;
    if (typeof venue.volumeUsd === "number" && Number.isFinite(venue.volumeUsd)) cg += venue.volumeUsd;
  }
  return cg / headline;
}

function pushSwing(
  out: PerpsDataCheck[],
  code: string,
  label: string,
  current: number | null,
  previous: number | null,
  threshold: number,
  floor: number,
): void {
  if (previous === null || !(previous >= floor)) return;
  const delta = rel(current, previous);
  if (delta === null || Math.abs(delta) < threshold) return;
  out.push(flag(code, `${label} ${signedPercent(delta)} d/d: verify`));
}

function archiveFlags(day: PerpsViewDay): PerpsDataCheck[] {
  const archive = day.archive;
  if (!archive) return [];
  const out: PerpsDataCheck[] = [];
  for (const [code, label, row] of [
    ["archive-binance", "Binance", archive.binance],
    ["archive-bybit", "Bybit", archive.bybit],
  ] as const) {
    if (row.covered < PERPS_CHECK_ARCHIVE_COVERED) continue;
    const variance = perpsArchiveVariance(row.coingeckoVolumeUsd, row.volumeUsd);
    if (variance === null || Math.abs(variance) < PERPS_CHECK_ARCHIVE_VARIANCE) continue;
    out.push(flag(code, `${label} CoinGecko vs archive ${signedPercent(variance)}: verify`));
  }
  return out;
}

/**
 * Compare one closed view day with the previous stored day.
 * With no previous day, only the archive cross-check can flag.
 */
export function perpsRowChecks(current: PerpsViewDay, previous: PerpsViewDay | null): PerpsDataCheck[] {
  const out: PerpsDataCheck[] = [];
  if (previous) {
    const curr = selectPerpsRange([current], "24h", false, false);
    const prev = selectPerpsRange([previous], "24h", false, false);
    pushSwing(out, "headline", "Headline", curr.headlineUsd, prev.headlineUsd, PERPS_CHECK_HEADLINE_SWING, PERPS_CHECK_SWING_MIN_USD);
    pushSwing(out, "tier-onchain", "Onchain", curr.onchainUsd, prev.onchainUsd, PERPS_CHECK_TIER_SWING, PERPS_CHECK_SWING_MIN_USD);
    pushSwing(out, "tier-major-cex", "Major CEX", curr.cexDirectUsd, prev.cexDirectUsd, PERPS_CHECK_TIER_SWING, PERPS_CHECK_SWING_MIN_USD);
    pushSwing(
      out,
      "tier-binance-bybit",
      "Binance+Bybit",
      curr.cexCoingeckoUsd,
      prev.cexCoingeckoUsd,
      PERPS_CHECK_TIER_SWING,
      PERPS_CHECK_SWING_MIN_USD,
    );
    if (Math.abs(curr.venueCount - prev.venueCount) >= PERPS_CHECK_VENUE_COUNT_DELTA) {
      out.push(flag("venue-count", `Headline venues ${prev.venueCount.toLocaleString("en-US")} → ${curr.venueCount.toLocaleString("en-US")}: verify`));
    }
    const marketDelta = Math.abs(curr.marketCount - prev.marketCount);
    const marketRel = prev.marketCount > 0 ? marketDelta / prev.marketCount : 0;
    if (marketDelta >= PERPS_CHECK_MARKET_ABS && marketRel >= PERPS_CHECK_MARKET_REL) {
      out.push(
        flag("market-count", `Headline markets ${prev.marketCount.toLocaleString("en-US")} → ${curr.marketCount.toLocaleString("en-US")}: verify`),
      );
    }

    const today = new Map(curr.venues.map((venue) => [venue.venue, venue]));
    for (const prior of prev.venues) {
      if (prior.noEquity) continue;
      const next = today.get(prior.venue);
      if (next && perpsVenueQuality(next) !== "fresh") continue;
      const volumeGone = typeof prior.volumeUsd === "number" && prior.volumeUsd >= PERPS_CHECK_VANISH_VOLUME_USD && blank(next?.volumeUsd ?? null);
      const oiGone =
        typeof prior.openInterestUsd === "number" && prior.openInterestUsd >= PERPS_CHECK_VANISH_OI_USD && blank(next?.openInterestUsd ?? null);
      if (volumeGone) {
        const zero = next?.volumeUsd === 0;
        out.push(
          flag(
            `vanish-vol:${prior.venue}`,
            zero ? `${prior.venue} volume is zero vs the prior day: verify` : `${prior.venue} volume missing vs the prior day: verify`,
          ),
        );
      }
      if (oiGone) {
        const zero = next?.openInterestUsd === 0;
        out.push(
          flag(
            `vanish-oi:${prior.venue}`,
            zero
              ? `${prior.venue} open interest is zero vs the prior day: verify`
              : `${prior.venue} open interest missing vs the prior day: verify`,
          ),
        );
      }
    }

    const swings: { venue: string; delta: number }[] = [];
    for (const venue of curr.venues) {
      if (!headlineVenue(venue)) continue;
      const prior = prev.venues.find((row) => row.venue === venue.venue);
      if (!prior || prior.volumeUsd === null || !(prior.volumeUsd >= PERPS_CHECK_VENUE_MIN_USD)) continue;
      const delta = rel(venue.volumeUsd, prior.volumeUsd);
      if (delta === null || Math.abs(delta) < PERPS_CHECK_VENUE_SWING) continue;
      swings.push({ venue: venue.venue, delta });
    }
    swings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.venue.localeCompare(b.venue));
    for (const swing of swings.slice(0, PERPS_CHECK_VENUE_SWING_CAP)) {
      out.push(flag(`swing:${swing.venue}`, `${swing.venue} ${signedPercent(swing.delta)} d/d: verify`));
    }

    const currShare = cgShare(curr);
    const prevShare = cgShare(prev);
    if (currShare !== null && prevShare !== null && Math.abs(currShare - prevShare) >= PERPS_CHECK_CG_SHARE_MOVE) {
      out.push(
        flag(
          "cg-share",
          `CoinGecko share ${Math.round(prevShare * 100)}% → ${Math.round(currShare * 100)}%: verify`,
        ),
      );
    } else if (currShare !== null && currShare >= PERPS_CHECK_CG_SHARE) {
      out.push(flag("cg-share", `CoinGecko is ${Math.round(currShare * 100)}% of headline volume: verify`));
    }
  }
  out.push(...archiveFlags(current));
  return out.slice(0, PERPS_CHECK_CAP);
}

/**
 * Attach checks after quality is stamped. Any failure returns the day unchanged
 * so a bad comparison cannot block the snapshot write.
 */
export function withPerpsChecks(day: PerpsDaySnapshot, existing: PerpsSnapshotFile): PerpsDaySnapshot {
  try {
    const provisional = mergePerpsDay(existing, day);
    const capturedMs = Date.parse(day.capturedAt);
    const nowSeconds = (Number.isFinite(capturedMs) ? capturedMs : Date.now()) / 1000 + 86_400;
    const model = buildPerpsDeskModel(provisional, nowSeconds);
    const current = model.days.find((row) => row.date === day.date);
    if (!current) return { ...day, checks: [] };
    const priorDate = existing.records
      .map((row) => row.date)
      .filter((date) => date < day.date)
      .sort((a, b) => a.localeCompare(b))
      .at(-1);
    const previous = priorDate ? (model.days.find((row) => row.date === priorDate) ?? null) : null;
    return { ...day, checks: perpsRowChecks(current, previous) };
  } catch {
    return day;
  }
}
