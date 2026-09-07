import { compareNullableDesc, sumNullable } from "../market/numbers";

export interface SortablePool {
  volume24hUsd: number | null;
  liquidityUsd?: number | null;
  dexId?: string;
}

export function sortPoolsByVolume<T extends SortablePool>(pools: readonly T[]): T[] {
  return [...pools].sort((a, b) => {
    const byVolume = compareNullableDesc(a.volume24hUsd, b.volume24hUsd);
    if (byVolume !== 0) return byVolume;
    const byLiq = compareNullableDesc(a.liquidityUsd ?? null, b.liquidityUsd ?? null);
    if (byLiq !== 0) return byLiq;
    return (a.dexId ?? "").localeCompare(b.dexId ?? "");
  });
}

export function poolAggregateTotals(pools: readonly SortablePool[]): {
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  poolCount: number;
} {
  return {
    volume24hUsd: sumNullable(pools.map((pool) => pool.volume24hUsd)),
    liquidityUsd: sumNullable(pools.map((pool) => pool.liquidityUsd ?? null)),
    poolCount: pools.length,
  };
}
