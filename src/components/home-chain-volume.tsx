"use client";

import { useMemo } from "react";
import { ChainVolumeTable, type ChainVolumeRow } from "@/components/chain-volume-card";
import { useDeskVolumeRange } from "@/components/desk-volume-range";
import { chainCombinedVolume24h } from "@/lib/market/aggregate";
import { isRollingVolumeChartRange, type VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import { homeChainRangeCoverageHint, type HomeClosedRangeBoard, type HomeChainRangeLegs } from "@/lib/market/home-chain-range";
import { compareNullableDesc, maxNullable } from "@/lib/market/numbers";
import type { ChainVolume } from "@/lib/market/types";

function legsFor(
  chain: ChainVolume,
  range: VolumeChartRangeId,
  ranges: HomeClosedRangeBoard,
): { chain: ChainVolume; combinedUsd: number | null; coverageHint: string | null } {
  if (isRollingVolumeChartRange(range)) {
    return { chain, combinedUsd: chainCombinedVolume24h(chain), coverageHint: null };
  }
  const legs: HomeChainRangeLegs | undefined = ranges[range].byChainId[chain.id];
  const next: ChainVolume = {
    ...chain,
    volume24hUsd: legs?.volume24hUsd ?? null,
    privateVolume24hUsd: legs?.privateVolume24hUsd ?? null,
    etfVolume24hUsd: legs?.etfVolume24hUsd ?? null,
  };
  return {
    chain: next,
    combinedUsd: legs?.combinedUsd ?? null,
    coverageHint: homeChainRangeCoverageHint(range, legs?.days ?? 0),
  };
}

/** Home chain rows for the desk toggle. 24H keeps the snapshot rows passed in. */
export function HomeChainVolume({
  chains,
  ranges,
}: {
  chains: readonly ChainVolume[];
  ranges: HomeClosedRangeBoard;
}) {
  const { range } = useDeskVolumeRange("7d");
  const rows = useMemo<ChainVolumeRow[]>(() => {
    const scored = chains.map((chain) => legsFor(chain, range, ranges));
    scored.sort((a, b) => {
      const byVolume = compareNullableDesc(a.combinedUsd, b.combinedUsd);
      if (byVolume !== 0) return byVolume;
      return a.chain.name.localeCompare(b.chain.name);
    });
    const maxVolume = maxNullable(scored.map((row) => row.combinedUsd));
    return scored.map((row, index) => ({
      chain: row.chain,
      rank: index + 1,
      maxVolume,
      combinedUsd: row.combinedUsd,
      coverageHint: row.coverageHint,
    }));
  }, [chains, range, ranges]);

  if (rows.length === 0) return null;
  return <ChainVolumeTable rows={rows} range={range} />;
}
