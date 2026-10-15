import {
  classifyPerpUnderlying,
  normPerpSymbol,
  perpCategoryLabel,
  perpGroupLabel,
  type PerpsCategory,
  type PerpsClass,
} from "./perps-classify";
import { PERPS_FUNDING_CAP, PERPS_TICKER_CAP, type PerpsCompactTicker } from "./perps-compact";
import { sumNullable } from "./numbers";
import { perpsTierLabel, type PerpsDeskModel, type PerpsTier } from "./perps-snapshot";

export interface PerpsTickerPoint {
  date: string;
  t: number;
  closed: boolean;
  category: PerpsCategory;
  volumeUsd: number | null;
  openInterestUsd: number | null;
  onchainUsd: number | null;
  cexDirectUsd: number | null;
  cexCoingeckoUsd: number | null;
  longTailUsd: number | null;
  cexUsd: number | null;
  funding: { venue: string; rate: number; intervalHours: number | null }[];
  books: { venue: string; volumeUsd: number | null; openInterestUsd: number | null }[];
  tiers: {
    tier: PerpsTier;
    volumeUsd: number | null;
    openInterestUsd: number | null;
    venues: string[];
  }[];
}

export interface PerpsTickerVenueShare {
  venue: string;
  tier: PerpsTier;
  tierLabel: string;
  /** Set when this venue is the only name in the tier, so the tier volume is that venue. */
  volumeUsd: number | null;
  share: number | null;
  tierVolumeUsd: number | null;
  tierVenueCount: number;
}

export type PerpsTickerStatus = "stored" | "outside-cap" | "preipo" | "excluded";

export interface PerpsTickerPageModel {
  requested: string;
  group: string;
  category: PerpsClass;
  categoryLabel: string;
  status: PerpsTickerStatus;
  message: string;
  points: PerpsTickerPoint[];
  latest: PerpsTickerPoint | null;
  venueShares: PerpsTickerVenueShare[];
  funding: { venue: string; rate: number; intervalHours: number | null }[];
  fundingDate: string | null;
}

const TIERS: readonly PerpsTier[] = ["onchain", "cex-direct", "cex-coingecko", "long-tail"];

function finite(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointFromTicker(
  day: { date: string; t: number; closed: boolean },
  ticker: PerpsCompactTicker,
): PerpsTickerPoint {
  const tiers = TIERS.flatMap((tier) => {
    const slot = ticker.tiers[tier];
    if (!slot) return [];
    return [
      {
        tier,
        volumeUsd: finite(slot.volumeUsd),
        openInterestUsd: finite(slot.openInterestUsd),
        venues: slot.venues ?? [],
      },
    ];
  });
  const onchainUsd = finite(ticker.tiers.onchain?.volumeUsd);
  const cexDirectUsd = finite(ticker.tiers["cex-direct"]?.volumeUsd);
  const cexCoingeckoUsd = finite(ticker.tiers["cex-coingecko"]?.volumeUsd);
  const longTailUsd = finite(ticker.tiers["long-tail"]?.volumeUsd);
  const funding = Object.entries(ticker.funding ?? {})
    .map(([venue, rate]) => ({
      venue,
      rate,
      intervalHours: typeof ticker.fundingHours?.[venue] === "number" ? ticker.fundingHours[venue] : null,
    }))
    .filter((row) => Number.isFinite(row.rate))
    .sort((a, b) => a.venue.localeCompare(b.venue));
  return {
    date: day.date,
    t: day.t,
    closed: day.closed,
    category: ticker.category,
    volumeUsd: sumNullable([onchainUsd, cexDirectUsd, cexCoingeckoUsd, longTailUsd]),
    openInterestUsd: sumNullable(tiers.map((tier) => tier.openInterestUsd)),
    onchainUsd,
    cexDirectUsd,
    cexCoingeckoUsd,
    longTailUsd,
    cexUsd: sumNullable([cexDirectUsd, cexCoingeckoUsd, longTailUsd]),
    funding,
    books: (ticker.books ?? []).map((book) => ({
      venue: book.venue,
      volumeUsd: finite(book.volumeUsd),
      openInterestUsd: finite(book.openInterestUsd),
    })),
    tiers,
  };
}

export function perpsTickerHref(group: string): string {
  return `/perps/${encodeURIComponent(group)}`;
}

function knownGroups(model: PerpsDeskModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const day of model.days) {
    for (const ticker of day.tickers ?? []) {
      map.set(ticker.group.toLowerCase(), ticker.group);
    }
  }
  return map;
}

function categoryLabel(category: PerpsClass): string {
  if (category === "preipo") return "Pre-IPO";
  if (category === "nonequity") return "Non-equity";
  if (category === "etf-nonequity") return "Non-equity ETF";
  return perpCategoryLabel(category);
}

function statusMessage(status: PerpsTickerStatus, category: PerpsClass): string {
  if (status === "stored") {
    return "Days without a point are outside that day's stored ticker set. They are gaps, not zero volume.";
  }
  if (status === "preipo") {
    return "Pre-IPO is a side stat on the desk. Individual pre-IPO names are not stored in the per-ticker history, so this page does not invent a series.";
  }
  if (status === "excluded") {
    return category === "etf-nonequity"
      ? "This name is an ETF whose exposure is commodity, bonds, crypto, or volatility. Those ETFs are left out of the equity-perp universe."
      : "This name is classified as non-equity (commodity, FX, rates, or vol) and is left out of the equity-perp universe.";
  }
  return `This name is not in the stored ticker history. Each day keeps the top ${PERPS_TICKER_CAP} names for each headline toggle, plus Ostium lifetime names. Funding is stored for names that can reach the ${PERPS_FUNDING_CAP}-name table. A name outside that set is omitted, not stored as zero.`;
}

export function perpsTickerModel(model: PerpsDeskModel, raw: string): PerpsTickerPageModel {
  const requested = raw.trim();
  const known = knownGroups(model);
  const normalized = requested ? normPerpSymbol(requested) : "";
  const aliased = normalized ? perpGroupLabel(normalized) : "";
  const group = known.get(requested.toLowerCase()) ?? known.get(aliased.toLowerCase()) ?? (aliased || requested || "Unknown");
  const points = model.days
    .flatMap((day) => {
      const ticker = day.tickers?.find((row) => row.group === group);
      return ticker ? [pointFromTicker(day, ticker)] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = points[points.length - 1] ?? null;
  const classified = classifyPerpUnderlying(normalized || group);
  const category: PerpsClass = latest?.category ?? classified;
  let status: PerpsTickerStatus = "outside-cap";
  if (points.length > 0) status = "stored";
  else if (classified === "preipo") status = "preipo";
  else if (classified === "nonequity" || classified === "etf-nonequity") status = "excluded";
  const fundingPoint = [...points].reverse().find((point) => point.funding.length > 0) ?? null;
  return {
    requested,
    group,
    category,
    categoryLabel: categoryLabel(category),
    status,
    message: statusMessage(status, category),
    points,
    latest,
    venueShares: latest ? venueShares(latest) : [],
    funding: fundingPoint?.funding ?? [],
    fundingDate: fundingPoint?.date ?? null,
  };
}

function venueShares(point: PerpsTickerPoint): PerpsTickerVenueShare[] {
  const total = point.volumeUsd;
  const rows: PerpsTickerVenueShare[] = [];
  for (const tier of point.tiers) {
    const names = tier.venues;
    const shareOf = (volume: number | null) =>
      total !== null && total > 0 && volume !== null ? volume / total : null;
    if (names.length <= 1) {
      rows.push({
        venue: names[0] ?? perpsTierLabel(tier.tier),
        tier: tier.tier,
        tierLabel: perpsTierLabel(tier.tier),
        volumeUsd: tier.volumeUsd,
        share: shareOf(tier.volumeUsd),
        tierVolumeUsd: tier.volumeUsd,
        tierVenueCount: names.length,
      });
      continue;
    }
    for (const venue of names) {
      rows.push({
        venue,
        tier: tier.tier,
        tierLabel: perpsTierLabel(tier.tier),
        volumeUsd: null,
        share: null,
        tierVolumeUsd: tier.volumeUsd,
        tierVenueCount: names.length,
      });
    }
  }
  return rows;
}
