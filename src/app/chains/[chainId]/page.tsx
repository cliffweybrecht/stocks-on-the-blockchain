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
import { parsePinnedFilter } from "@/lib/desk/solana-chain-href";
import { parseAssetSortKey, sortAssets } from "@/lib/market/aggregate";
import { toJumpAsset } from "@/lib/market/asset-search";
import { createMarketDataSource } from "@/lib/market/factory";
import { SOLANA_CHAIN_ID } from "@/lib/market/types";
import { assetMatchesCoverageFilter, parseCoverageFilter } from "@/lib/market/volume-coverage";

export const dynamic = "force-dynamic";

export default async function ChainPage({
  params,
  searchParams,
}: {
  params: Promise<{ chainId: string }>;
  searchParams: Promise<{ lane?: string; coverage?: string; sort?: string; pinned?: string }>;
}) {
  const { chainId } = await params;
  const query = await searchParams;
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
  const lane = query.lane === "etf" && etfAssets.length > 0 ? "etf" : "equity";
  const defaultCoverage = isSolana ? "with-volume" : "all";
  const coverageFilter = parseCoverageFilter(query.coverage, defaultCoverage);
  const sortKey = parseAssetSortKey(query.sort);
  const pinnedOnly = parsePinnedFilter(query.pinned);
  const laneAssets = lane === "etf" ? etfAssets : assets;
  const visibleAssets = sortAssets(
    laneAssets.filter((asset) => assetMatchesCoverageFilter(asset, coverageFilter)),
    sortKey,
  );
  const hydratingCount = laneAssets.filter((asset) => asset.volumeCoverage === "hydrate_incomplete").length;
  const jumpAssets = isSolana ? [...assets, ...etfAssets].map(toJumpAsset) : [];
  const catalogKeys = laneAssets.map((asset) => ({
    symbol: asset.symbol,
    contractAddress: asset.contractAddress,
  }));

  return (
    <PageShell
      provenance={provenance}
      solanaJump={jumpAssets.length > 0 ? { chainId, assets: jumpAssets } : undefined}
    >
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
          {isSolana ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Press <kbd className="rounded border border-border px-1 font-mono">/</kbd> or{" "}
              <kbd className="rounded border border-border px-1 font-mono">⌘K</kbd> to jump by symbol, name,
              issuer, or mint. Star a row to pin it in this browser.
            </p>
          ) : null}
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
            hint={`${formatCount(chain.assetsWithVolume)} with volume so far · ${formatCount(chain.assetsWithPools)} with pools · ${formatCount(chain.assetsWithNoIndexedPools)} no DexScreener pools${chain.assetsStillHydrating > 0 ? ` · ${formatCount(chain.assetsStillHydrating)} still hydrating` : ""}`}
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
            assets={visibleAssets}
            catalogAssets={catalogKeys}
            totalInLane={laneAssets.length}
            equityCount={assets.length}
            etfCount={etfAssets.length}
            hydratingCount={hydratingCount}
            lane={lane}
            coverageFilter={coverageFilter}
            defaultCoverage={defaultCoverage}
            sortKey={sortKey}
            pinnedOnly={pinnedOnly}
            chainId={chain.id}
            showRobinhoodMarks={!isSolana}
            enableFavorites={isSolana}
          />
        )}
      </div>
    </PageShell>
  );
}
