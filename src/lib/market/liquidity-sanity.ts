import { asNonNegativeNumber } from "./numbers";

/**
 * Shared liquidity sanity guard for nightly per-asset rows.
 *
 * Solana calls this from `deskSnapshotAssetsFromSummaries`. Robinhood and BNB
 * call the same rule from `scripts/snapshot_asset_rows.py`. Base can adopt
 * that Python helper without a second copy of the thresholds.
 *
 * A pool reserve is left out of `displayedLiquidityUsd` when either:
 * - liquidity is above $50M and 24h volume is below 0.01% of that liquidity
 *   (a missing volume counts as no trading), or
 * - liquidity is above 20× the asset's next-largest pool and above 10× a
 *   known market value. Unknown market value skips this check.
 *
 * When the caller also has GeckoTerminal `reserve_in_usd` and that reserve is
 * under 10% of the reported figure, the checks above run on the Gecko reserve
 * and the displayed sum uses it. The raw figure is still recorded. A pool with
 * no other pool beside it is not treated as 20× a missing neighbor.
 *
 * Volume is never changed. When every reported reserve is excluded, displayed
 * liquidity is 0 rather than null, so a reader that sums pools only when the
 * field is missing cannot put the raw reserve back.
 */

/** Pool liquidity above this, with almost no trading, is not displayed. */
export const LIQUIDITY_SANITY_MIN_USD = 50_000_000;
/** 24h volume below this fraction of liquidity is dead depth. 0.01%. */
export const LIQUIDITY_SANITY_MIN_VOLUME_RATIO = 0.0001;
export const LIQUIDITY_SANITY_DOMINANCE_MULTIPLE = 20;
export const LIQUIDITY_SANITY_MARKET_MULTIPLE = 10;
/** GeckoTerminal reserve replaces the reported figure when it is under this fraction. */
export const LIQUIDITY_SANITY_GECKO_MAX_RATIO = 0.1;

export const LIQUIDITY_SANITY_REASON_DEAD_DEPTH = "liquidity-above-50m-with-volume-below-0.01pct";
export const LIQUIDITY_SANITY_REASON_DOMINANCE = "liquidity-above-20x-next-pool-and-10x-market-value";
export const LIQUIDITY_SANITY_REASON_GECKO = "gecko-reserve-far-lower";

export interface LiquiditySanityPool {
  poolId: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  /** GeckoTerminal `reserve_in_usd` when the caller has it beside the reported reserve. */
  geckoReserveUsd?: number | null;
}

export interface ExcludedLiquidityPool {
  poolId: string;
  /** Reported reserve that was not used as displayed liquidity. */
  liquidityUsd: number;
  reason: string;
  /** Set when the displayed sum counts the GeckoTerminal reserve instead. */
  replacementLiquidityUsd?: number;
}

export interface LiquiditySanityResult {
  /**
   * Sum of reserves that survived the guard.
   * 0 when every reported reserve was excluded.
   * Null when no reserve was reported.
   */
  displayedLiquidityUsd: number | null;
  excludedLiquidityPools: ExcludedLiquidityPool[];
}

/** Previous displayed liquidity kept on a stored row the guard rewrote. */
export interface LiquiditySnapshotCorrection {
  reason: string;
  displayedLiquidityUsd: number | null;
}

export interface StoredLiquidityChange {
  date: string;
  symbol: string;
  address: string;
  displayedLiquidityUsdBefore: number | null;
  displayedLiquidityUsdAfter: number | null;
  excludedLiquidityPools: ExcludedLiquidityPool[];
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

function nonNegative(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function nextLargestLiquidity(pools: readonly { liquidityUsd: number | null }[], index: number): number {
  let next = 0;
  for (let other = 0; other < pools.length; other += 1) {
    if (other === index) continue;
    const liquidity = pools[other]?.liquidityUsd;
    if (liquidity !== null && liquidity !== undefined && liquidity > next) next = liquidity;
  }
  return next;
}

export function liquidityExclusionReason(excluded: readonly ExcludedLiquidityPool[]): string {
  return excluded
    .map((row) => {
      if (row.replacementLiquidityUsd !== undefined) {
        return `replaced pool ${row.poolId} raw liquidity ${row.liquidityUsd} with ${row.replacementLiquidityUsd}: ${row.reason}`;
      }
      return `excluded pool ${row.poolId} raw liquidity ${row.liquidityUsd}: ${row.reason}`;
    })
    .join("; ");
}

export function applyLiquiditySanity(input: {
  pools: readonly LiquiditySanityPool[];
  marketValueUsd?: number | null;
}): LiquiditySanityResult {
  const market = nonNegative(input.marketValueUsd);
  const pools = input.pools.map((pool) => ({
    poolId: pool.poolId.trim(),
    liquidityUsd: nonNegative(pool.liquidityUsd),
    volume24hUsd: nonNegative(pool.volume24hUsd),
    geckoReserveUsd: nonNegative(pool.geckoReserveUsd),
  }));

  const excluded: ExcludedLiquidityPool[] = [];
  const counted: number[] = [];
  let sawLiquidity = false;

  for (let index = 0; index < pools.length; index += 1) {
    const pool = pools[index];
    if (!pool || !pool.poolId || pool.liquidityUsd === null) continue;
    sawLiquidity = true;
    const liquidity = pool.liquidityUsd;
    const volume = pool.volume24hUsd ?? 0;
    const gecko = pool.geckoReserveUsd;
    const geckoReplaces = gecko !== null && liquidity > 0 && gecko < liquidity * LIQUIDITY_SANITY_GECKO_MAX_RATIO;
    const figure = geckoReplaces && gecko !== null ? gecko : liquidity;

    if (figure > LIQUIDITY_SANITY_MIN_USD && volume < figure * LIQUIDITY_SANITY_MIN_VOLUME_RATIO) {
      excluded.push({
        poolId: pool.poolId,
        liquidityUsd: roundUsd(liquidity),
        reason: LIQUIDITY_SANITY_REASON_DEAD_DEPTH,
      });
      continue;
    }

    const next = nextLargestLiquidity(pools, index);
    if (
      market !== null &&
      market > 0 &&
      next > 0 &&
      figure > LIQUIDITY_SANITY_DOMINANCE_MULTIPLE * next &&
      figure > LIQUIDITY_SANITY_MARKET_MULTIPLE * market
    ) {
      excluded.push({
        poolId: pool.poolId,
        liquidityUsd: roundUsd(liquidity),
        reason: LIQUIDITY_SANITY_REASON_DOMINANCE,
      });
      continue;
    }

    if (geckoReplaces && gecko !== null) {
      excluded.push({
        poolId: pool.poolId,
        liquidityUsd: roundUsd(liquidity),
        reason: LIQUIDITY_SANITY_REASON_GECKO,
        replacementLiquidityUsd: roundUsd(gecko),
      });
    }
    counted.push(figure);
  }

  if (!sawLiquidity) return { displayedLiquidityUsd: null, excludedLiquidityPools: [] };
  if (counted.length === 0) return { displayedLiquidityUsd: 0, excludedLiquidityPools: excluded };
  return {
    displayedLiquidityUsd: roundUsd(counted.reduce((sum, value) => sum + value, 0)),
    excludedLiquidityPools: excluded,
  };
}

function sameUsd(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.005;
}

function poolsFromAsset(asset: Record<string, unknown>): LiquiditySanityPool[] {
  if (!Array.isArray(asset.pools)) return [];
  const pools: LiquiditySanityPool[] = [];
  for (const pool of asset.pools) {
    if (!pool || typeof pool !== "object") continue;
    const rec = pool as Record<string, unknown>;
    const poolId = typeof rec.pairAddress === "string" ? rec.pairAddress : typeof rec.poolId === "string" ? rec.poolId : "";
    const geckoRaw = rec.geckoReserveUsd !== undefined ? rec.geckoReserveUsd : rec.reserveUsd;
    pools.push({
      poolId,
      liquidityUsd: asNonNegativeNumber(rec.liquidityUsd),
      volume24hUsd: asNonNegativeNumber(rec.volume24hUsd),
      geckoReserveUsd: asNonNegativeNumber(geckoRaw),
    });
  }
  return pools;
}

/**
 * Rewrite stored per-asset liquidity that fails the guard.
 * Volume fields and pool `liquidityUsd` stay as captured. The previous
 * displayed total is kept on `correction`.
 */
export function correctStoredSnapshotAssets(payload: unknown): StoredLiquidityChange[] {
  if (!payload || typeof payload !== "object") return [];
  const records = (payload as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  const changes: StoredLiquidityChange[] = [];
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const date = typeof rec.date === "string" ? rec.date : "";
    if (!Array.isArray(rec.assets)) continue;
    for (const asset of rec.assets) {
      if (!asset || typeof asset !== "object") continue;
      const item = asset as Record<string, unknown>;
      const sanity = applyLiquiditySanity({
        pools: poolsFromAsset(item),
        marketValueUsd: asNonNegativeNumber(item.marketValueUsd),
      });
      if (sanity.excludedLiquidityPools.length === 0) continue;
      const before = item.displayedLiquidityUsd === null ? null : asNonNegativeNumber(item.displayedLiquidityUsd);
      if (item.displayedLiquidityUsd !== null && before === null) continue;
      if (sameUsd(before, sanity.displayedLiquidityUsd)) continue;
      const correction: LiquiditySnapshotCorrection = {
        reason: liquidityExclusionReason(sanity.excludedLiquidityPools),
        displayedLiquidityUsd: before,
      };
      item.correction = correction;
      item.displayedLiquidityUsd = sanity.displayedLiquidityUsd;
      item.excludedLiquidityPools = sanity.excludedLiquidityPools;
      changes.push({
        date,
        symbol: typeof item.symbol === "string" ? item.symbol : "",
        address: typeof item.address === "string" ? item.address : "",
        displayedLiquidityUsdBefore: before,
        displayedLiquidityUsdAfter: sanity.displayedLiquidityUsd,
        excludedLiquidityPools: sanity.excludedLiquidityPools,
      });
    }
  }
  return changes;
}

/**
 * Figure the liquidity-by-range cards should read.
 * Draft PR #401 and `cursor/preview-mv-integration` already prefer
 * `displayedLiquidityUsd` (including 0) and sum pools only when that field
 * is absent. This helper is that read, and the fallback skips excluded pools.
 */
export function readStoredAssetLiquidityUsd(asset: {
  displayedLiquidityUsd?: number | null;
  pools?: readonly { pairAddress?: string; poolId?: string; liquidityUsd?: number | null }[] | null;
  excludedLiquidityPools?: readonly ExcludedLiquidityPool[] | null;
}): number | null {
  if (asset.displayedLiquidityUsd !== undefined && asset.displayedLiquidityUsd !== null) {
    const displayed = asNonNegativeNumber(asset.displayedLiquidityUsd);
    if (displayed !== null) return roundUsd(displayed);
  }
  const replacements = new Map<string, number>();
  const excluded = new Set<string>();
  for (const row of asset.excludedLiquidityPools ?? []) {
    if (row.replacementLiquidityUsd !== undefined) replacements.set(row.poolId, row.replacementLiquidityUsd);
    else excluded.add(row.poolId);
  }
  let sum = 0;
  let any = false;
  for (const pool of asset.pools ?? []) {
    const poolId = (pool.pairAddress || pool.poolId || "").trim();
    if (!poolId || excluded.has(poolId)) continue;
    const replacement = replacements.get(poolId);
    const liquidity = replacement !== undefined ? replacement : asNonNegativeNumber(pool.liquidityUsd);
    if (liquidity === null) continue;
    sum += liquidity;
    any = true;
  }
  return any ? roundUsd(sum) : null;
}
