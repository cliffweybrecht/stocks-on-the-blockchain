import { AssetIdentityHeader } from "@/components/asset-identity-header";
import { AssetMarketPanel } from "@/components/asset-price-chart";
import { deskSpotPriceUsd } from "@/lib/desk/price-ticker";
import { emptyAssetPriceHistory } from "@/lib/market/asset-price-history";
import { baseAllMarketsVolumePath, loadBaseAssetPriceHistory } from "@/lib/market/base-asset-series";
import type { AssetDetail, ChainVolume } from "@/lib/market/types";

function chartHeader(chain: ChainVolume, asset: AssetDetail) {
  return <AssetIdentityHeader chain={chain} asset={asset} showPin showBreadcrumb={false} />;
}

/** Identity and the DexScreener 24H total. The plot waits for Gecko. */
export function BaseAssetChartFallback({ chain, asset }: { chain: ChainVolume; asset: AssetDetail }) {
  return (
    <AssetMarketPanel
      key={asset.contractAddress}
      header={chartHeader(chain, asset)}
      priceUsd={deskSpotPriceUsd(asset)}
      priceChange24hPct={asset.priceChange24hPct}
      history={emptyAssetPriceHistory("Price history is still loading.")}
      chartPending
      allMarkets24hUsd={asset.volume24hUsd}
      allMarketsHref={baseAllMarketsVolumePath(asset.contractAddress)}
    />
  );
}

export async function BaseAssetChart({ chain, asset }: { chain: ChainVolume; asset: AssetDetail }) {
  const history = await loadBaseAssetPriceHistory(asset).catch((error: unknown) =>
    emptyAssetPriceHistory(
      error instanceof Error
        ? error.message
        : "Price history request failed. The desk does not invent a series.",
    ),
  );

  return (
    <AssetMarketPanel
      key={asset.contractAddress}
      header={chartHeader(chain, asset)}
      priceUsd={deskSpotPriceUsd(asset)}
      priceChange24hPct={asset.priceChange24hPct}
      history={history}
      allMarkets24hUsd={asset.volume24hUsd}
      allMarketsHref={baseAllMarketsVolumePath(asset.contractAddress)}
    />
  );
}
