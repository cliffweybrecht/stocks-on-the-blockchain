import type { Metadata } from "next";
import { Suspense } from "react";
import { AssetBreadcrumb, AssetIdentityHeader } from "@/components/asset-identity-header";
import { AssetMarketPanel } from "@/components/asset-price-chart";
import { AssetStatsCard } from "@/components/asset-stats-card";
import { CopyAddress } from "@/components/copy-address";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { MarketsTable } from "@/components/markets-table";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import {
  RobinhoodAssetChart,
  RobinhoodAssetChartFallback,
} from "@/components/robinhood-asset-sections";
import { BaseAssetChart, BaseAssetChartFallback } from "@/components/base-asset-sections";
import { BnbAssetChart, BnbAssetChartFallback } from "@/components/bnb-asset-sections";
import {
  SolanaAssetChart,
  SolanaAssetChartFallback,
  SolanaAssetMarkets,
  SolanaAssetStats,
} from "@/components/solana-asset-sections";
import { TrustBanner } from "@/components/trust-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatPct, formatPrice, formatRelativeTime, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import { emptyAssetPriceHistory } from "@/lib/market/asset-price-history";
import { deskSpotPriceUsd, selectEquityPriceTicker } from "@/lib/desk/price-ticker";
import { sortPoolsByVolume } from "@/lib/desk/pool-sort";
import { withDocumentBudget } from "@/lib/market/document-budget";
import { createMarketDataSource } from "@/lib/market/factory";
import { toJumpAsset } from "@/lib/market/asset-search";
import { lookupRobinhoodChainAsset } from "@/lib/market/robinhood-chain-markets";
import { enrichRobinhoodAssetDetail } from "@/lib/market/robinhood-asset-series";
import { lookupBaseChainAsset } from "@/lib/market/base-chain-markets";
import { enrichBaseAssetDetail } from "@/lib/market/base-asset-series";
import { lookupBnbChainAsset } from "@/lib/market/bnb-chain-markets";
import { enrichBnbAssetDetail } from "@/lib/market/bnb-asset-series";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type AssetDetailResult } from "@/lib/market/types";
import { canonicalUrl } from "@/lib/site/seo";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ chainId: string; symbol: string }>;
}): Promise<Metadata> {
  const { chainId, symbol } = await params;
  return {
    alternates: {
      canonical: canonicalUrl(`/chains/${encodeURIComponent(chainId)}/assets/${encodeURIComponent(decodeURIComponent(symbol))}`),
    },
  };
}

export default async function AssetPage({
  params,
}: {
  params: Promise<{ chainId: string; symbol: string }>;
}) {
  const { chainId, symbol } = await params;
  const source = createMarketDataSource();
  const decoded = decodeURIComponent(symbol);
  const solanaFastPath = chainId === SOLANA_CHAIN_ID;

  const robinhoodChain = chainId === ROBINHOOD_CHAIN_ID;
  const baseChain = chainId === BASE_CHAIN_ID;
  const bnbChain = chainId === BNB_CHAIN_ID;
  const [assetSettled, chainSettled, priceHistorySettled, robinhoodSettled, baseSettled, bnbSettled] = await Promise.allSettled([
    source.getAsset(chainId, decoded, solanaFastPath ? { enrich: false } : undefined),
    solanaFastPath ? withDocumentBudget(source.getChain(chainId), null) : Promise.resolve(null),
    solanaFastPath || robinhoodChain || baseChain || bnbChain ? Promise.resolve(null) : source.getAssetPriceHistory(chainId, decoded),
    robinhoodChain ? lookupRobinhoodChainAsset(decoded) : Promise.resolve(null),
    baseChain ? lookupBaseChainAsset(decoded) : Promise.resolve(null),
    bnbChain ? lookupBnbChainAsset(decoded) : Promise.resolve(null),
  ]);

  const sourceAsset: AssetDetailResult | null =
    assetSettled.status === "fulfilled" ? assetSettled.value : null;
  const discoveredAsset: AssetDetailResult | null =
    robinhoodSettled.status === "fulfilled" ? robinhoodSettled.value : null;
  const discoveredBase: AssetDetailResult | null =
    baseSettled.status === "fulfilled" ? baseSettled.value : null;
  const discoveredBnb: AssetDetailResult | null =
    bnbSettled.status === "fulfilled" ? bnbSettled.value : null;
  const merged = bnbChain ? discoveredBnb : baseChain ? discoveredBase : mergeRobinhoodAsset(sourceAsset, discoveredAsset);
  const result =
    merged && robinhoodChain
      ? await enrichRobinhoodAssetDetail(merged).catch(() => merged)
      : merged && baseChain
        ? await enrichBaseAssetDetail(merged).catch(() => merged)
        : merged && bnbChain
          ? await enrichBnbAssetDetail(merged).catch(() => merged)
          : merged;

  if (!result && assetSettled.status === "rejected" && !robinhoodChain && !baseChain && !bnbChain) {
    const detail =
      assetSettled.reason instanceof Error ? assetSettled.reason.message : "Asset snapshot failed.";
    return (
      <PageShell>
        <ErrorState title="Could not load this stock" detail={detail} />
      </PageShell>
    );
  }

  if (
    !result &&
    ((robinhoodChain && robinhoodSettled.status === "rejected" && assetSettled.status === "rejected") ||
      (baseChain && baseSettled.status === "rejected") ||
      (bnbChain && bnbSettled.status === "rejected"))
  ) {
    const reason =
      bnbChain && bnbSettled.status === "rejected"
        ? bnbSettled.reason
        : baseChain && baseSettled.status === "rejected"
          ? baseSettled.reason
          : robinhoodSettled.status === "rejected"
            ? robinhoodSettled.reason
            : null;
    const detail = reason instanceof Error ? reason.message : "Asset snapshot failed.";
    return (
      <PageShell>
        <ErrorState title="Could not load this stock" detail={detail} />
      </PageShell>
    );
  }

  if (!result) {
    return (
      <PageShell>
        <EmptyState
          title="That page is not in this desk"
          detail="No stock with that symbol is on this chain snapshot. Go back to the chain list and pick a reported name."
        />
      </PageShell>
    );
  }

  const { chain, asset, provenance } = result;
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const isRobinhood = chain.id === ROBINHOOD_CHAIN_ID;
  const isBase = chain.id === BASE_CHAIN_ID;
  const isBnb = chain.id === BNB_CHAIN_ID;
  const indexedDesk = isSolana || isRobinhood || isBase || isBnb;
  const rankedPools = sortPoolsByVolume(asset.pools);
  const priceHistory =
    priceHistorySettled.status === "fulfilled" && priceHistorySettled.value
      ? priceHistorySettled.value
      : emptyAssetPriceHistory(
          priceHistorySettled.status === "rejected" && priceHistorySettled.reason instanceof Error
            ? priceHistorySettled.reason.message
            : "Price history request failed. The desk does not invent a series.",
        );
  const catalog = chainSettled.status === "fulfilled" ? chainSettled.value : null;
  const jumpAssets = catalog
    ? [...catalog.assets, ...(catalog.etfAssets ?? []), ...(catalog.privateAssets ?? [])].map(toJumpAsset)
    : [];
  if (isSolana) {
    // Overlap chart, statistics, and pair-holder work with the shell. Do not await it.
    void source.getAssetPriceHistory(chain.id, decoded).catch(() => undefined);
    void source.getAsset(chain.id, decoded, { pairHolders: false }).catch(() => undefined);
    void source.getAsset(chain.id, decoded).catch(() => undefined);
  }

    return (
      <PageShell
        provenance={provenance}
        solanaJump={jumpAssets.length > 0 ? { chainId: chain.id, assets: jumpAssets } : undefined}
        priceTicker={selectEquityPriceTicker(catalog?.assets ?? (asset.instrumentKind === "equity" ? [asset] : []))}
      >
        <div className="space-y-5">
          <AssetBreadcrumb chain={chain} symbol={asset.symbol} />
          {isSolana ? (
            <Suspense fallback={<SolanaAssetChartFallback chain={chain} asset={asset} />}>
              <SolanaAssetChart chain={chain} asset={asset} routeSymbol={decoded} />
            </Suspense>
          ) : isRobinhood ? (
            <Suspense fallback={<RobinhoodAssetChartFallback chain={chain} asset={asset} />}>
              <RobinhoodAssetChart chain={chain} asset={asset} />
            </Suspense>
          ) : isBase ? (
            <Suspense fallback={<BaseAssetChartFallback chain={chain} asset={asset} />}>
              <BaseAssetChart chain={chain} asset={asset} />
            </Suspense>
          ) : isBnb ? (
            <Suspense fallback={<BnbAssetChartFallback chain={chain} asset={asset} />}>
              <BnbAssetChart chain={chain} asset={asset} />
            </Suspense>
          ) : (
            <AssetMarketPanel
              key={asset.contractAddress}
              header={<AssetIdentityHeader chain={chain} asset={asset} showPin={false} showBreadcrumb={false} />}
              priceUsd={deskSpotPriceUsd(asset)}
              priceChange24hPct={asset.priceChange24hPct}
              history={priceHistory}
            />
          )}
          {isSolana ? (
            <Suspense fallback={<AssetStatsCard asset={asset} />}>
              <SolanaAssetStats chainId={chain.id} routeSymbol={decoded} fallbackAsset={asset} />
            </Suspense>
          ) : (
            <AssetStatsCard asset={asset} />
          )}

          {indexedDesk ? null : <TrustBanner />}

          {!indexedDesk ? (
            <>
              <section className="space-y-3">
                <h3 className="font-heading text-lg font-medium">Identity</h3>
                <CopyAddress address={asset.contractAddress} />
              </section>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Robinhood mark"
                  value={formatPrice(asset.price.robinhoodReferenceUsd)}
                  hint={
                    asset.price.robinhoodGeneratedAt
                      ? `Quoted ${formatRelativeTime(asset.price.robinhoodGeneratedAt)}`
                      : "Absent unless Terminal provided a reference"
                  }
                />
                <Metric
                  label="RH vs DEX"
                  value={formatPct(asset.price.premiumDiscountPct)}
                  hint="(DEX median − RH) / RH"
                  trust="interpretive"
                />
                <Metric
                  label="Price dispersion"
                  value={formatPct(asset.price.priceDispersionPct)}
                  hint="DEX pool range, not a forecast"
                  trust="interpretive"
                />
                <Metric label="DEX liq-weighted" value={formatPrice(asset.price.dexLiquidityWeightedUsd)} />
              </section>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="RH bid" value={formatPrice(asset.price.robinhoodBidUsd)} />
                <Metric label="RH ask" value={formatPrice(asset.price.robinhoodAskUsd)} />
                <Metric label="Largest-pool price" value={formatPrice(asset.price.dexLargestPoolUsd)} />
                <Metric
                  label="Largest pool"
                  value={
                    asset.largestPool
                      ? `${asset.largestPool.dexId} · ${formatUsdCompact(asset.largestPool.liquidityUsd)}`
                      : "—"
                  }
                />
              </section>
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="24h buys" value={formatCount(asset.buys24h)} />
                <Metric label="24h sells" value={formatCount(asset.sells24h)} />
                <Metric
                  label="Top-3 concentration"
                  value={formatPct(asset.concentration.top3Pct)}
                  hint="Share of displayed liquidity"
                />
                <Metric label="USDG displayed liq" value={formatUsdCompact(asset.usdGLiquidityUsd)} />
              </section>
            </>
          ) : null}

          {rankedPools.length > 0 ? (
            isSolana ? (
              <Suspense fallback={<MarketsTable asset={asset} pools={rankedPools} />}>
                <SolanaAssetMarkets
                  chainId={chain.id}
                  routeSymbol={decoded}
                  fallbackAsset={asset}
                  fallbackPools={rankedPools}
                />
              </Suspense>
            ) : (
              <MarketsTable asset={asset} pools={rankedPools} />
            )
          ) : indexedDesk ? (
            <section className="rounded-xl border border-dashed border-border bg-card px-4 py-6" data-markets>
              <h3 className="font-heading text-lg font-medium">
                {isRobinhood
                  ? "No indexed Robinhood Chain pools"
                  : isBase
                    ? "No indexed Base pools"
                    : isBnb
                      ? "No indexed BNB Chain pools"
                      : asset.volumeCoverage === "hydrate_incomplete"
                      ? "Still hydrating"
                      : asset.volumeCoverage === "no_indexed_pools"
                        ? "Confirmed no indexed pools"
                        : "No indexed Solana pools"}
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {isRobinhood
                  ? "DexScreener did not return indexed pools for this contract on chain 4663. The desk does not invent markets."
                  : isBase
                    ? "DexScreener did not return indexed pools for this contract on Base (8453). The desk does not invent markets."
                    : isBnb
                      ? "DexScreener did not return indexed pools for this contract on BNB Chain (56). The desk does not invent markets."
                      : (asset.coverageNote ??
                      (asset.volumeCoverage === "hydrate_incomplete"
                        ? "DexScreener lookup has not finished for this mint. Volume is unknown, not zero — not the same as confirmed no pools."
                        : "DexScreener lookup finished and found no indexed Solana pools for this mint. That is the public pair-index ceiling, not zero volume."))}
              </p>
            </section>
          ) : null}

          {asset.dexes.length > 0 ? (
            <section className="space-y-2">
              <h3 className="font-heading text-lg font-medium">DEX composition</h3>
              <div className="rounded-xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>DEX</TableHead>
                      <TableHead className="text-right">Displayed liq</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                      <TableHead className="text-right">Pools</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asset.dexes.map((dex) => (
                      <TableRow key={dex.dexId}>
                        <TableCell>{dex.dexId}</TableCell>
                        <TableCell className="num text-right">{formatUsdFull(dex.displayedLiquidityUsd)}</TableCell>
                        <TableCell className="num text-right">{formatPct(dex.shareOfDisplayedLiquidityPct)}</TableCell>
                        <TableCell className="num text-right">{formatCount(dex.poolCount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}

          {asset.quoteAssets.length > 0 ? (
            <section className="space-y-2">
              <h3 className="font-heading text-lg font-medium">Quote assets</h3>
              <div className="rounded-xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead className="text-right">Displayed liq</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {asset.quoteAssets.map((quote) => (
                      <TableRow key={quote.address}>
                        <TableCell>
                          {quote.symbol}
                          {quote.symbolConflict ? (
                            <span className="ml-2 text-xs text-interpretive">label conflict</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="num text-xs">{quote.address}</TableCell>
                        <TableCell className="num text-right">{formatUsdFull(quote.displayedLiquidityUsd)}</TableCell>
                        <TableCell className="num text-right">
                          {formatPct(quote.shareOfDisplayedLiquidityPct)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
        </div>
      </PageShell>
    );
}

function mergeRobinhoodAsset(
  sourceAsset: AssetDetailResult | null,
  discovered: AssetDetailResult | null,
): AssetDetailResult | null {
  if (!discovered) return sourceAsset;
  if (!sourceAsset) return discovered;
  const terminal = sourceAsset.asset;
  return {
    ...discovered,
    chain: sourceAsset.chain.id === ROBINHOOD_CHAIN_ID ? sourceAsset.chain : discovered.chain,
    asset: {
      ...discovered.asset,
      robinhoodReferencePriceUsd:
        discovered.asset.robinhoodReferencePriceUsd ?? terminal.robinhoodReferencePriceUsd,
      premiumDiscountPct: discovered.asset.premiumDiscountPct ?? terminal.premiumDiscountPct,
      price: {
        ...discovered.asset.price,
        robinhoodReferenceUsd: discovered.asset.price.robinhoodReferenceUsd ?? terminal.price.robinhoodReferenceUsd,
        robinhoodBidUsd: terminal.price.robinhoodBidUsd,
        robinhoodAskUsd: terminal.price.robinhoodAskUsd,
        robinhoodGeneratedAt: terminal.price.robinhoodGeneratedAt,
        isTradingHalt: terminal.price.isTradingHalt,
        premiumDiscountPct: discovered.asset.price.premiumDiscountPct ?? terminal.price.premiumDiscountPct,
      },
    },
  };
}
