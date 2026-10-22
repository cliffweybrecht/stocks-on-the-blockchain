import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { laneLookupFromSnapshot } from "./asset-backfill-desk";
import { withDerivedSnapshotDays } from "./asset-backfill-desk-file";
import { bnbIssuerPresentation, BNB_DESK } from "./bnb-desk-volume";
import { BNB_MARKETS_SOURCE_LABEL } from "./bnb-markets";
import type { VolumeChartRangeId } from "./daily-volume-view";
import {
  assetsMatchingListView,
  displayedIssuerFacets,
  displayedLaneCount,
} from "../desk/displayed-list-counts";
import type { IssuerFilter } from "../desk/issuer-filter";
import { GECKO_HOURLY_ET_BACKFILL_SOURCE } from "./gecko-hourly-et";
import {
  equityCardRangeAddressKey,
  equityCardRangeTotal,
  type EquityCardRangeVolumeMap,
} from "./equity-card-range-volume";
import { asNonNegativeNumber, sumNullable } from "./numbers";
import {
  closedSnapshotDeskDays,
  parseSnapshotDeskDays,
  snapshotDeskChainShell,
  snapshotDeskDaysForRange,
  type SnapshotDeskDay,
} from "./snapshot-desk-volume";
import {
  BNB_CHAIN_ID,
  type AssetDetail,
  type AssetDetailResult,
  type AssetPoolMark,
  type AssetSummary,
  type DataProvenance,
  type InstrumentKind,
} from "./types";
import type { CoverageFilter } from "./volume-coverage";
import { inferVolumeCoverage } from "./volume-coverage";
import { DEFAULT_VOLUME_SNAPSHOT_DIR, easternDayKey } from "./volume-snapshots";

/**
 * BNB Chain cards, issuer chips, and lane counts.
 * The live issuer registries are not the list: a registry miss was hiding
 * bStocks, Four.meme, and Paimon, and was filing SPCX as private. Each card
 * uses the lane and issuer stored on `bnb.json` assets[] for the chart window.
 * A missing name or logo stays missing. Null volume stays null.
 */
const RANGE_IDS = ["24h", "7d", "14d", "30d"] as const;

export interface BnbSnapshotCardLanes {
  assets: AssetSummary[];
  etfAssets: AssetSummary[];
  privateAssets: AssetSummary[];
}

export interface BnbSnapshotCardCatalog {
  ranges: Record<VolumeChartRangeId, BnbSnapshotCardLanes>;
  /** Every card that appears in at least one desk window. */
  union: BnbSnapshotCardLanes;
  /** Closed-day identities, including days outside the 30D window, for token pages. */
  details: AssetDetail[];
}

export interface BnbDeskRangeView {
  addresses: readonly string[];
  equityCount: number;
  etfCount: number;
  privateCount: number;
  issuerFacets: ReturnType<typeof displayedIssuerFacets>["issuers"];
  unknownIssuerCount: number;
}

interface NightlyAsset {
  address: string;
  symbol: string;
  name: string | null;
  issuerSlug: string | null;
  lane: InstrumentKind;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  priceUsd: number | null;
  hasPrice: boolean;
  pools: AssetPoolMark[];
}

interface CardIdentity {
  address: string;
  symbol: string;
  name: string;
  issuerLabel: string | null;
  lane: InstrumentKind;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  priceUsd: number | null;
  pools: AssetPoolMark[];
  dates: Set<string>;
}

const EMPTY_LANES: BnbSnapshotCardLanes = { assets: [], etfAssets: [], privateAssets: [] };

function emptyCatalog(): BnbSnapshotCardCatalog {
  return {
    ranges: { "24h": EMPTY_LANES, "7d": EMPTY_LANES, "14d": EMPTY_LANES, "30d": EMPTY_LANES },
    union: EMPTY_LANES,
    details: [],
  };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function laneOf(value: unknown): InstrumentKind {
  if (value === "etf") return "etf";
  if (value === "private" || value === "preipo") return "private";
  return "equity";
}

/** Chart days for this desk: nightly `bnb.json` rows plus backfill days the file does not already have. */
export function bnbSnapshotChartDays(payload: unknown, nowT: number, backfill: unknown): SnapshotDeskDay[] {
  const nightly = closedSnapshotDeskDays(parseSnapshotDeskDays(payload, BNB_DESK), nowT);
  return withDerivedSnapshotDays(nightly, payload, backfill);
}

/**
 * Backfill rows on a night `bnb.json` already recorded.
 * The chart keeps that night's lane totals, so card windows must not add a second copy.
 * Days the nightly file skipped stay, and the chart sums those.
 */
export function bnbBackfillWithoutNightlyDates(snapshot: unknown, backfill: unknown): unknown {
  if (!backfill || typeof backfill !== "object") return backfill ?? null;
  const file = backfill as { source?: unknown; records?: unknown };
  if (file.source !== GECKO_HOURLY_ET_BACKFILL_SOURCE || !Array.isArray(file.records)) return backfill;
  const nightly = new Set(parseSnapshotDeskDays(snapshot, BNB_DESK).map((day) => day.date));
  return {
    ...file,
    records: file.records.filter((row) => {
      if (!row || typeof row !== "object") return false;
      const date = (row as { date?: unknown }).date;
      return typeof date === "string" && !nightly.has(date);
    }),
  };
}

function readPools(value: unknown, tokenAddress: string, symbol: string): AssetPoolMark[] {
  if (!Array.isArray(value)) return [];
  const pools: AssetPoolMark[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const pairAddress = typeof row.pairAddress === "string" ? row.pairAddress.trim() : "";
    if (!pairAddress) continue;
    const dexId = typeof row.dexId === "string" && row.dexId.trim() ? row.dexId.trim() : "unknown";
    pools.push({
      pairAddress,
      dexId,
      volume24hUsd: asNonNegativeNumber(row.volume24hUsd),
      liquidityUsd: asNonNegativeNumber(row.liquidityUsd),
      priceUsd: asNonNegativeNumber(row.priceUsd),
      baseSymbol: symbol || null,
      baseAddress: tokenAddress,
    });
  }
  return pools;
}

function readNightlyAsset(raw: unknown): NightlyAsset | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const address = typeof row.address === "string" ? row.address.trim() : "";
  if (!address) return null;
  const symbol = typeof row.symbol === "string" ? row.symbol.trim() : "";
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
  const issuerSlug = typeof row.issuer === "string" && row.issuer.trim() ? row.issuer.trim().toLowerCase() : null;
  return {
    address,
    symbol,
    name,
    issuerSlug,
    lane: laneOf(row.instrumentKind),
    volume24hUsd: asNonNegativeNumber(row.volume24hUsd),
    displayedLiquidityUsd: hasOwn(row, "displayedLiquidityUsd") ? asNonNegativeNumber(row.displayedLiquidityUsd) : null,
    priceUsd: hasOwn(row, "priceUsd") ? asNonNegativeNumber(row.priceUsd) : null,
    hasPrice: hasOwn(row, "priceUsd"),
    pools: readPools(row.pools, address, symbol),
  };
}

/** Last nightly record for each date. Same winner `parseSnapshotDeskDays` keeps. */
function nightlyAssetsByDate(payload: unknown): Map<string, NightlyAsset[]> {
  const byDate = new Map<string, NightlyAsset[]>();
  if (!payload || typeof payload !== "object") return byDate;
  const list = (payload as { records?: unknown }).records;
  if (!Array.isArray(list)) return byDate;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    if (typeof rec.hour === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(rec.hour)) continue;
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    if (!date || !Array.isArray(rec.assets)) continue;
    const assets: NightlyAsset[] = [];
    for (const asset of rec.assets) {
      const parsed = readNightlyAsset(asset);
      if (parsed) assets.push(parsed);
    }
    byDate.set(date, assets);
  }
  return byDate;
}

interface DerivedAsset {
  address: string;
  symbol: string;
  volumeUsd: number;
}

/** Derived-day rows the card volume map counts. A nightly date is not read here. */
function derivedAssetsByDate(backfill: unknown): Map<string, DerivedAsset[]> {
  const byDate = new Map<string, DerivedAsset[]>();
  if (!backfill || typeof backfill !== "object") return byDate;
  const file = backfill as { source?: unknown; records?: unknown };
  if (file.source !== GECKO_HOURLY_ET_BACKFILL_SOURCE || !Array.isArray(file.records)) return byDate;
  for (const raw of file.records) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as { date?: unknown; assets?: unknown };
    const date = typeof rec.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rec.date) ? rec.date : "";
    if (!date || !Array.isArray(rec.assets)) continue;
    const assets: DerivedAsset[] = [];
    for (const asset of rec.assets) {
      if (!asset || typeof asset !== "object") continue;
      const row = asset as { address?: unknown; symbol?: unknown; volume24hUsd?: unknown; source?: unknown };
      if (row.source !== GECKO_HOURLY_ET_BACKFILL_SOURCE) continue;
      const address = typeof row.address === "string" ? row.address.trim() : "";
      if (!address) continue;
      const volumeUsd = asNonNegativeNumber(row.volume24hUsd);
      if (volumeUsd === null) continue;
      assets.push({
        address,
        symbol: typeof row.symbol === "string" ? row.symbol.trim() : "",
        volumeUsd,
      });
    }
    if (assets.length > 0) byDate.set(date, assets);
  }
  return byDate;
}

function touchIdentity(map: Map<string, CardIdentity>, input: {
  address: string;
  symbol: string;
  name: string | null;
  issuerSlug: string | null;
  lane: InstrumentKind;
  date: string;
  lastDate: string;
  volume24hUsd: number | null;
  displayedLiquidityUsd?: number | null;
  priceUsd?: number | null;
  hasPrice?: boolean;
  pools?: AssetPoolMark[];
}): CardIdentity {
  const key = equityCardRangeAddressKey(input.address);
  const existing = map.get(key);
  const identity: CardIdentity = existing ?? {
    address: input.address,
    symbol: input.symbol || input.address,
    name: input.name || input.symbol || input.address,
    issuerLabel: null,
    lane: input.lane,
    volume24hUsd: null,
    displayedLiquidityUsd: null,
    priceUsd: null,
    pools: [],
    dates: new Set<string>(),
  };
  identity.address = input.address || identity.address;
  if (input.symbol) identity.symbol = input.symbol;
  if (input.name) identity.name = input.name;
  else if (!identity.name) identity.name = identity.symbol;
  if (input.issuerSlug) identity.issuerLabel = bnbIssuerPresentation(input.issuerSlug).label;
  identity.lane = input.lane;
  if (input.pools) identity.pools = input.pools;
  if (input.hasPrice) identity.priceUsd = input.priceUsd ?? null;
  if (input.displayedLiquidityUsd !== undefined) identity.displayedLiquidityUsd = input.displayedLiquidityUsd;
  if (input.date === input.lastDate) identity.volume24hUsd = input.volume24hUsd;
  identity.dates.add(input.date);
  map.set(key, identity);
  return identity;
}

function toSummary(identity: CardIdentity): AssetSummary {
  const poolCount = identity.pools.length;
  const name = identity.name.trim() || identity.symbol;
  return {
    chainId: BNB_CHAIN_ID,
    sourceId: "bnb",
    sourceLabel: BNB_MARKETS_SOURCE_LABEL,
    symbol: identity.symbol,
    name,
    contractAddress: identity.address,
    issuer: identity.issuerLabel,
    logoUrl: null,
    volume24hUsd: identity.volume24hUsd,
    displayedLiquidityUsd: identity.displayedLiquidityUsd,
    usdGLiquidityUsd: null,
    poolCount,
    dexCount: new Set(identity.pools.map((pool) => pool.dexId)).size,
    pools: identity.pools,
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: identity.priceUsd,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: identity.displayedLiquidityUsd !== null,
    volume24hCoverageComplete: identity.volume24hUsd !== null,
    instrumentKind: identity.lane,
    volumeCoverage: inferVolumeCoverage({
      volume24hUsd: identity.volume24hUsd,
      poolCount,
    }),
    coverageNote: null,
    priceChange24hPct: null,
  };
}

function toDetail(summary: AssetSummary): AssetDetail {
  return {
    ...summary,
    buys24h: null,
    sells24h: null,
    largestPool: null,
    concentration: { top1Pct: null, top3Pct: null, top5Pct: null },
    dexes: [],
    quoteAssets: [],
    price: {
      robinhoodReferenceUsd: null,
      robinhoodBidUsd: null,
      robinhoodAskUsd: null,
      robinhoodGeneratedAt: null,
      isTradingHalt: null,
      dexMedianUsd: summary.dexMedianPriceUsd,
      dexLiquidityWeightedUsd: null,
      dexLargestPoolUsd: summary.dexMedianPriceUsd,
      premiumDiscountPct: null,
      priceDispersionPct: null,
      priceCoverageComplete: summary.dexMedianPriceUsd !== null,
    },
    detailEnriched: false,
    marketCapUsd: null,
    fdvUsd: null,
    holderCount: null,
    circulatingSupply: null,
    totalSupply: null,
  };
}

function lanesFrom(cards: readonly AssetSummary[]): BnbSnapshotCardLanes {
  return {
    assets: cards.filter((card) => card.instrumentKind === "equity"),
    etfAssets: cards.filter((card) => card.instrumentKind === "etf"),
    privateAssets: cards.filter((card) => card.instrumentKind === "private"),
  };
}

/**
 * Cards for each desk window. Lane and issuer are the ones stored on that asset's newest
 * row inside the days the chart plots. Backfill-only days use the same lane lookup as the chart.
 */
export function buildBnbSnapshotCardCatalog(
  payload: unknown,
  nowT: number,
  backfill: unknown = null,
): BnbSnapshotCardCatalog {
  const chartDays = bnbSnapshotChartDays(payload, nowT, backfill);
  if (chartDays.length === 0) return emptyCatalog();
  const lastDate = chartDays[chartDays.length - 1]?.date ?? "";
  const nightly = nightlyAssetsByDate(payload);
  const derived = derivedAssetsByDate(backfill);
  const laneOfAddress = laneLookupFromSnapshot(payload);
  const identities = new Map<string, CardIdentity>();

  for (const day of chartDays) {
    if (day.source === "asset-backfill") {
      for (const asset of derived.get(day.date) ?? []) {
        touchIdentity(identities, {
          address: asset.address,
          symbol: asset.symbol,
          name: null,
          issuerSlug: null,
          lane: laneOfAddress(asset.address, asset.symbol),
          date: day.date,
          lastDate,
          volume24hUsd: asset.volumeUsd,
        });
      }
      continue;
    }
    for (const asset of nightly.get(day.date) ?? []) {
      touchIdentity(identities, {
        address: asset.address,
        symbol: asset.symbol,
        name: asset.name,
        issuerSlug: asset.issuerSlug,
        lane: asset.lane,
        date: day.date,
        lastDate,
        volume24hUsd: asset.volume24hUsd,
        displayedLiquidityUsd: asset.displayedLiquidityUsd,
        priceUsd: asset.priceUsd,
        hasPrice: asset.hasPrice,
        pools: asset.pools,
      });
    }
  }

  const summaries = new Map<string, AssetSummary>();
  for (const [key, identity] of identities) summaries.set(key, toSummary(identity));

  const ranges = {} as Record<VolumeChartRangeId, BnbSnapshotCardLanes>;
  for (const range of RANGE_IDS) {
    const dates = new Set(snapshotDeskDaysForRange(chartDays, range).map((day) => day.date));
    const cards: AssetSummary[] = [];
    for (const [key, identity] of identities) {
      let listed = false;
      for (const date of identity.dates) {
        if (dates.has(date)) {
          listed = true;
          break;
        }
      }
      if (!listed) continue;
      const card = summaries.get(key);
      if (card) cards.push(card);
    }
    ranges[range] = lanesFrom(cards);
  }

  const unionCards: AssetSummary[] = [];
  const seen = new Set<string>();
  for (const range of RANGE_IDS) {
    for (const card of [...ranges[range].assets, ...ranges[range].etfAssets, ...ranges[range].privateAssets]) {
      const key = equityCardRangeAddressKey(card.contractAddress);
      if (seen.has(key)) continue;
      seen.add(key);
      unionCards.push(card);
    }
  }

  return {
    ranges,
    union: lanesFrom(unionCards),
    details: [...summaries.values()].map(toDetail),
  };
}

/** Sum of card headlines for one window. Null headlines are omitted, not added as $0. */
export function sumBnbSnapshotCardLanes(
  lanes: BnbSnapshotCardLanes,
  volumes: EquityCardRangeVolumeMap,
  range: VolumeChartRangeId,
): { equity: number | null; etf: number | null; private: number | null } {
  const leg = (cards: readonly AssetSummary[]) =>
    sumNullable(
      cards.map((card) =>
        range === "24h" ? card.volume24hUsd : (equityCardRangeTotal(volumes, card.contractAddress, range)?.volumeUsd ?? null),
      ),
    );
  return { equity: leg(lanes.assets), etf: leg(lanes.etfAssets), private: leg(lanes.privateAssets) };
}

export function sumBnbSnapshotChartLanes(days: readonly SnapshotDeskDay[]): {
  equity: number | null;
  etf: number | null;
  private: number | null;
} {
  return {
    equity: sumNullable(days.map((day) => day.publicEquity24hUsd)),
    etf: sumNullable(days.map((day) => day.etfIndex24hUsd)),
    private: sumNullable(days.map((day) => day.private24hUsd)),
  };
}

/** Lane chips and issuer chips for the selected window, after the page's coverage and issuer filters. */
export function bnbDeskRangeViews(
  catalog: BnbSnapshotCardCatalog,
  lane: InstrumentKind,
  coverage: CoverageFilter,
  issuer: IssuerFilter,
): Record<VolumeChartRangeId, BnbDeskRangeView> {
  const views = {} as Record<VolumeChartRangeId, BnbDeskRangeView>;
  for (const range of RANGE_IDS) {
    const lanes = catalog.ranges[range];
    const current = lane === "etf" ? lanes.etfAssets : lane === "private" ? lanes.privateAssets : lanes.assets;
    const facets = displayedIssuerFacets(current, coverage);
    views[range] = {
      addresses: assetsMatchingListView(current, coverage, issuer).map((asset) => asset.contractAddress),
      equityCount: displayedLaneCount(lanes.assets, coverage, issuer),
      etfCount: displayedLaneCount(lanes.etfAssets, coverage, issuer),
      privateCount: displayedLaneCount(lanes.privateAssets, coverage, issuer),
      issuerFacets: facets.issuers,
      unknownIssuerCount: facets.unknownCount,
    };
  }
  return views;
}

export function findBnbSnapshotDetail(details: readonly AssetDetail[], key: string): AssetDetail | undefined {
  const needle = key.trim().toLowerCase();
  if (!needle) return undefined;
  const byAddress = details.find((row) => row.contractAddress.toLowerCase() === needle);
  if (byAddress) return byAddress;
  const bySymbol = details.filter((row) => row.symbol.toLowerCase() === needle);
  return bySymbol.length === 1 ? bySymbol[0] : undefined;
}

/**
 * Keep the snapshot lane and issuer. A live registry name and logo fill in when the
 * snapshot did not store them. Live pools and prices win when that request returned some.
 */
export function overlayBnbSnapshotIdentity(stored: AssetDetail, live: AssetDetail): AssetDetail {
  const storedName = stored.name.trim();
  const liveName = live.name.trim();
  const name =
    storedName && storedName !== stored.symbol.trim() ? storedName : liveName || storedName || stored.symbol;
  const pools = live.pools.length > 0 ? live.pools : stored.pools;
  const dexMedianPriceUsd = live.dexMedianPriceUsd ?? stored.dexMedianPriceUsd;
  return {
    ...live,
    symbol: stored.symbol || live.symbol,
    name,
    issuer: stored.issuer ?? live.issuer,
    instrumentKind: stored.instrumentKind,
    logoUrl: live.logoUrl ?? stored.logoUrl,
    contractAddress: stored.contractAddress || live.contractAddress,
    pools,
    poolCount: live.pools.length > 0 ? live.poolCount : stored.poolCount,
    volume24hUsd: live.volume24hUsd ?? stored.volume24hUsd,
    displayedLiquidityUsd: live.displayedLiquidityUsd ?? stored.displayedLiquidityUsd,
    dexMedianPriceUsd,
    priceChange24hPct: live.priceChange24hPct ?? stored.priceChange24hPct,
    price: {
      ...live.price,
      dexMedianUsd: live.price.dexMedianUsd ?? dexMedianPriceUsd,
      dexLargestPoolUsd: live.price.dexLargestPoolUsd ?? dexMedianPriceUsd,
    },
  };
}

function snapshotProvenance(generatedAt: string | null): DataProvenance {
  const fetchedAt = new Date().toISOString();
  return {
    sourceId: "bnb",
    sourceLabel: BNB_DESK.sourceLabel,
    fetchedAt,
    generatedAt,
    refreshStartedAt: null,
    refreshDurationMs: null,
    cacheStatus: "fresh",
    cacheAgeMs: 0,
    notes: [
      "BNB Chain cards follow assets[] in bnb.json. Lane and issuer are the snapshot values. A missing name uses the symbol.",
    ],
    sourceFailures: [],
  };
}

interface CatalogCache {
  snapshotMtimeMs: number;
  backfillMtimeMs: number;
  dayKey: string;
  catalog: BnbSnapshotCardCatalog;
}

let catalogCache: CatalogCache | null = null;

async function readJson(path: string): Promise<{ mtimeMs: number; payload: unknown } | null> {
  try {
    const mtimeMs = (await stat(path)).mtimeMs;
    return { mtimeMs, payload: JSON.parse(await readFile(path, "utf8")) as unknown };
  } catch {
    return null;
  }
}

/** Parsed BNB card catalog. A missing file is an empty catalog, not a throw and not a write. */
export async function loadBnbSnapshotCardCatalog(
  nowT = Date.now() / 1000,
  dir = DEFAULT_VOLUME_SNAPSHOT_DIR,
): Promise<BnbSnapshotCardCatalog> {
  const dayKey = easternDayKey(nowT);
  if (!dayKey) return emptyCatalog();
  const snapshotPath = join(dir, BNB_DESK.file);
  const backfillPath = join(dir, BNB_DESK.file.replace(/\.json$/, "-asset-daily.json"));
  const snapshot = await readJson(snapshotPath);
  if (!snapshot) return emptyCatalog();
  const backfillFile = await readJson(backfillPath);
  const backfill = backfillFile?.payload ?? null;
  const backfillMtimeMs = backfillFile?.mtimeMs ?? 0;
  if (
    catalogCache &&
    catalogCache.snapshotMtimeMs === snapshot.mtimeMs &&
    catalogCache.backfillMtimeMs === backfillMtimeMs &&
    catalogCache.dayKey === dayKey
  ) {
    return catalogCache.catalog;
  }
  const catalog = buildBnbSnapshotCardCatalog(snapshot.payload, nowT, backfill);
  catalogCache = {
    snapshotMtimeMs: snapshot.mtimeMs,
    backfillMtimeMs,
    dayKey,
    catalog,
  };
  return catalog;
}

export function resetBnbSnapshotCardCache(): void {
  catalogCache = null;
}

export async function loadBnbSnapshotDetail(
  key: string,
  nowT = Date.now() / 1000,
): Promise<AssetDetailResult | null> {
  const catalog = await loadBnbSnapshotCardCatalog(nowT);
  const asset = findBnbSnapshotDetail(catalog.details, key);
  if (!asset) return null;
  const chain = {
    ...snapshotDeskChainShell(BNB_DESK),
    sourceId: "bnb" as const,
    sourceLabel: BNB_MARKETS_SOURCE_LABEL,
    coverageNote: "BNB Chain token pages follow the snapshot asset when a live registry does not list the contract.",
  };
  return { chain, asset, provenance: snapshotProvenance(null) };
}
