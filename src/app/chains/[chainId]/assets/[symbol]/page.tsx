import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyAddress } from "@/components/copy-address";
import { ErrorState } from "@/components/error-state";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { TrustBanner } from "@/components/trust-banner";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatPct, formatPrice, formatRelativeTime, formatUsdCompact, formatUsdFull } from "@/lib/market/format";
import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

export default async function AssetPage({
  params,
}: {
  params: Promise<{ chainId: string; symbol: string }>;
}) {
  const { chainId, symbol } = await params;
  const source = createMarketDataSource();

  let result;
  try {
    result = await source.getAsset(chainId, decodeURIComponent(symbol));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Asset snapshot failed.";
    return (
      <PageShell>
        <ErrorState title="Could not load this stock" detail={detail} />
      </PageShell>
    );
  }

  if (!result) notFound();

  const { chain, asset, provenance } = result;
  const halt = asset.price.isTradingHalt;

    return (
      <PageShell provenance={provenance}>
        <div className="space-y-5">
          <nav className="text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Chains
            </Link>
            <span className="px-2">/</span>
            <Link href={`/chains/${chain.id}`} className="hover:text-foreground">
              {chain.name}
            </Link>
            <span className="px-2">/</span>
            <span className="text-foreground">{asset.symbol}</span>
          </nav>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs tracking-[0.18em] text-primary uppercase">{chain.name}</p>
              <h2 className="font-heading text-3xl font-semibold tracking-tight">{asset.symbol}</h2>
              <p className="mt-1 text-muted-foreground">{asset.name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{provenance.sourceId === "mock" ? "Demo row" : "Terminal row"}</Badge>
              {asset.detailEnriched ? <Badge variant="secondary">Enriched detail</Badge> : null}
              {halt ? <Badge variant="destructive">Trading halt reported</Badge> : null}
            </div>
          </div>

          <TrustBanner />
          <ProvenanceBar provenance={provenance} />

          <section className="space-y-3">
            <h3 className="font-heading text-lg font-medium">Identity</h3>
            <CopyAddress address={asset.contractAddress} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="24h volume" value={formatUsdCompact(asset.volume24hUsd)} hint="observedVolume24h" />
            <Metric
              label="Displayed liquidity"
              value={formatUsdCompact(asset.displayedLiquidityUsd)}
              hint="Not executable size"
            />
            <Metric label="USDG displayed liq" value={formatUsdCompact(asset.usdGLiquidityUsd)} />
            <Metric
              label="Pools / DEXes"
              value={`${formatCount(asset.poolCount)} / ${formatCount(asset.dexCount)}`}
            />
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
              label="DEX median"
              value={formatPrice(asset.price.dexMedianUsd)}
              hint="Median of usable pool prices"
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
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="RH bid" value={formatPrice(asset.price.robinhoodBidUsd)} />
            <Metric label="RH ask" value={formatPrice(asset.price.robinhoodAskUsd)} />
            <Metric label="DEX liq-weighted" value={formatPrice(asset.price.dexLiquidityWeightedUsd)} />
            <Metric label="Largest-pool price" value={formatPrice(asset.price.dexLargestPoolUsd)} />
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="24h buys" value={formatCount(asset.buys24h)} />
            <Metric label="24h sells" value={formatCount(asset.sells24h)} />
            <Metric
              label="Top-3 concentration"
              value={formatPct(asset.concentration.top3Pct)}
              hint="Share of displayed liquidity"
            />
            <Metric
              label="Largest pool"
              value={
                asset.largestPool
                  ? `${asset.largestPool.dexId} · ${formatUsdCompact(asset.largestPool.liquidityUsd)}`
                  : "—"
              }
            />
          </section>

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
