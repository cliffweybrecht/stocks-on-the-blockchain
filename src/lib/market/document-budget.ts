import { solanaChainMeta } from "./map-solana";
import { SOLANA_SOURCE_LABEL } from "./trust";
import type { ChainDetailResult, DataProvenance } from "./types";
import { easternDayKey, type DeskVolumeSnapshot } from "./volume-snapshots";

/** Page renders must not sit on desk-wide DexScreener discovery. */
export const DOCUMENT_NETWORK_BUDGET_MS = 4_000;

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

/**
 * Chain card from the newest closed Eastern snapshot day.
 * Used when live discovery does not finish inside the page budget.
 * Null when the file has no closed day.
 */
export function solanaDeskFallbackDetail(
  records: readonly DeskVolumeSnapshot[],
  nowT = Date.now() / 1000,
): ChainDetailResult | null {
  const today = easternDayKey(nowT);
  const closed = records
    .filter((row) => row.date < today && row.combined24hUsd !== null)
    .sort((a, b) => a.t - b.t);
  const last = closed[closed.length - 1];
  if (!last) return null;
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
      "Live Solana discovery exceeded the page budget. 24H is the last closed America/New_York desk snapshot. The name list continues loading in the background.",
    ],
    sourceFailures: [],
  };
  return {
    chain: {
      ...solanaChainMeta(),
      volume24hUsd: last.publicEquity24hUsd,
      displayedLiquidityUsd: null,
      usdGLiquidityUsd: null,
      assetCount: last.publicMintCount ?? 0,
      assetsWithVolume: 0,
      assetsWithPools: 0,
      assetsStillHydrating: 0,
      assetsWithNoIndexedPools: 0,
      reportedPoolCount: last.publicPoolCount ?? 0,
      peakDexCount: 0,
      etfCount: 0,
      privateCount: 0,
      privateVolume24hUsd: last.private24hUsd,
      etfVolume24hUsd: last.etfIndex24hUsd,
      coverageNote:
        "Live discovery exceeded the page budget. 24H is the last closed America/New_York desk snapshot.",
    },
    assets: [],
    etfAssets: [],
    privateAssets: [],
    provenance,
  };
}
