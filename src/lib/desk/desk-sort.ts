import type { AssetSortKey } from "@/lib/market/aggregate";

const CHIP_LABELS: Record<AssetSortKey, string> = {
  volume24hUsd: "Volume",
  displayedLiquidityUsd: "Liquidity",
  poolCount: "Pools",
  premiumDiscountPct: "RH vs DEX",
};

/**
 * Solana list desk sort chips are Volume | Liquidity only.
 * Other chains keep Pools, and Robinhood keeps the reference-mark chip.
 */
export function deskSortOptions(input: {
  solanaDesk: boolean;
  showRobinhoodMarks: boolean;
}): Array<[AssetSortKey, string]> {
  const keys: AssetSortKey[] = ["volume24hUsd", "displayedLiquidityUsd"];
  if (!input.solanaDesk) keys.push("poolCount");
  if (input.showRobinhoodMarks) keys.push("premiumDiscountPct");
  return keys.map((key) => [key, CHIP_LABELS[key]]);
}

/** A stale `?sort=pools` link on the Solana desk falls back to volume. */
export function resolveDeskSortKey(key: AssetSortKey, solanaDesk: boolean): AssetSortKey {
  if (solanaDesk && key === "poolCount") return "volume24hUsd";
  return key;
}
