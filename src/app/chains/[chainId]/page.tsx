import Link from "next/link";
import { AssetTable } from "@/components/asset-table";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { Metric } from "@/components/metric";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { DailyVolumeChart } from "@/components/daily-volume-chart";
import { RobinhoodVolumeDesk } from "@/components/robinhood-volume-desk";
import { SnapshotVolumeDesk } from "@/components/snapshot-volume-desk";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";
import { formatCount, formatUsdCompact } from "@/lib/market/format";
import { loadClosedRobinhoodDeskDays } from "@/lib/market/robinhood-desk-volume-file";
import { robinhoodSnapshotChainShell } from "@/lib/market/robinhood-desk-volume";
import { loadRobinhoodChainMarkets, robinhoodCatalogCount } from "@/lib/market/robinhood-chain-markets";
import { BASE_DESK } from "@/lib/market/base-desk-volume";
import { baseCatalogCount, loadBaseChainMarkets } from "@/lib/market/base-chain-markets";
import { BNB_DESK } from "@/lib/market/bnb-desk-volume";
import { bnbCatalogCount, loadBnbChainMarkets } from "@/lib/market/bnb-chain-markets";
import { snapshotDeskChainShell } from "@/lib/market/snapshot-desk-volume";
import {
  overlayTerminalReference,
  robinhoodLanesFromTerminal,
  type RobinhoodMarketLanes,
} from "@/lib/market/robinhood-markets";
import { parseIssuerFilter } from "@/lib/desk/issuer-filter";
import { toPinCompareAsset } from "@/lib/desk/pin-compare";
import { displayedIssuerFacets, displayedLaneCount, assetsMatchingListView } from "@/lib/desk/displayed-list-counts";
import { parseDeskLane } from "@/lib/desk/desk-lane";
import { resolveDeskSortKey } from "@/lib/desk/desk-sort";
import { parsePinnedFilter } from "@/lib/desk/solana-chain-href";
import { selectEquityPriceTicker } from "@/lib/desk/price-ticker";
import { parseAssetSortKey, sortAssets } from "@/lib/market/aggregate";
import { toJumpAsset } from "@/lib/market/asset-search";
import { createMarketDataSource } from "@/lib/market/factory";
import { findSnapshotDesk, loadClosedSnapshotDeskDays } from "@/lib/market/snapshot-desk-volume-file";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type AssetSummary, type EquityVolumeHistoryResult } from "@/lib/market/types";
import { parseCoverageFilter } from "@/lib/market/volume-coverage";

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
  const snapshotDesk = findSnapshotDesk(chainId);
  if (snapshotDesk && snapshotDesk.chainId !== BASE_CHAIN_ID && snapshotDesk.chainId !== BNB_CHAIN_ID) {
    const days = await loadClosedSnapshotDeskDays(snapshotDesk);
    return (
      <PageShell>
        <div className="space-y-5">
          <div>
            <h2 className="font-heading text-2xl font-semibold tracking-tight">{snapshotDesk.name}</h2>
          </div>
          <SnapshotVolumeDesk desk={{ chainId: snapshotDesk.chainId, name: snapshotDesk.name }} days={days} />
          <EmptyState
            title={`No ${snapshotDesk.name} markets catalog`}
            detail={`Volume bars above are recorded DexScreener samples from ${snapshotDesk.file}. A Solana-style name list is not on this desk, so missing cards are not zero volume.`}
          />
        </div>
      </PageShell>
    );
  }
  const source = createMarketDataSource();
  const requestedRobinhood = chainId === ROBINHOOD_CHAIN_ID;
  const requestedBase = chainId === BASE_CHAIN_ID;
  const requestedBnb = chainId === BNB_CHAIN_ID;
  const robinhoodNames = requestedRobinhood
    ? loadRobinhoodChainMarkets().then(
        (catalog) => ({ catalog, error: null as string | null }),
        (error: unknown) => ({
          catalog: null,
          error: error instanceof Error ? error.message : "Robinhood Chain names did not load.",
        }),
      )
    : null;
  const baseNames = requestedBase
    ? loadBaseChainMarkets().then(
        (catalog) => ({ catalog, error: null as string | null }),
        (error: unknown) => ({
          catalog: null,
          error: error instanceof Error ? error.message : "Base names did not load.",
        }),
      )
    : null;
  const bnbNames = requestedBnb
    ? loadBnbChainMarkets().then(
        (catalog) => ({ catalog, error: null as string | null }),
        (error: unknown) => ({
          catalog: null,
          error: error instanceof Error ? error.message : "BNB Chain names did not load.",
        }),
      )
    : null;

  let result;
  let listError: string | null = null;
  try {
    result = await source.getChain(chainId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Chain snapshot failed.";
    if (!requestedRobinhood && !requestedBase && !requestedBnb) {
      return (
        <PageShell>
          <ErrorState title="Could not load this chain" detail={detail} />
        </PageShell>
      );
    }
    listError = detail;
    result = null;
  }

  if (!result && !requestedRobinhood && !requestedBase && !requestedBnb) {
    return (
      <PageShell>
        <EmptyState
          title="That page is not in this desk"
          detail="No chain with that id is in the current snapshot. Use the chain list to move from volume → stocks → a single asset."
        />
      </PageShell>
    );
  }

  const hideSeedNames =
    (requestedRobinhood || requestedBase || requestedBnb) && result?.provenance.sourceId === "mock";
  const chain =
    result && !hideSeedNames
      ? result.chain
      : requestedBase
        ? snapshotDeskChainShell(BASE_DESK)
        : requestedBnb
          ? snapshotDeskChainShell(BNB_DESK)
          : robinhoodSnapshotChainShell();
  let assets = result && !hideSeedNames ? result.assets : [];
  let etfAssets = result && !hideSeedNames ? (result.etfAssets ?? []) : [];
  let privateAssets = result && !hideSeedNames ? (result.privateAssets ?? []) : [];
  let provenance = result && !hideSeedNames && !requestedBase && !requestedBnb ? result.provenance : undefined;
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const isRobinhood = chain.id === ROBINHOOD_CHAIN_ID;
  const isBase = chain.id === BASE_CHAIN_ID;
  const isBnb = chain.id === BNB_CHAIN_ID;
  let robinhoodVolumeHydrated = false;
  let baseVolumeHydrated = false;
  let bnbVolumeHydrated = false;
  if (isRobinhood && robinhoodNames) {
    const loaded = await robinhoodNames;
    const terminalRows = [...assets, ...etfAssets, ...privateAssets];
    if (loaded.catalog && robinhoodCatalogCount(loaded.catalog) > 0) {
      const lanes = overlayLanes(loaded.catalog, terminalRows);
      assets = lanes.assets;
      etfAssets = lanes.etfAssets;
      privateAssets = lanes.privateAssets;
      robinhoodVolumeHydrated = loaded.catalog.volumeHydrated;
      listError = null;
    } else if (terminalRows.length > 0) {
      const lanes = robinhoodLanesFromTerminal(terminalRows);
      assets = lanes.assets;
      etfAssets = lanes.etfAssets;
      privateAssets = lanes.privateAssets;
    } else if (loaded.error) {
      listError = loaded.error;
    }
  }
  if (isBase && baseNames) {
    const loaded = await baseNames;
    if (loaded.catalog && baseCatalogCount(loaded.catalog) > 0) {
      assets = loaded.catalog.assets;
      etfAssets = loaded.catalog.etfAssets;
      privateAssets = loaded.catalog.privateAssets;
      baseVolumeHydrated = loaded.catalog.volumeHydrated;
      provenance = loaded.catalog.provenance;
      listError = null;
    } else if (loaded.error) {
      listError = loaded.error;
    }
  }
  if (isBnb && bnbNames) {
    const loaded = await bnbNames;
    if (loaded.catalog && bnbCatalogCount(loaded.catalog) > 0) {
      assets = loaded.catalog.assets;
      etfAssets = loaded.catalog.etfAssets;
      privateAssets = loaded.catalog.privateAssets;
      bnbVolumeHydrated = loaded.catalog.volumeHydrated;
      provenance = loaded.catalog.provenance;
      listError = null;
    } else if (loaded.error) {
      listError = loaded.error;
    }
  }
  const robinhoodDays = isRobinhood ? await loadClosedRobinhoodDeskDays() : [];
  const baseDays = isBase ? await loadClosedSnapshotDeskDays(BASE_DESK) : [];
  const bnbDays = isBnb ? await loadClosedSnapshotDeskDays(BNB_DESK) : [];
  let volumeHistory: EquityVolumeHistoryResult;
  let hourlyVolumeHistory: EquityVolumeHistoryResult | null = null;
  if (isSolana) {
    [volumeHistory, hourlyVolumeHistory] = await Promise.all([
      source.getEquityVolumeHistory(),
      source.getEquityHourlyRollingVolumeHistory(),
    ]);
  } else {
    volumeHistory = emptyEquityVolumeHistory("This chart is Solana tokenized public equities only.");
  }
  if (isSolana) {
    void source.getEquityCardDayVolumeSeries();
  }
  const lane = parseDeskLane(query.lane, { etf: etfAssets.length > 0, private: privateAssets.length > 0 });
  const marketsDesk = isSolana || isRobinhood || isBase || isBnb;
  const reportedVolume = [...assets, ...etfAssets, ...privateAssets].some((asset) => asset.volume24hUsd !== null);
  const defaultCoverage =
    isSolana ||
    (isRobinhood && robinhoodVolumeHydrated && reportedVolume) ||
    (isBase && baseVolumeHydrated && reportedVolume) ||
    (isBnb && bnbVolumeHydrated && reportedVolume)
      ? "with-volume"
      : "all";
  const coverageFilter = parseCoverageFilter(query.coverage, defaultCoverage);
  const sortKey = resolveDeskSortKey(parseAssetSortKey(query.sort), marketsDesk);
  const pinnedOnly = parsePinnedFilter(query.pinned);
  const issuerFilter = marketsDesk ? parseIssuerFilter(query.issuer) : "all";
  const laneAssets = lane === "etf" ? etfAssets : lane === "private" ? privateAssets : assets;
  const issuerFacets = marketsDesk
    ? displayedIssuerFacets(laneAssets, coverageFilter)
    : { issuers: [], unknownCount: 0 };
  const visibleAssets = sortAssets(assetsMatchingListView(laneAssets, coverageFilter, issuerFilter), sortKey);
  const jumpAssets = marketsDesk ? [...assets, ...etfAssets, ...privateAssets].map(toJumpAsset) : [];
  const catalogRows = [...assets, ...etfAssets, ...privateAssets].map(toPinCompareAsset);

  return (
    <PageShell
      provenance={provenance}
      solanaJump={jumpAssets.length > 0 ? { chainId, assets: jumpAssets } : undefined}
      priceTicker={selectEquityPriceTicker(assets)}
    >
      <div className="space-y-5">
        {isSolana || isRobinhood || isBase || isBnb ? null : (
          <nav className="text-sm text-muted-foreground" data-chain-breadcrumb>
            <Link href="/" className="hover:text-foreground">
              Chains
            </Link>
            <span className="px-2">/</span>
            <span className="text-foreground">{chain.name}</span>
          </nav>
        )}
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">{chain.name}</h2>
          {isSolana || isRobinhood || isBase || isBnb ? null : <p className="mt-1 text-sm text-muted-foreground">{chain.sourceLabel}</p>}
        </div>
        {isSolana ? (
          <DailyVolumeChart
            history={volumeHistory}
            hourlyHistory={hourlyVolumeHistory}
            rolling24h={{
              publicVolume24hUsd: chain.volume24hUsd,
              privateVolume24hUsd: chain.privateVolume24hUsd,
              etfVolume24hUsd: chain.etfVolume24hUsd,
            }}
          />
        ) : isRobinhood ? (
          <RobinhoodVolumeDesk days={robinhoodDays} />
        ) : isBase ? (
          <SnapshotVolumeDesk desk={{ chainId: BASE_DESK.chainId, name: BASE_DESK.name }} days={baseDays} />
        ) : isBnb ? (
          <SnapshotVolumeDesk desk={{ chainId: BNB_DESK.chainId, name: BNB_DESK.name }} days={bnbDays} />
        ) : provenance ? (
          <>
            <ProvenanceBar provenance={provenance} compact />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="24h volume"
                value={formatUsdCompact(chain.volume24hUsd)}
                hint={`Sum of reported 24h volume · ${chain.sourceLabel}`}
              />
              <Metric
                label="Displayed liquidity"
                value={formatUsdCompact(chain.displayedLiquidityUsd)}
                hint="Provider-reported, not executable"
              />
              <Metric
                label="Classified equities"
                value={formatCount(chain.assetCount)}
                hint={`${formatCount(chain.assetsWithVolume)} with volume so far · ${formatCount(chain.assetsWithPools)} with pools`}
              />
              <Metric
                label="Reported pools"
                value={formatCount(chain.reportedPoolCount)}
                hint={`Peak DEX count on one stock: ${formatCount(chain.peakDexCount)}`}
              />
            </div>
          </>
        ) : null}
        {assets.length === 0 && etfAssets.length === 0 && privateAssets.length === 0 ? (
          <EmptyState
            title={
              isRobinhood
                ? "No Robinhood Chain names in this snapshot"
                : isBase
                  ? "No Base names in this snapshot"
                  : isBnb
                    ? "No BNB Chain names in this snapshot"
                    : "No stocks on this chain snapshot"
            }
            detail={
              isRobinhood
                ? listError
                  ? `Volume bars above are recorded DexScreener samples. The stock list did not load (${listError}). That is a missing list, not zero volume.`
                  : "Volume bars above are recorded DexScreener samples from robinhood.json. Names come from the RHJ registry and DexScreener on chain 4663. An empty list is not zero volume."
                : isBase
                  ? listError
                    ? `Volume bars above are recorded DexScreener samples. The stock list did not load (${listError}). That is a missing list, not zero volume.`
                    : "Volume bars above are recorded DexScreener samples from base.json. Names come from Coinbase, ST0x, Centrifuge, Dinari, Backed, and Anchored on Base. An empty list is not zero volume."
                  : isBnb
                    ? listError
                      ? `Volume bars above are recorded DexScreener samples. The stock list did not load (${listError}). That is a missing list, not zero volume.`
                      : "Volume bars above are recorded DexScreener samples from bnb.json. Names come from Stocks On Chain, xStocks, bStocks, Colb, and Paimon on BNB Chain. An empty list is not zero volume."
                    : "The source listed the chain but returned no asset rows. That is an empty snapshot, not zero volume. On Solana this usually means live discovery found no verifiable public equities."
            }
          />
        ) : (
          <AssetTable
            assets={visibleAssets}
            catalogAssets={catalogRows}
            totalInLane={laneAssets.length}
            equityCount={displayedLaneCount(assets, coverageFilter, issuerFilter)}
            etfCount={displayedLaneCount(etfAssets, coverageFilter, issuerFilter)}
            privateCount={displayedLaneCount(privateAssets, coverageFilter, issuerFilter)}
            etfChipVisible={etfAssets.length > 0}
            privateChipVisible={privateAssets.length > 0}
            lane={lane}
            coverageFilter={coverageFilter}
            defaultCoverage={defaultCoverage}
            sortKey={sortKey}
            pinnedOnly={pinnedOnly}
            issuerFilter={issuerFilter}
            issuerFacets={issuerFacets.issuers}
            unknownIssuerCount={issuerFacets.unknownCount}
            chainId={chain.id}
            showRobinhoodMarks={!marketsDesk}
            enableFavorites={marketsDesk}
          />
        )}
      </div>
    </PageShell>
  );
}

function overlayLanes(lanes: RobinhoodMarketLanes, terminal: readonly AssetSummary[]): RobinhoodMarketLanes {
  return {
    assets: overlayTerminalReference(lanes.assets, terminal),
    etfAssets: overlayTerminalReference(lanes.etfAssets, terminal),
    privateAssets: overlayTerminalReference(lanes.privateAssets, terminal),
    details: overlayTerminalReference(lanes.details, terminal),
  };
}
