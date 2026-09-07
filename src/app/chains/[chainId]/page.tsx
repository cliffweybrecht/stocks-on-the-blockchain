import Link from "next/link";
import { notFound } from "next/navigation";
import { AssetTable } from "@/components/asset-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { TrustBanner } from "@/components/trust-banner";
import { formatCount, formatUsdCompact } from "@/lib/market/format";
import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

export default async function ChainPage({
  params,
}: {
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;

  try {
    const source = createMarketDataSource();
    const result = await source.getChain(chainId);
    if (!result) notFound();

    const { chain, assets, provenance } = result;

    return (
      <PageShell provenance={provenance}>
        <div className="space-y-5">
          <nav className="text-sm text-muted-foreground">
            <Link href="/" className="hover:text-foreground">
              Chains
            </Link>
            <span className="px-2">/</span>
            <span className="text-foreground">{chain.name}</span>
          </nav>
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">{chain.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{chain.coverageNote}</p>
          </div>
          <TrustBanner />
          <ProvenanceBar provenance={provenance} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="24h volume" value={formatUsdCompact(chain.volume24hUsd)} hint="Sum of reported observedVolume24h" />
            <Metric
              label="Displayed liquidity"
              value={formatUsdCompact(chain.displayedLiquidityUsd)}
              hint="Provider-reported, not executable"
            />
            <Metric label="Stocks in snapshot" value={formatCount(chain.assetCount)} />
            <Metric
              label="Reported pools"
              value={formatCount(chain.reportedPoolCount)}
              hint={`Peak DEX count on one stock: ${formatCount(chain.peakDexCount)}`}
            />
          </div>
          {assets.length === 0 ? (
            <EmptyState
              title="No stocks on this chain snapshot"
              detail="The source listed the chain but returned no asset rows. That is an empty snapshot, not zero volume."
            />
          ) : (
            <AssetTable assets={assets} chainId={chain.id} />
          )}
        </div>
      </PageShell>
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Chain snapshot failed.";
    return (
      <PageShell>
        <ErrorState title="Could not load this chain" detail={detail} />
      </PageShell>
    );
  }
}
