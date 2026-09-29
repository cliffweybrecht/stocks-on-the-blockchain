import { AssetIdentityHeader } from "@/components/asset-identity-header";
import { AssetMarketPanel } from "@/components/asset-price-chart";
import { AssetStatsCard } from "@/components/asset-stats-card";
import { MarketsTable } from "@/components/markets-table";
import { deskSpotPriceUsd } from "@/lib/desk/price-ticker";
import { sortPoolsByVolume } from "@/lib/desk/pool-sort";
import { DEFAULT_ALL_MARKETS_VOLUME_DIR, readStoredAllMarketsVolume } from "@/lib/market/all-markets-volume-cache";
import { emptyAssetPriceHistory } from "@/lib/market/asset-price-history";
import { uniqueAllMarketsPools } from "@/lib/market/asset-volume-headline";
import { createMarketDataSource } from "@/lib/market/factory";
import type { AssetDetail, AssetPoolMark, ChainVolume } from "@/lib/market/types";

function chartHeader(chain: ChainVolume, asset: AssetDetail) {
  return <AssetIdentityHeader chain={chain} asset={asset} showPin showBreadcrumb={false} />;
}

/** Identity and the DexScreener 24H total. The plot waits for Gecko. */
export function SolanaAssetChartFallback({ chain, asset }: { chain: ChainVolume; asset: AssetDetail }) {
  return (
    <AssetMarketPanel
      key={asset.contractAddress}
      header={chartHeader(chain, asset)}
      priceUsd={deskSpotPriceUsd(asset)}
      priceChange24hPct={asset.priceChange24hPct}
      history={emptyAssetPriceHistory("Price history is still loading.")}
      chartPending
      allMarkets24hUsd={asset.volume24hUsd}
      allMarketsSymbol={asset.symbol}
    />
  );
}

export async function SolanaAssetChart({
  chain,
  asset,
  routeSymbol,
}: {
  chain: ChainVolume;
  asset: AssetDetail;
  routeSymbol: string;
}) {
  const source = createMarketDataSource();
  const pairAddresses = uniqueAllMarketsPools(asset.pools).map((pool) => pool.pairAddress);
  const [history, stored] = await Promise.all([
    source.getAssetPriceHistory(chain.id, routeSymbol).catch((error: unknown) =>
      emptyAssetPriceHistory(
        error instanceof Error
          ? error.message
          : "Price history request failed. The desk does not invent a series.",
      ),
    ),
    readStoredAllMarketsVolume({
      directory: DEFAULT_ALL_MARKETS_VOLUME_DIR,
      mint: asset.contractAddress,
      pairAddresses,
    }).catch(() => null),
  ]);

  return (
    <AssetMarketPanel
      key={asset.contractAddress}
      header={chartHeader(chain, asset)}
      priceUsd={deskSpotPriceUsd(asset)}
      priceChange24hPct={asset.priceChange24hPct}
      history={history}
      allMarkets24hUsd={asset.volume24hUsd}
      allMarketsSymbol={asset.symbol}
      initialAllMarketsDaily={stored?.daily ?? null}
      initialAllMarketsHourly={stored?.hourly ?? null}
    />
  );
}

export async function SolanaAssetStats({
  chainId,
  routeSymbol,
  fallbackAsset,
}: {
  chainId: string;
  routeSymbol: string;
  fallbackAsset: AssetDetail;
}) {
  let asset = fallbackAsset;
  try {
    const result = await createMarketDataSource().getAsset(chainId, routeSymbol, { pairHolders: false });
    if (result) asset = result.asset;
  } catch {
    asset = fallbackAsset;
  }
  return <AssetStatsCard asset={asset} />;
}

export async function SolanaAssetMarkets({
  chainId,
  routeSymbol,
  fallbackAsset,
  fallbackPools,
}: {
  chainId: string;
  routeSymbol: string;
  fallbackAsset: AssetDetail;
  fallbackPools: readonly AssetPoolMark[];
}) {
  let asset = fallbackAsset;
  let pools = fallbackPools;
  try {
    const result = await createMarketDataSource().getAsset(chainId, routeSymbol);
    if (result) {
      asset = result.asset;
      pools = sortPoolsByVolume(asset.pools);
    }
  } catch {
    asset = fallbackAsset;
    pools = fallbackPools;
  }
  return <MarketsTable asset={asset} pools={pools} />;
}
