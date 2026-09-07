import type { InstrumentKind, VolumeAggregation, VolumeCoverage } from "./types";

export function inferVolumeCoverage(input: {
  volume24hUsd: number | null;
  poolCount: number;
  hydrateFailed?: boolean;
  hydrateIncomplete?: boolean;
}): VolumeCoverage {
  if (input.volume24hUsd !== null) return "reported";
  if (input.hydrateFailed) return "hydrate_failed";
  if (input.hydrateIncomplete) return "hydrate_incomplete";
  if (input.poolCount === 0) return "no_indexed_pools";
  return "pools_without_volume";
}

export function volumeCoverageLabel(coverage: VolumeCoverage): string {
  switch (coverage) {
    case "reported":
      return "With volume";
    case "no_indexed_pools":
      return "No pools yet";
    case "pools_without_volume":
      return "Pools, volume unknown";
    case "hydrate_failed":
      return "Volume fetch failed";
    case "hydrate_incomplete":
      return "Still loading volume";
  }
}

export function volumeCoverageNote(
  coverage: VolumeCoverage,
  input: {
    poolCount: number;
    volume24hUsd: number | null;
    aggregation: VolumeAggregation;
  },
): string {
  switch (coverage) {
    case "reported":
      return input.aggregation === "primary-pair"
        ? `DexScreener reported 24h volume on the primary indexed pair (${input.poolCount} pool${input.poolCount === 1 ? "" : "s"} in this snapshot). Open the chain page for every-pool aggregation.`
        : `Aggregate 24h volume is the sum of DexScreener pair volume.h24 across ${input.poolCount} Solana pool${input.poolCount === 1 ? "" : "s"}. A reported 0 is a real zero.`;
    case "no_indexed_pools":
      return "DexScreener has no indexed Solana pools for this mint. Volume is unknown, not zero.";
    case "pools_without_volume":
      return "DexScreener indexed pool(s) for this mint but did not report 24h volume on any of them. Volume is unknown, not zero.";
    case "hydrate_failed":
      return "DexScreener pool fetch failed for this mint. Volume is unknown, not zero.";
    case "hydrate_incomplete":
      return "DexScreener hydrate did not finish before the snapshot budget. Volume is unknown, not zero — still loading / source slow.";
  }
}

export function defaultInstrumentFields(input: {
  volume24hUsd: number | null;
  poolCount: number;
  instrumentKind?: InstrumentKind;
  coverageNote?: string | null;
}): {
  instrumentKind: InstrumentKind;
  volumeCoverage: VolumeCoverage;
  coverageNote: string | null;
} {
  const volumeCoverage = inferVolumeCoverage(input);
  return {
    instrumentKind: input.instrumentKind ?? "equity",
    volumeCoverage,
    coverageNote: input.coverageNote ?? null,
  };
}
