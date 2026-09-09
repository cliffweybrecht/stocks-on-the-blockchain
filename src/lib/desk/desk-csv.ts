import type { AssetSortKey } from "../market/aggregate";
import type { InstrumentKind, VolumeCoverage } from "../market/types";
import { volumeCoverageLabel } from "../market/volume-coverage";
import type { CoverageFilter } from "../market/volume-coverage";

export const DESK_CSV_HEADERS = [
  "rank",
  "symbol",
  "name",
  "issuer",
  "mint",
  "volume24hUsd",
  "liquidity",
  "poolCount",
  "coverage",
] as const;

export interface DeskCsvAsset {
  symbol: string;
  name: string;
  issuer: string | null;
  contractAddress: string;
  volume24hUsd: number | null;
  displayedLiquidityUsd: number | null;
  poolCount: number;
  volumeCoverage: VolumeCoverage;
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Null / non-finite stay blank. A reported 0 is the string "0". */
export function csvNullableNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value);
}

export function shapeDeskCsvRow(
  asset: DeskCsvAsset,
  rank: number,
): Record<(typeof DESK_CSV_HEADERS)[number], string> {
  return {
    rank: String(rank),
    symbol: asset.symbol,
    name: asset.name,
    issuer: asset.issuer ?? "",
    mint: asset.contractAddress,
    volume24hUsd: csvNullableNumber(asset.volume24hUsd),
    liquidity: csvNullableNumber(asset.displayedLiquidityUsd),
    poolCount: csvNullableNumber(asset.poolCount),
    coverage: volumeCoverageLabel(asset.volumeCoverage),
  };
}

export function buildDeskCsv(assets: readonly DeskCsvAsset[]): string {
  const lines = [DESK_CSV_HEADERS.join(",")];
  assets.forEach((asset, index) => {
    const row = shapeDeskCsvRow(asset, index + 1);
    lines.push(DESK_CSV_HEADERS.map((header) => csvEscape(row[header])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

export function deskCsvFilename(input: {
  lane?: InstrumentKind;
  coverage?: CoverageFilter;
  sortKey?: AssetSortKey;
  at?: Date;
}): string {
  const day = (input.at ?? new Date()).toISOString().slice(0, 10);
  const lane = input.lane === "etf" ? "etf" : input.lane === "private" ? "private" : "equity";
  const coverage = (input.coverage ?? "all").replace(/[^a-z0-9-]/gi, "") || "all";
  return `solana-${lane}-${coverage}-${day}.csv`;
}
