import Link from "next/link";
import { AssetTable } from "@/components/asset-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { SolanaCoverageBanner } from "@/components/solana-coverage-banner";
import { DailyVolumeChart } from "@/components/daily-volume-chart";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";
import { formatCount, formatUsdCompact } from "@/lib/market/format";
import {
  assetMatchesIssuerFilter,
  listIssuerFacets,
  parseIssuerFilter,
} from "@/lib/desk/issuer-filter";
import { toPinCompareAsset } from "@/lib/desk/pin-compare";
import { parseDeskLane } from "@/lib/desk/desk-lane";
import { parsePinnedFilter, solanaChainHref } from "@/lib/desk/solana-chain-href";
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
  searchParams: Promise<{ lane?: string; coverage?: string; sort?: string; pinned?: string; issuer?: string }>;
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

  const { chain, assets, etfAssets = [], privateAssets = [], provenance } = result;
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const volumeHistory = isSolana
    ? await source.getEquityVolumeHistory()
    : emptyEquityVolumeHistory("This chart is Solana tokenized public equities only.");
  const lane = parseDeskLane(query.lane, { etf: etfAssets.length > 0, private: privateAssets.length > 0 });
  const defaultCoverage = isSolana ? "with-volume" : "all";
  const coverageFilter = parseCoverageFilter(query.coverage, defaultCoverage);
  const sortKey = parseAssetSortKey(query.sort);
  const pinnedOnly = parsePinnedFilter(query.pinned);
  const issuerFilter = isSolana ? parseIssuerFilter(query.issuer) : "all";
  const laneAssets = lane === "etf" ? etfAssets : lane === "private" ? privateAssets : assets;
  const issuerFacets = isSolana ? listIssuerFacets(laneAssets) : { issuers: [], unknownCount: 0 };
  const visibleAssets = sortAssets(
    laneAssets.filter(
      (asset) =>
        assetMatchesCoverageFilter(asset, coverageFilter) && assetMatchesIssuerFilter(asset, issuerFilter),
    ),
    sortKey,
  );
  const hydratingCount = laneAssets.filter((asset) => asset.volumeCoverage === "hydrate_incomplete").length;
  const jumpAssets = isSolana ? [...assets, ...etfAssets, ...privateAssets].map(toJumpAsset) : [];
  const catalogRows = [...assets, ...etfAssets, ...privateAssets].map(toPinCompareAsset);

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
          {isSolana ? <SolanaCoverageBanner chain={chain} /> : (
            <p className="mt-1 text-sm text-muted-foreground">{chain.coverageNote}</p>
          )}
        </div>
        {isSolana ? <DailyVolumeChart history={volumeHistory} deskVolume24hUsd={chain.volume24hUsd} /> : null}
        {isSolana && chain.privateCount > 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Private market 24h</span>
            {" · "}
            {formatUsdCompact(chain.privateVolume24hUsd)} across {formatCount(chain.privateCount)} classified
            names. Labeled rollup only — not in public 24h or Daily Volume. Null is unknown, not $0.{" "}
            <Link
              href={solanaChainHref({
                chainId: chain.id,
                lane: "private",
                coverage: coverageFilter,
                defaultCoverage,
                sortKey,
                pinned: pinnedOnly,
                issuer: issuerFilter,
              })}
              className="text-primary hover:underline"
            >
              Open private-market lane
            </Link>
          </p>
        ) : null}
        <ProvenanceBar provenance={provenance} compact />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            label="24h volume"
            value={formatUsdCompact(chain.volume24hUsd)}
            hint={`Public equities only · ${chain.sourceLabel}. ETF and private-market lanes are separate.`}
          />
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
              chain.etfCount > 0 || chain.privateCount > 0
                ? [
                    chain.etfCount > 0 ? `${formatCount(chain.etfCount)} ETF/index` : null,
                    chain.privateCount > 0 ? `${formatCount(chain.privateCount)} private-market` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") + " in separate tabs"
                : `Peak DEX count on one stock: ${formatCount(chain.peakDexCount)}`
            }
          />
        </div>
        {assets.length === 0 && etfAssets.length === 0 && privateAssets.length === 0 ? (
          <EmptyState
            title="No stocks on this chain snapshot"
            detail="The source listed the chain but returned no asset rows. That is an empty snapshot, not zero volume. On Solana this usually means live discovery found no verifiable public equities."
          />
        ) : (
          <AssetTable
            assets={visibleAssets}
            catalogAssets={catalogRows}
            totalInLane={laneAssets.length}
            equityCount={assets.length}
            etfCount={etfAssets.length}
            privateCount={privateAssets.length}
            hydratingCount={hydratingCount}
            lane={lane}
            coverageFilter={coverageFilter}
            defaultCoverage={defaultCoverage}
            sortKey={sortKey}
            pinnedOnly={pinnedOnly}
            issuerFilter={issuerFilter}
            issuerFacets={issuerFacets.issuers}
            unknownIssuerCount={issuerFacets.unknownCount}
            chainId={chain.id}
            showRobinhoodMarks={!isSolana}
            enableFavorites={isSolana}
          />
        )}
      </div>
    </PageShell>
  );
}
