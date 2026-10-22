import { isChainEnabled } from "../market/chain-config";
import { formatPrice } from "../market/format";
import { assetRouteKey } from "../market/identity";
import type { AssetSummary } from "../market/types";

/** Equities must clear this DexScreener 24h rollup to appear in the price marquee. */
export const PRICE_TICKER_MIN_VOLUME_USD = 1_000_000;

export interface EquityPriceTickerItem {
  symbol: string;
  chainId: string;
  contractAddress: string;
  priceUsd: number;
  volume24hUsd: number;
  href: string;
}

/** On-chain spot the desk already shows: DEX median. Missing stays missing. */
export function deskSpotPriceUsd(asset: Pick<AssetSummary, "dexMedianPriceUsd">): number | null {
  const price = asset.dexMedianPriceUsd;
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return null;
  const printed = formatPrice(price);
  if (printed === "—" || printed === "$0.00") return null;
  return price;
}

/**
 * Equity-lane names with reported 24h volume ≥ $1M and a real DEX median price.
 * ETF / index rows are never admitted. Null volume or price is skipped, not zeroed.
 */
export function selectEquityPriceTicker(
  assets: readonly Pick<
    AssetSummary,
    "symbol" | "chainId" | "contractAddress" | "volume24hUsd" | "dexMedianPriceUsd" | "instrumentKind"
  >[],
): EquityPriceTickerItem[] {
  const catalog = assets.filter(
    (asset) => (asset.instrumentKind ?? "equity") === "equity" && isChainEnabled(asset.chainId),
  );
  const items: EquityPriceTickerItem[] = [];
  for (const asset of catalog) {
    const volume = asset.volume24hUsd;
    if (volume === null || volume === undefined || !Number.isFinite(volume)) continue;
    if (volume < PRICE_TICKER_MIN_VOLUME_USD) continue;
    const priceUsd = deskSpotPriceUsd(asset);
    if (priceUsd === null) continue;
    items.push({
      symbol: asset.symbol,
      chainId: asset.chainId,
      contractAddress: asset.contractAddress,
      priceUsd,
      volume24hUsd: volume,
      href: `/chains/${asset.chainId}/assets/${encodeURIComponent(assetRouteKey(asset, catalog))}`,
    });
  }
  return items.sort(
    (a, b) => b.volume24hUsd - a.volume24hUsd || a.symbol.localeCompare(b.symbol),
  );
}
