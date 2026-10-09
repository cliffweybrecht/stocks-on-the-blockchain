import { CompositeMarketDataSource } from "./composite-source";
import { solanaChainMeta } from "./map-solana";
import { SolanaMarketDataSource } from "./solana-source";
import { SOLANA_SOURCE_LABEL } from "./trust";
import {
  SOLANA_CHAIN_ID,
  type AssetPoolMark,
  type AssetSummary,
  type ChainDetailResult,
  type DataProvenance,
  type MarketDataSource,
} from "./types";
import { inferVolumeCoverage, volumeCoverageNote } from "./volume-coverage";
import { easternDayKey, type DeskSnapshotAsset, type DeskVolumeSnapshot } from "./volume-snapshots";

/** Page renders must not sit on desk-wide DexScreener discovery. */
export const DOCUMENT_NETWORK_BUDGET_MS = 4_000;

/**
 * In-memory Solana desk for a page, or null when this process has none yet.
 * Starts a background refresh when the desk is missing or not a fresh full snapshot.
 * Never waits on DexScreener and never writes a snapshot file.
 */
export function readSolanaDeskForDocument(source: MarketDataSource): ChainDetailResult | null {
  if (source instanceof SolanaMarketDataSource) return source.readDeskForDocument();
  if (source instanceof CompositeMarketDataSource) {
    const solana = source.adapters.find((adapter) => adapter instanceof SolanaMarketDataSource);
    if (solana instanceof SolanaMarketDataSource) return solana.readDeskForDocument();
  }
  return null;
}

/**
 * Resolve with `fallback` when `work` is still pending after `budgetMs`.
 * The underlying request keeps running so a later render can use the cache.
 */
export function withDocumentBudget<T>(
  work: Promise<T>,
  fallback: T,
  budgetMs = DOCUMENT_NETWORK_BUDGET_MS,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, budgetMs);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function chainDetailHasAssetRows(detail: ChainDetailResult | null | undefined): boolean {
  if (!detail) return false;
  return detail.assets.length > 0 || (detail.etfAssets?.length ?? 0) > 0 || (detail.privateAssets?.length ?? 0) > 0;
}

function closedDeskDays(records: readonly DeskVolumeSnapshot[], nowT: number): DeskVolumeSnapshot[] {
  const today = easternDayKey(nowT);
  return records
    .filter((row) => row.date < today && row.combined24hUsd !== null)
    .sort((a, b) => a.t - b.t);
}

/** Newest closed day that stored per-mint rows. Newer totals-only days stay on the chart. */
function latestPerAssetSnapshot(closed: readonly DeskVolumeSnapshot[]): DeskVolumeSnapshot | null {
  for (let index = closed.length - 1; index >= 0; index -= 1) {
    const row = closed[index];
    if (row?.assets && row.assets.length > 0) return row;
  }
  return null;
}

function summaryFromSnapshotAsset(asset: DeskSnapshotAsset): AssetSummary | null {
  const address = asset.address.trim();
  const symbol = asset.symbol.trim();
  if (!address || !symbol) return null;
  const pools: AssetPoolMark[] = [];
  const dexIds = new Set<string>();
  for (const pool of asset.pools) {
    const pairAddress = pool.pairAddress.trim();
    if (!pairAddress) continue;
    const dexId = pool.dexId.trim() || "unknown";
    dexIds.add(dexId);
    pools.push({
      pairAddress,
      dexId,
      volume24hUsd: pool.volume24hUsd,
      liquidityUsd: pool.liquidityUsd,
      priceUsd: null,
    });
  }
  const volumeCoverage = inferVolumeCoverage({
    volume24hUsd: asset.volume24hUsd,
    poolCount: pools.length,
  });
  const issuer = asset.issuer?.trim() ?? "";
  return {
    chainId: SOLANA_CHAIN_ID,
    sourceId: "solana",
    sourceLabel: SOLANA_SOURCE_LABEL,
    symbol,
    name: symbol,
    contractAddress: address,
    issuer: issuer || null,
    logoUrl: null,
    volume24hUsd: asset.volume24hUsd,
    displayedLiquidityUsd: asset.displayedLiquidityUsd,
    usdGLiquidityUsd: null,
    poolCount: pools.length,
    dexCount: dexIds.size,
    pools,
    robinhoodReferencePriceUsd: null,
    dexMedianPriceUsd: null,
    premiumDiscountPct: null,
    top3ConcentrationPct: null,
    liquidityCoverageComplete: null,
    volume24hCoverageComplete: null,
    instrumentKind: asset.instrumentKind,
    volumeCoverage,
    coverageNote: volumeCoverageNote(volumeCoverage, {
      poolCount: pools.length,
      volume24hUsd: asset.volume24hUsd,
      aggregation: "all-pools",
    }),
    priceChange24hPct: null,
  };
}

function lanesFromSnapshotAssets(assets: readonly DeskSnapshotAsset[]): {
  assets: AssetSummary[];
  etfAssets: AssetSummary[];
  privateAssets: AssetSummary[];
} {
  const equities: AssetSummary[] = [];
  const etfs: AssetSummary[] = [];
  const privates: AssetSummary[] = [];
  for (const row of assets) {
    const summary = summaryFromSnapshotAsset(row);
    if (!summary) continue;
    if (summary.instrumentKind === "etf") etfs.push(summary);
    else if (summary.instrumentKind === "private") privates.push(summary);
    else equities.push(summary);
  }
  return { assets: equities, etfAssets: etfs, privateAssets: privates };
}

/**
 * Chain card from the newest closed Eastern snapshot day.
 * Asset rows come from the newest closed day that stored them, which may be
 * older than the totals day. Null when the file has no closed day.
 * Missing per-asset fields stay null. Nothing is invented.
 */
export function solanaDeskFallbackDetail(
  records: readonly DeskVolumeSnapshot[],
  nowT = Date.now() / 1000,
): ChainDetailResult | null {
  const closed = closedDeskDays(records, nowT);
  const last = closed[closed.length - 1];
  if (!last) return null;
  const assetDay = latestPerAssetSnapshot(closed);
  const lanes = lanesFromSnapshotAssets(assetDay?.assets ?? []);
  const withVolume = lanes.assets.filter((asset) => asset.volume24hUsd !== null).length;
  const withPools = lanes.assets.filter((asset) => asset.poolCount > 0).length;
  const noPools = lanes.assets.filter((asset) => asset.volumeCoverage === "no_indexed_pools").length;
  const assetNote =
    assetDay && lanes.assets.length + lanes.etfAssets.length + lanes.privateAssets.length > 0
      ? assetDay.date === last.date
        ? ` Equity cards are the per-asset rows recorded on ${assetDay.date}.`
        : ` Equity cards are the per-asset rows recorded on ${assetDay.date}. Later closed days stored totals only.`
      : " This closed day did not store per-asset rows.";
  const provenance: DataProvenance = {
    sourceId: "solana",
    sourceLabel: SOLANA_SOURCE_LABEL,
    fetchedAt: new Date().toISOString(),
    generatedAt: last.generatedAt,
    refreshStartedAt: null,
    refreshDurationMs: null,
    cacheStatus: "stale",
    cacheAgeMs: null,
    notes: [
      `Live Solana discovery has not committed asset rows yet. 24H totals are the last closed America/New_York desk snapshot (${last.date}).${assetNote}`,
    ],
    sourceFailures: [],
  };
  return {
    chain: {
      ...solanaChainMeta(),
      volume24hUsd: last.publicEquity24hUsd,
      displayedLiquidityUsd: null,
      usdGLiquidityUsd: null,
      assetCount: last.publicMintCount ?? lanes.assets.length,
      assetsWithVolume: withVolume,
      assetsWithPools: withPools,
      assetsStillHydrating: 0,
      assetsWithNoIndexedPools: noPools,
      reportedPoolCount: last.publicPoolCount ?? 0,
      peakDexCount: 0,
      etfCount: lanes.etfAssets.length,
      privateCount: lanes.privateAssets.length,
      privateVolume24hUsd: last.private24hUsd,
      etfVolume24hUsd: last.etfIndex24hUsd,
      coverageNote:
        `Live discovery has not committed asset rows yet. 24H totals are the last closed America/New_York desk snapshot (${last.date}).${assetNote}`,
    },
    assets: lanes.assets,
    etfAssets: lanes.etfAssets,
    privateAssets: lanes.privateAssets,
    provenance,
  };
}

/**
 * Page desk. A live in-memory desk that already has asset rows wins.
 * Otherwise use the closed snapshot, whose rows are the latest nightly
 * per-asset day. A totals-only live desk does not hide those rows.
 */
export function resolveSolanaDeskForDocument(
  live: ChainDetailResult | null,
  records: readonly DeskVolumeSnapshot[],
  nowT = Date.now() / 1000,
): ChainDetailResult | null {
  if (chainDetailHasAssetRows(live)) return live;
  const fallback = solanaDeskFallbackDetail(records, nowT);
  if (chainDetailHasAssetRows(fallback)) return fallback;
  return live ?? fallback;
}
