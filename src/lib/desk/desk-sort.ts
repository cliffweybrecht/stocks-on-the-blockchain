import type { AssetSortKey } from "@/lib/market/aggregate";

const CHIP_LABELS: Record<AssetSortKey, string> = {
  volume24hUsd: "Volume",
  displayedLiquidityUsd: "Liquidity",
  marketValueUsd: "Market value",
  poolCount: "Pools",
  premiumDiscountPct: "RH vs DEX",
};

/**
 * Equity cards sort by Volume, Liquidity, or Market value.
 * Other chains keep Pools, and Robinhood keeps the reference-mark chip.
 */
export function deskSortOptions(input: {
  solanaDesk: boolean;
  showRobinhoodMarks: boolean;
  /** False when `NEXT_PUBLIC_HIDE_SECTIONS` lists `marketvalue`. */
  includeMarketValue?: boolean;
}): Array<[AssetSortKey, string]> {
  const keys: AssetSortKey[] = ["volume24hUsd", "displayedLiquidityUsd"];
  if (input.includeMarketValue !== false) keys.push("marketValueUsd");
  if (!input.solanaDesk) keys.push("poolCount");
  if (input.showRobinhoodMarks) keys.push("premiumDiscountPct");
  return keys.map((key) => [key, CHIP_LABELS[key]]);
}

/** A stale `?sort=pools` link on the Solana desk falls back to volume. A hidden market-value sort does too. */
export function resolveDeskSortKey(
  key: AssetSortKey,
  solanaDesk: boolean,
  includeMarketValue = true,
): AssetSortKey {
  if (solanaDesk && key === "poolCount") return "volume24hUsd";
  if (!includeMarketValue && key === "marketValueUsd") return "volume24hUsd";
  return key;
}
