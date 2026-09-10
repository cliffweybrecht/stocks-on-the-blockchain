import { AssetBreadcrumb, AssetIdentityHeader } from "@/components/asset-identity-header";
import { AssetMarketPanel } from "@/components/asset-price-chart";
import { AssetStatsCard } from "@/components/asset-stats-card";
import { CopyAddress } from "@/components/copy-address";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
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
import { poolAggregateTotals, sortPoolsByVolume } from "@/lib/desk/pool-sort";
import { createMarketDataSource } from "@/lib/market/factory";
import { toJumpAsset } from "@/lib/market/asset-search";
import { SOLANA_CHAIN_ID } from "@/lib/market/types";

export const dynamic = "force-dynamic";

export default async function AssetPage({
  params,
}: {
  params: Promise<{ chainId: string; symbol: string }>;
}) {
  const { chainId, symbol } = await params;
  const source = createMarketDataSource();
  const decoded = decodeURIComponent(symbol);

  const [assetSettled, chainSettled, priceHistorySettled] = await Promise.allSettled([
    source.getAsset(chainId, decoded),
    chainId === SOLANA_CHAIN_ID ? source.getChain(chainId) : Promise.resolve(null),
    source.getAssetPriceHistory(chainId, decoded),
  ]);

  if (assetSettled.status === "rejected") {
    const detail =
      assetSettled.reason instanceof Error ? assetSettled.reason.message : "Asset snapshot failed.";
    return (
      <PageShell>
        <ErrorState title="Could not load this stock" detail={detail} />
      </PageShell>
    );
  }

  const result = assetSettled.value;
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
  const rankedPools = sortPoolsByVolume(asset.pools);
  const poolTotals = poolAggregateTotals(rankedPools);
  const priceHistory =
    priceHistorySettled.status === "fulfilled"
      ? priceHistorySettled.value
      : emptyAssetPriceHistory(
          priceHistorySettled.reason instanceof Error
            ? priceHistorySettled.reason.message
            : "Price history request failed. The desk does not invent a series.",
        );
  const catalog = chainSettled.status === "fulfilled" ? chainSettled.value : null;
  const jumpAssets = catalog
    ? [...catalog.assets, ...(catalog.etfAssets ?? []), ...(catalog.privateAssets ?? [])].map(toJumpAsset)
    : [];

    return (
      <PageShell
        provenance={provenance}
        solanaJump={jumpAssets.length > 0 ? { chainId: chain.id, assets: jumpAssets } : undefined}
        priceTicker={selectEquityPriceTicker(catalog?.assets ?? (asset.instrumentKind === "equity" ? [asset] : []))}
      >
        <div className="space-y-5">
          <AssetBreadcrumb chain={chain} symbol={asset.symbol} />
          <AssetMarketPanel
            header={<AssetIdentityHeader chain={chain} asset={asset} showPin={isSolana} showBreadcrumb={false} />}
            priceUsd={deskSpotPriceUsd(asset)}
            priceChange24hPct={asset.priceChange24hPct}
            history={priceHistory}
          />
          <AssetStatsCard asset={asset} />
          {asset.coverageNote ? <p className="max-w-2xl text-sm text-muted-foreground">{asset.coverageNote}</p> : null}

          {isSolana ? null : <TrustBanner />}
          <ProvenanceBar provenance={provenance} compact={isSolana} />

          {!isSolana ? (
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
            <section className="space-y-2">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="font-heading text-lg font-medium">Solana pools</h3>
                  <p className="text-sm text-muted-foreground">
                    Ranked by pair 24h volume (nulls last). Stock volume is the sum of these rows. A pair is never
                    one stock.
                  </p>
                </div>
                <p className="num text-sm text-muted-foreground">
                  Aggregate {formatUsdCompact(poolTotals.volume24hUsd)} vol · {formatUsdCompact(poolTotals.liquidityUsd)}{" "}
                  liq · {formatCount(poolTotals.poolCount)} pairs
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-right">#</TableHead>
                      <TableHead>DEX</TableHead>
                      <TableHead>Pair</TableHead>
                      <TableHead className="text-right">24h volume</TableHead>
                      <TableHead className="text-right">Displayed liq</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rankedPools.map((pool, index) => (
                      <TableRow key={pool.pairAddress || `${pool.dexId}-${index}`}>
                        <TableCell className="num text-right text-muted-foreground">{index + 1}</TableCell>
                        <TableCell>{pool.dexId}</TableCell>
                        <TableCell className="num max-w-[9rem] truncate text-xs sm:max-w-none">{pool.pairAddress || "—"}</TableCell>
                        <TableCell className="num text-right">{formatUsdFull(pool.volume24hUsd)}</TableCell>
                        <TableCell className="num text-right">{formatUsdFull(pool.liquidityUsd)}</TableCell>
                        <TableCell className="num text-right">{formatPrice(pool.priceUsd)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/30 font-medium hover:bg-muted/30">
                      <TableCell colSpan={3}>Aggregate</TableCell>
                      <TableCell className="num text-right">{formatUsdFull(poolTotals.volume24hUsd)}</TableCell>
                      <TableCell className="num text-right">{formatUsdFull(poolTotals.liquidityUsd)}</TableCell>
                      <TableCell className="num text-right text-muted-foreground">{formatCount(poolTotals.poolCount)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : isSolana ? (
            <section className="rounded-xl border border-dashed border-border bg-card px-4 py-6">
              <h3 className="font-heading text-lg font-medium">
                {asset.volumeCoverage === "hydrate_incomplete"
                  ? "Still hydrating"
                  : asset.volumeCoverage === "no_indexed_pools"
                    ? "Confirmed no indexed pools"
                    : "No indexed Solana pools"}
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {asset.coverageNote ??
                  (asset.volumeCoverage === "hydrate_incomplete"
                    ? "DexScreener lookup has not finished for this mint. Volume is unknown, not zero — not the same as confirmed no pools."
                    : "DexScreener lookup finished and found no indexed Solana pools for this mint. That is the public pair-index ceiling, not zero volume.")}
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
