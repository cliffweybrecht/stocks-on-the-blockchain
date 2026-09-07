import Link from "next/link";
import { AssetTable } from "@/components/asset-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { SolanaCoverageBanner } from "@/components/solana-coverage-banner";
import { TrustBanner } from "@/components/trust-banner";
import { formatCount, formatUsdCompact } from "@/lib/market/format";
import { createMarketDataSource } from "@/lib/market/factory";
import { SOLANA_CHAIN_ID } from "@/lib/market/types";

export const dynamic = "force-dynamic";

export default async function ChainPage({
  params,
}: {
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  const source = createMarketDataSource();

  let result;
  try {
    result = await source.getChain(chainId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Chain snapshot failed.";
    return (
      <PageShell>
        <ErrorState title="Could not load this chain" detail={detail} />
      </PageShell>
    );
  }

  if (!result) {
    return (
      <PageShell>
        <EmptyState
          title="That page is not in this desk"
          detail="No chain with that id is in the current snapshot. Use the chain list to move from volume → stocks → a single asset."
        />
      </PageShell>
    );
  }

  const { chain, assets, etfAssets = [], provenance } = result;
  const isSolana = chain.id === SOLANA_CHAIN_ID;

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
          <p className="mt-1 text-sm text-muted-foreground">{chain.sourceLabel}</p>
          <p className="mt-1 text-sm text-muted-foreground">{chain.coverageNote}</p>
        </div>
        <TrustBanner />
        {isSolana ? <SolanaCoverageBanner chain={chain} /> : null}
        <ProvenanceBar provenance={provenance} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="24h volume" value={formatUsdCompact(chain.volume24hUsd)} hint={`Sum of reported 24h volume · ${chain.sourceLabel}`} />
          <Metric
            label="Displayed liquidity"
            value={formatUsdCompact(chain.displayedLiquidityUsd)}
            hint="Provider-reported, not executable"
          />
          <Metric
            label="Classified equities"
            value={formatCount(chain.assetCount)}
            hint={`${formatCount(chain.assetsWithVolume)} with volume · ${formatCount(chain.assetsWithPools)} with pools`}
          />
          <Metric
            label="Reported pools"
            value={formatCount(chain.reportedPoolCount)}
            hint={
              chain.etfCount > 0
                ? `${formatCount(chain.etfCount)} ETF/index products in a separate tab`
                : `Peak DEX count on one stock: ${formatCount(chain.peakDexCount)}`
            }
          />
        </div>
        {assets.length === 0 && etfAssets.length === 0 ? (
          <EmptyState
            title="No stocks on this chain snapshot"
            detail="The source listed the chain but returned no asset rows. That is an empty snapshot, not zero volume. On Solana this usually means live discovery found no verifiable public equities."
          />
        ) : (
          <AssetTable
            assets={assets}
            etfAssets={etfAssets}
            chainId={chain.id}
            showRobinhoodMarks={!isSolana}
          />
        )}
      </div>
    </PageShell>
  );
}
