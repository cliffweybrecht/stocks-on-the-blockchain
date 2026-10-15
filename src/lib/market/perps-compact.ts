import { decodePerpsArchive, encodePerpsArchive, type PerpsArchiveCheck } from "./perps-archive";
import type { PerpsCategory } from "./perps-classify";
import { perpGroupLabel } from "./perps-classify";
import { sumNullable } from "./numbers";
import type {
  PerpsDaySnapshot,
  PerpsMarketSnapshot,
  PerpsStoredCategory,
  PerpsTier,
  PerpsVenueSnapshot,
  PerpsVolumeWindow,
} from "./perps-snapshot";

/**
 * Compact equity-perp day. The desk needs venue totals (with a leveraged-ETF
 * split), category mix, chain and HIP-3 builder sums, a capped ticker list
 * with venue counts, and funding for those tickers. It does not need the
 * per-market book, prices, or raw symbols except Ostium lifetime keys.
 *
 * Ticker rows kept per day are the top {@link PERPS_TICKER_CAP} names for each
 * headline toggle (long-tail, leveraged ETFs, onchain-only) plus every Ostium
 * name, so a single closed day still renders the same top-20 lists. A name
 * outside that set on every day can drop out of a multi-day top 20.
 */

export const PERPS_TICKER_CAP = 48;
/** Funding is stored for names that can reach the 10-row table under any toggle. */
export const PERPS_FUNDING_CAP = 16;

const CATEGORY_ORDER = ["stock", "etf", "leveraged-etf", "index", "preipo"] as const;

const TIER_ORDER: readonly PerpsTier[] = ["onchain", "cex-direct", "cex-coingecko", "long-tail"];

const RANKINGS: readonly { tiers: readonly PerpsTier[]; dropLeveraged: boolean }[] = [
  { tiers: ["onchain", "cex-direct", "cex-coingecko"], dropLeveraged: false },
  { tiers: ["onchain", "cex-direct", "cex-coingecko"], dropLeveraged: true },
  { tiers: ["onchain", "cex-direct", "cex-coingecko", "long-tail"], dropLeveraged: false },
  { tiers: ["onchain", "cex-direct", "cex-coingecko", "long-tail"], dropLeveraged: true },
  { tiers: ["onchain"], dropLeveraged: false },
  { tiers: ["onchain"], dropLeveraged: true },
];

export interface PerpsCompactPart {
  /** Omitted when every market in the bucket left volume unreported. */
  volumeUsd?: number;
  openInterestUsd?: number;
  markets: number;
  /**
   * Sum of volume for markets that reported a funding rate (null volume counts
   * as 0). Omitted when the bucket has no funding rate.
   */
  fundingVolumeUsd?: number;
}

export interface PerpsCompactTierSlot {
  volumeUsd?: number;
  openInterestUsd?: number;
  /** Venues in this tier with a reported volume. Sorted. */
  venues?: string[];
}

export interface PerpsCompactLifetime {
  symbol: string;
  underlying: string;
  category: PerpsStoredCategory;
  lifetimeVolumeUsd: number;
}

export interface PerpsCompactTicker {
  group: string;
  category: PerpsCategory;
  tiers: Partial<Record<PerpsTier, PerpsCompactTierSlot>>;
  /** Volume-weighted funding rate by venue. */
  funding?: Record<string, number>;
}

export interface PerpsCompactVenue {
  venue: string;
  tier: PerpsTier;
  source: string;
  volumeWindow: PerpsVolumeWindow;
  windowNote: string;
  capturedAt: string;
  error: string | null;
  credible: boolean;
  excludeReason: string | null;
  parts: Partial<Record<PerpsStoredCategory, PerpsCompactPart>>;
  /** Ostium symbols. Daily volume is lifetime(today) − lifetime(previous Eastern day). */
  lifetime?: PerpsCompactLifetime[];
}

export interface PerpsCompactDay {
  date: string;
  capturedAt: string;
  venues: PerpsCompactVenue[];
  tickers: PerpsCompactTicker[];
  /** Binance/Bybit official-archive cross-check. Absent on older rows. */
  archive?: PerpsArchiveCheck;
}

export function isCompactDay(row: object): row is PerpsCompactDay {
  return "tickers" in row && Array.isArray((row as { tickers?: unknown }).tickers);
}

interface TierAcc {
  volumes: number[];
  ois: number[];
  venues: Set<string>;
}

interface TickerAcc {
  group: string;
  categories: Map<PerpsCategory, { weight: number; count: number }>;
  tiers: Map<PerpsTier, TierAcc>;
  funding: Map<string, { num: number; den: number; plain: number; n: number }>;
  hasLifetime: boolean;
}

function blankTier(): TierAcc {
  return { volumes: [], ois: [], venues: new Set() };
}

function blankTicker(group: string): TickerAcc {
  return {
    group,
    categories: new Map(),
    tiers: new Map(),
    funding: new Map(),
    hasLifetime: false,
  };
}

function winningCategory(acc: TickerAcc): PerpsCategory {
  let category: PerpsCategory = "stock";
  let bestWeight = -1;
  let bestCount = -1;
  for (const [cat, slot] of acc.categories) {
    if (slot.weight > bestWeight || (slot.weight === bestWeight && slot.count > bestCount)) {
      bestWeight = slot.weight;
      bestCount = slot.count;
      category = cat;
    }
  }
  return category;
}

function tierVolume(acc: TickerAcc, tiers: readonly PerpsTier[]): number | null {
  const values: (number | null)[] = [];
  for (const tier of tiers) {
    const slot = acc.tiers.get(tier);
    if (!slot) continue;
    values.push(sumNullable(slot.volumes));
  }
  return values.length > 0 ? sumNullable(values) : null;
}

function compareTickerRank(a: { group: string; volume: number | null }, b: { group: string; volume: number | null }): number {
  if (a.volume === null && b.volume === null) return a.group.localeCompare(b.group);
  if (a.volume === null) return 1;
  if (b.volume === null) return -1;
  if (a.volume !== b.volume) return b.volume - a.volume;
  return a.group.localeCompare(b.group);
}

function partFromMarkets(markets: readonly PerpsMarketSnapshot[]): PerpsCompactPart | null {
  if (markets.length === 0) return null;
  const volumes: number[] = [];
  const ois: number[] = [];
  let fundingVolume = 0;
  let anyFunding = false;
  for (const market of markets) {
    if (typeof market.volume24hUsd === "number" && Number.isFinite(market.volume24hUsd)) volumes.push(market.volume24hUsd);
    if (typeof market.openInterestUsd === "number" && Number.isFinite(market.openInterestUsd)) ois.push(market.openInterestUsd);
    if (typeof market.fundingRate === "number" && Number.isFinite(market.fundingRate)) {
      anyFunding = true;
      fundingVolume += market.volume24hUsd ?? 0;
    }
  }
  const part: PerpsCompactPart = { markets: markets.length };
  const volumeUsd = sumNullable(volumes);
  const openInterestUsd = sumNullable(ois);
  if (volumeUsd !== null) part.volumeUsd = volumeUsd;
  if (openInterestUsd !== null) part.openInterestUsd = openInterestUsd;
  if (anyFunding) part.fundingVolumeUsd = fundingVolume;
  return part;
}

function compactVenue(venue: PerpsVenueSnapshot): PerpsCompactVenue {
  const grouped = new Map<PerpsStoredCategory, PerpsMarketSnapshot[]>();
  for (const market of venue.markets) {
    const list = grouped.get(market.category) ?? [];
    list.push(market);
    grouped.set(market.category, list);
  }
  const parts: PerpsCompactVenue["parts"] = {};
  for (const category of CATEGORY_ORDER) {
    const part = partFromMarkets(grouped.get(category) ?? []);
    if (part) parts[category] = part;
  }
  const stored: PerpsCompactVenue = {
    venue: venue.venue,
    tier: venue.tier,
    source: venue.source,
    volumeWindow: venue.volumeWindow,
    windowNote: venue.windowNote,
    capturedAt: venue.capturedAt,
    error: venue.error,
    credible: venue.credible !== false,
    excludeReason: venue.excludeReason ?? null,
    parts,
  };
  if (venue.venue === "Ostium") {
    const lifetime: PerpsCompactLifetime[] = [];
    for (const market of venue.markets) {
      if (typeof market.lifetimeVolumeUsd !== "number" || !Number.isFinite(market.lifetimeVolumeUsd)) continue;
      lifetime.push({
        symbol: market.symbol,
        underlying: market.underlying,
        category: market.category,
        lifetimeVolumeUsd: market.lifetimeVolumeUsd,
      });
    }
    lifetime.sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (lifetime.length > 0) stored.lifetime = lifetime;
  }
  return stored;
}

function finishTicker(acc: TickerAcc): PerpsCompactTicker {
  const tiers: PerpsCompactTicker["tiers"] = {};
  for (const tier of TIER_ORDER) {
    const slot = acc.tiers.get(tier);
    if (!slot) continue;
    const stored: PerpsCompactTierSlot = {};
    const volumeUsd = sumNullable(slot.volumes);
    const openInterestUsd = sumNullable(slot.ois);
    if (volumeUsd !== null) stored.volumeUsd = volumeUsd;
    if (openInterestUsd !== null) stored.openInterestUsd = openInterestUsd;
    if (slot.venues.size > 0) stored.venues = [...slot.venues].sort((a, b) => a.localeCompare(b));
    tiers[tier] = stored;
  }
  const funding: Record<string, number> = {};
  for (const venue of [...acc.funding.keys()].sort((a, b) => a.localeCompare(b))) {
    const slot = acc.funding.get(venue);
    if (!slot) continue;
    const rate = slot.den > 0 ? slot.num / slot.den : slot.n > 0 ? slot.plain / slot.n : null;
    if (rate !== null && Number.isFinite(rate)) funding[venue] = rate;
  }
  const ticker: PerpsCompactTicker = {
    group: acc.group,
    category: winningCategory(acc),
    tiers,
  };
  if (Object.keys(funding).length > 0) ticker.funding = funding;
  return ticker;
}

function compactTickers(day: PerpsDaySnapshot): PerpsCompactTicker[] {
  const byGroup = new Map<string, TickerAcc>();
  for (const venue of day.venues) {
    if (venue.credible === false) continue;
    for (const market of venue.markets) {
      if (market.category === "preipo") continue;
      const group = perpGroupLabel(market.underlying);
      const acc = byGroup.get(group) ?? blankTicker(group);
      const cat = acc.categories.get(market.category) ?? { weight: 0, count: 0 };
      cat.count += 1;
      cat.weight += market.volume24hUsd ?? 0;
      acc.categories.set(market.category, cat);
      const tier = acc.tiers.get(venue.tier) ?? blankTier();
      if (typeof market.volume24hUsd === "number" && Number.isFinite(market.volume24hUsd)) {
        tier.volumes.push(market.volume24hUsd);
        tier.venues.add(venue.venue);
      }
      if (typeof market.openInterestUsd === "number" && Number.isFinite(market.openInterestUsd)) {
        tier.ois.push(market.openInterestUsd);
      }
      acc.tiers.set(venue.tier, tier);
      if (typeof market.lifetimeVolumeUsd === "number" && Number.isFinite(market.lifetimeVolumeUsd)) acc.hasLifetime = true;
      if (typeof market.fundingRate === "number" && Number.isFinite(market.fundingRate)) {
        const fund = acc.funding.get(venue.venue) ?? { num: 0, den: 0, plain: 0, n: 0 };
        if (typeof market.volume24hUsd === "number" && Number.isFinite(market.volume24hUsd) && market.volume24hUsd > 0) {
          fund.num += market.fundingRate * market.volume24hUsd;
          fund.den += market.volume24hUsd;
        } else {
          fund.plain += market.fundingRate;
          fund.n += 1;
        }
        acc.funding.set(venue.venue, fund);
      }
      byGroup.set(group, acc);
    }
  }

  const keep = new Set<string>();
  for (const ranking of RANKINGS) {
    const ranked = [...byGroup.values()]
      .filter((acc) => acc.categories.size > 0)
      .filter((acc) => !(ranking.dropLeveraged && winningCategory(acc) === "leveraged-etf"))
      .map((acc) => ({ group: acc.group, volume: tierVolume(acc, ranking.tiers) }))
      .sort(compareTickerRank)
      .slice(0, PERPS_TICKER_CAP);
    for (const row of ranked) keep.add(row.group);
  }
  for (const acc of byGroup.values()) {
    if (acc.hasLifetime) keep.add(acc.group);
  }

  return [...byGroup.values()]
    .filter((acc) => keep.has(acc.group) && acc.categories.size > 0)
    .map(finishTicker)
    .sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));
}

export function compactPerpsDay(day: PerpsDaySnapshot): PerpsCompactDay {
  const compact: PerpsCompactDay = {
    date: day.date,
    capturedAt: day.capturedAt,
    venues: day.venues.map(compactVenue),
    tickers: compactTickers(day),
  };
  if (day.archive) compact.archive = day.archive;
  return compact;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parsePart(value: unknown): PerpsCompactPart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const markets = finite(row.markets);
  if (markets === undefined || markets < 0 || !Number.isInteger(markets)) return null;
  const part: PerpsCompactPart = { markets };
  const volumeUsd = finite(row.volumeUsd);
  const openInterestUsd = finite(row.openInterestUsd);
  const fundingVolumeUsd = finite(row.fundingVolumeUsd);
  if (volumeUsd !== undefined) part.volumeUsd = volumeUsd;
  if (openInterestUsd !== undefined) part.openInterestUsd = openInterestUsd;
  if (fundingVolumeUsd !== undefined) part.fundingVolumeUsd = fundingVolumeUsd;
  return part;
}

function parseTicker(value: unknown): PerpsCompactTicker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const group = typeof row.group === "string" ? row.group : "";
  const category = row.category;
  if (!group || category === "preipo" || (category !== "stock" && category !== "etf" && category !== "leveraged-etf" && category !== "index")) {
    return null;
  }
  const tiers: PerpsCompactTicker["tiers"] = {};
  const rawTiers = row.tiers;
  if (rawTiers && typeof rawTiers === "object" && !Array.isArray(rawTiers)) {
    for (const tier of TIER_ORDER) {
      const slot = (rawTiers as Record<string, unknown>)[tier];
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) continue;
      const source = slot as Record<string, unknown>;
      const stored: PerpsCompactTierSlot = {};
      const volumeUsd = finite(source.volumeUsd);
      const openInterestUsd = finite(source.openInterestUsd);
      if (volumeUsd !== undefined) stored.volumeUsd = volumeUsd;
      if (openInterestUsd !== undefined) stored.openInterestUsd = openInterestUsd;
      if (Array.isArray(source.venues)) {
        const venues = source.venues.filter((name): name is string => typeof name === "string" && name.length > 0);
        if (venues.length > 0) stored.venues = [...new Set(venues)].sort((a, b) => a.localeCompare(b));
      }
      tiers[tier] = stored;
    }
  }
  const ticker: PerpsCompactTicker = { group, category, tiers };
  if (row.funding && typeof row.funding === "object" && !Array.isArray(row.funding)) {
    const funding: Record<string, number> = {};
    for (const [venue, rate] of Object.entries(row.funding as Record<string, unknown>)) {
      const parsed = finite(rate);
      if (parsed !== undefined) funding[venue] = parsed;
    }
    if (Object.keys(funding).length > 0) ticker.funding = funding;
  }
  return ticker;
}

function parseLifetime(value: unknown): PerpsCompactLifetime | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const symbol = typeof row.symbol === "string" ? row.symbol : "";
  const underlying = typeof row.underlying === "string" ? row.underlying : "";
  const category = row.category;
  const lifetimeVolumeUsd = finite(row.lifetimeVolumeUsd);
  if (!symbol || !underlying || lifetimeVolumeUsd === undefined) return null;
  if (category !== "stock" && category !== "etf" && category !== "leveraged-etf" && category !== "index" && category !== "preipo") {
    return null;
  }
  return { symbol, underlying, category, lifetimeVolumeUsd };
}

export function parseCompactVenue(value: unknown): PerpsCompactVenue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const venue = typeof row.venue === "string" ? row.venue : "";
  const tier = row.tier;
  const volumeWindow = row.volumeWindow;
  if (!venue) return null;
  if (tier !== "onchain" && tier !== "cex-direct" && tier !== "cex-coingecko" && tier !== "long-tail") return null;
  if (volumeWindow !== "rolling-24h" && volumeWindow !== "et-day" && volumeWindow !== "lifetime" && volumeWindow !== "unavailable") {
    return null;
  }
  const parts: PerpsCompactVenue["parts"] = {};
  const rawParts = row.parts;
  if (rawParts && typeof rawParts === "object" && !Array.isArray(rawParts)) {
    for (const category of CATEGORY_ORDER) {
      const part = parsePart((rawParts as Record<string, unknown>)[category]);
      if (part) parts[category] = part;
    }
  }
  const stored: PerpsCompactVenue = {
    venue,
    tier,
    source: typeof row.source === "string" ? row.source : "",
    volumeWindow,
    windowNote: typeof row.windowNote === "string" ? row.windowNote : "",
    capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : "",
    error: typeof row.error === "string" && row.error ? row.error : null,
    credible: typeof row.credible === "boolean" ? row.credible : true,
    excludeReason: typeof row.excludeReason === "string" && row.excludeReason ? row.excludeReason : null,
    parts,
  };
  if (Array.isArray(row.lifetime)) {
    const lifetime = row.lifetime
      .map(parseLifetime)
      .filter((item): item is PerpsCompactLifetime => item !== null)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (lifetime.length > 0) stored.lifetime = lifetime;
  }
  return stored;
}

const TIER_CODE: Record<PerpsTier, string> = {
  onchain: "o",
  "cex-direct": "d",
  "cex-coingecko": "g",
  "long-tail": "l",
};
const CODE_TIER: Record<string, PerpsTier> = {
  o: "onchain",
  d: "cex-direct",
  g: "cex-coingecko",
  l: "long-tail",
};
const CATEGORY_CODE: Record<PerpsStoredCategory, string> = {
  stock: "s",
  etf: "e",
  "leveraged-etf": "l",
  index: "i",
  preipo: "p",
};
const CODE_CATEGORY: Record<string, PerpsStoredCategory> = {
  s: "stock",
  e: "etf",
  l: "leveraged-etf",
  i: "index",
  p: "preipo",
};

function numOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fundingGroups(tickers: readonly PerpsCompactTicker[]): Set<string> {
  const keep = new Set<string>();
  for (const ranking of RANKINGS) {
    const ranked = tickers
      .filter((ticker) => !(ranking.dropLeveraged && ticker.category === "leveraged-etf"))
      .map((ticker) => ({
        group: ticker.group,
        volume: sumNullable(ranking.tiers.map((tier) => ticker.tiers[tier]?.volumeUsd ?? null)),
      }))
      .sort(compareTickerRank)
      .slice(0, PERPS_FUNDING_CAP);
    for (const row of ranked) keep.add(row.group);
  }
  return keep;
}

function encodePart(part: PerpsCompactPart): [number | null, number | null, number, number | null] | [number | null, number | null, number] {
  const volume = numOrNull(part.volumeUsd);
  const oi = numOrNull(part.openInterestUsd);
  if (part.fundingVolumeUsd === undefined) return [volume, oi, part.markets];
  return [volume, oi, part.markets, part.fundingVolumeUsd];
}

/** Dense on-disk day. Venue names in ticker rows are indexes into `venues`. */
export function encodeCompactDay(day: PerpsCompactDay): {
  date: string;
  capturedAt: string;
  venues: unknown[];
  tickers: unknown[];
  arc?: unknown[];
  arcNote?: string;
} {
  const venueIndex = new Map(day.venues.map((venue, index) => [venue.venue, index]));
  const funded = fundingGroups(day.tickers);
  const venues = day.venues.map((venue) => {
    const parts: Record<string, unknown> = {};
    for (const category of CATEGORY_ORDER) {
      const part = venue.parts[category];
      if (!part) continue;
      parts[CATEGORY_CODE[category]] = encodePart(part);
    }
    const wire: Record<string, unknown> = {
      venue: venue.venue,
      tier: venue.tier,
      source: venue.source,
      volumeWindow: venue.volumeWindow,
      windowNote: venue.windowNote,
      parts,
    };
    if (venue.capturedAt && venue.capturedAt !== day.capturedAt) wire.capturedAt = venue.capturedAt;
    if (venue.error) wire.error = venue.error;
    if (!venue.credible) wire.credible = false;
    if (venue.excludeReason) wire.excludeReason = venue.excludeReason;
    if (venue.lifetime && venue.lifetime.length > 0) {
      wire.lifetime = venue.lifetime.map((row) => [row.symbol, row.underlying, CATEGORY_CODE[row.category], row.lifetimeVolumeUsd]);
    }
    return wire;
  });
  const tickers = day.tickers.map((ticker) => {
    const tiers: Record<string, unknown> = {};
    for (const tier of TIER_ORDER) {
      const slot = ticker.tiers[tier];
      if (!slot) continue;
      const indexes = (slot.venues ?? [])
        .map((name) => venueIndex.get(name))
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b);
      tiers[TIER_CODE[tier]] = [numOrNull(slot.volumeUsd), numOrNull(slot.openInterestUsd), indexes];
    }
    const wire: unknown[] = [ticker.group, CATEGORY_CODE[ticker.category], tiers];
    if (ticker.funding && funded.has(ticker.group)) {
      const pairs = Object.entries(ticker.funding)
        .map(([name, rate]) => [venueIndex.get(name), rate] as const)
        .filter((pair): pair is readonly [number, number] => pair[0] !== undefined)
        .sort((a, b) => a[0] - b[0]);
      if (pairs.length > 0) wire.push(pairs);
    }
    return wire;
  });
  const encoded: {
    date: string;
    capturedAt: string;
    venues: unknown[];
    tickers: unknown[];
    arc?: unknown[];
    arcNote?: string;
  } = { date: day.date, capturedAt: day.capturedAt, venues, tickers };
  if (day.archive) {
    const archive = encodePerpsArchive(day.archive);
    encoded.arc = archive.arc;
    if (archive.arcNote) encoded.arcNote = archive.arcNote;
  }
  return encoded;
}

function decodePart(value: unknown): PerpsCompactPart | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const markets = finite(value[2]);
  if (markets === undefined || markets < 0 || !Number.isInteger(markets)) return null;
  const part: PerpsCompactPart = { markets };
  const volumeUsd = finite(value[0]);
  const openInterestUsd = finite(value[1]);
  const fundingVolumeUsd = finite(value[3]);
  if (volumeUsd !== undefined) part.volumeUsd = volumeUsd;
  if (openInterestUsd !== undefined) part.openInterestUsd = openInterestUsd;
  if (value.length > 3 && fundingVolumeUsd !== undefined) part.fundingVolumeUsd = fundingVolumeUsd;
  return part;
}

function decodeWireDay(row: {
  date: string;
  capturedAt?: unknown;
  venues?: unknown;
  tickers?: unknown;
  arc?: unknown;
  arcNote?: unknown;
}): PerpsCompactDay | null {
  const capturedAt = typeof row.capturedAt === "string" ? row.capturedAt : "";
  const venues: PerpsCompactVenue[] = [];
  if (Array.isArray(row.venues)) {
    for (const value of row.venues) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const source = value as Record<string, unknown>;
      const venue = typeof source.venue === "string" ? source.venue : "";
      const tier = source.tier;
      const volumeWindow = source.volumeWindow;
      if (!venue) continue;
      if (tier !== "onchain" && tier !== "cex-direct" && tier !== "cex-coingecko" && tier !== "long-tail") continue;
      if (volumeWindow !== "rolling-24h" && volumeWindow !== "et-day" && volumeWindow !== "lifetime" && volumeWindow !== "unavailable") {
        continue;
      }
      const parts: PerpsCompactVenue["parts"] = {};
      const rawParts = source.parts;
      if (rawParts && typeof rawParts === "object" && !Array.isArray(rawParts)) {
        for (const [code, part] of Object.entries(rawParts as Record<string, unknown>)) {
          const category = CODE_CATEGORY[code];
          const parsed = decodePart(part);
          if (category && parsed) parts[category] = parsed;
        }
      }
      const stored: PerpsCompactVenue = {
        venue,
        tier,
        source: typeof source.source === "string" ? source.source : "",
        volumeWindow,
        windowNote: typeof source.windowNote === "string" ? source.windowNote : "",
        capturedAt: typeof source.capturedAt === "string" ? source.capturedAt : capturedAt,
        error: typeof source.error === "string" && source.error ? source.error : null,
        credible: source.credible !== false,
        excludeReason: typeof source.excludeReason === "string" && source.excludeReason ? source.excludeReason : null,
        parts,
      };
      if (Array.isArray(source.lifetime)) {
        const lifetime: PerpsCompactLifetime[] = [];
        for (const item of source.lifetime) {
          if (!Array.isArray(item) || item.length < 4) continue;
          const category = CODE_CATEGORY[String(item[2])];
          const lifetimeVolumeUsd = finite(item[3]);
          if (typeof item[0] !== "string" || typeof item[1] !== "string" || !category || lifetimeVolumeUsd === undefined) continue;
          lifetime.push({ symbol: item[0], underlying: item[1], category, lifetimeVolumeUsd });
        }
        if (lifetime.length > 0) stored.lifetime = lifetime.sort((a, b) => a.symbol.localeCompare(b.symbol));
      }
      venues.push(stored);
    }
  }
  const tickers: PerpsCompactTicker[] = [];
  if (Array.isArray(row.tickers)) {
    for (const value of row.tickers) {
      if (!Array.isArray(value) || value.length < 3) continue;
      const group = typeof value[0] === "string" ? value[0] : "";
      const category = CODE_CATEGORY[String(value[1])];
      if (!group || !category || category === "preipo") continue;
      const tiers: PerpsCompactTicker["tiers"] = {};
      const rawTiers = value[2];
      if (rawTiers && typeof rawTiers === "object" && !Array.isArray(rawTiers)) {
        for (const [code, slot] of Object.entries(rawTiers as Record<string, unknown>)) {
          const tier = CODE_TIER[code];
          if (!tier || !Array.isArray(slot)) continue;
          const stored: PerpsCompactTierSlot = {};
          const volumeUsd = finite(slot[0]);
          const openInterestUsd = finite(slot[1]);
          if (volumeUsd !== undefined) stored.volumeUsd = volumeUsd;
          if (openInterestUsd !== undefined) stored.openInterestUsd = openInterestUsd;
          if (Array.isArray(slot[2])) {
            const names = slot[2]
              .map((index) => (typeof index === "number" ? venues[index]?.venue : undefined))
              .filter((name): name is string => Boolean(name));
            if (names.length > 0) stored.venues = [...new Set(names)].sort((a, b) => a.localeCompare(b));
          }
          tiers[tier] = stored;
        }
      }
      const ticker: PerpsCompactTicker = { group, category, tiers };
      if (Array.isArray(value[3])) {
        const funding: Record<string, number> = {};
        for (const pair of value[3]) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const name = typeof pair[0] === "number" ? venues[pair[0]]?.venue : undefined;
          const rate = finite(pair[1]);
          if (name && rate !== undefined) funding[name] = rate;
        }
        if (Object.keys(funding).length > 0) ticker.funding = funding;
      }
      tickers.push(ticker);
    }
  }
  tickers.sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));
  const decoded: PerpsCompactDay = { date: row.date, capturedAt, venues, tickers };
  const archive = decodePerpsArchive(row.arc, row.arcNote);
  if (archive) decoded.archive = archive;
  return decoded;
}

function isWireDay(row: { venues?: unknown; tickers?: unknown; arc?: unknown }): boolean {
  if (Array.isArray(row.arc)) return true;
  if (Array.isArray(row.tickers) && row.tickers.some((ticker) => Array.isArray(ticker))) return true;
  if (!Array.isArray(row.venues)) return false;
  return row.venues.some((venue) => {
    if (!venue || typeof venue !== "object" || Array.isArray(venue)) return false;
    const parts = (venue as { parts?: unknown }).parts;
    if (!parts || typeof parts !== "object" || Array.isArray(parts)) return false;
    return Object.values(parts as Record<string, unknown>).some((part) => Array.isArray(part));
  });
}

export function parseCompactDay(row: {
  date: string;
  capturedAt?: unknown;
  venues?: unknown;
  tickers?: unknown;
  arc?: unknown;
  arcNote?: unknown;
}): PerpsCompactDay | null {
  if (isWireDay(row)) return decodeWireDay(row);
  const venues = Array.isArray(row.venues)
    ? row.venues.map(parseCompactVenue).filter((venue): venue is PerpsCompactVenue => venue !== null)
    : [];
  const tickers = Array.isArray(row.tickers)
    ? row.tickers.map(parseTicker).filter((ticker): ticker is PerpsCompactTicker => ticker !== null)
    : [];
  tickers.sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));
  return {
    date: row.date,
    capturedAt: typeof row.capturedAt === "string" ? row.capturedAt : "",
    venues,
    tickers,
  };
}
