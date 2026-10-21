"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DeskCsvButton } from "@/components/desk-csv-button";
import { DeskHeaderActions } from "@/components/desk-header-actions";
import { useDeskVolumeRange } from "@/components/desk-volume-range";
import { EquityCard } from "@/components/equity-card";
import { PinCompareStrip } from "@/components/pin-compare-strip";
import { useSolanaFavorites } from "@/components/use-solana-favorites";
import { type AssetSortKey, sortAssets } from "@/lib/market/aggregate";
import { compareByEquityCardMarketValue, equityCardMarketValueForRange } from "@/lib/market/onchain-market-value";
import {
  compareByEquityCardRangeLiquidity,
  equityCardLiquidityForRange,
} from "@/lib/market/equity-card-range-liquidity";
import type { VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import { equityCardPriceForRange } from "@/lib/market/equity-card-range-price";
import {
  compareByEquityCardRangeVolume,
  equityCardRangeAddressKey,
  equityCardRangeTotal,
  equityCardVolumeSeriesForRange,
} from "@/lib/market/equity-card-range-volume";
import { assetMatchesSearch } from "@/lib/market/asset-search";
import { deskSortOptions } from "@/lib/desk/desk-sort";
import { isMarketValueHidden } from "@/lib/site/visibility";
import { solanaChainHref } from "@/lib/desk/solana-chain-href";
import {
  ALL_ISSUERS,
  UNKNOWN_ISSUER,
  issuerFilterLabel,
  type IssuerFacet,
  type IssuerFilter,
} from "@/lib/desk/issuer-filter";
import { assetRouteKey } from "@/lib/market/identity";
import type { AssetSummary, InstrumentKind, VolumeHistoryPoint } from "@/lib/market/types";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "@/lib/market/types";
import { PIN_COMPARE_MAX, selectPinnedCompareRows, shouldShowPinCompare } from "@/lib/desk/pin-compare";
import { type CoverageFilter } from "@/lib/market/volume-coverage";

const CARD_VOLUME_POLL_MS = 4_000;
const CARD_VOLUME_POLL_ATTEMPTS = 100;

const SORT_LABELS: Record<AssetSortKey, string> = {
  volume24hUsd: "24h volume",
  displayedLiquidityUsd: "Displayed liq",
  marketValueUsd: "Market value",
  poolCount: "Pools",
  premiumDiscountPct: "RH vs DEX",
};

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs ${
    active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
  }`;
}

function emptyCopy(input: {
  totalInLane: number;
  lane: InstrumentKind;
  query: string;
  pinnedOnly: boolean;
  coverageFilter: CoverageFilter;
  issuerFilter: IssuerFilter;
  chainId: string;
}): string {
  const robinhood = input.chainId === ROBINHOOD_CHAIN_ID;
  if (input.totalInLane === 0) {
    if (robinhood) {
      if (input.lane === "etf") return "No Robinhood Chain ETF/index names in this snapshot.";
      if (input.lane === "private") {
        return "No Robinhood Chain private-market names in this snapshot.";
      }
      return "No Robinhood Chain equities in this snapshot.";
    }
    if (input.lane === "etf") return "No verifiable Solana ETF/index products in this snapshot.";
    if (input.lane === "private") {
      return "No verifiable Solana private-market / PreStocks names in this snapshot. Discovery is fail-closed and does not invent mints.";
    }
    return "No verifiable tokenized equities in this snapshot. Discovery is fail-closed and is not a full Solana index.";
  }
  if (input.query.trim()) {
    return "No classified names match that search. Try symbol, issuer, or the full mint. Null volume is not hidden by search.";
  }
  if (input.pinnedOnly && input.coverageFilter === "hydrating") {
    return "None of your pinned names are still hydrating. Turn off Pinned to see every unfinished DexScreener lookup, or wait for a snapshot that still has hydrating rows.";
  }
  if (input.pinnedOnly && input.coverageFilter === "no-pools") {
    return "None of your pinned names finished DexScreener lookup empty. Confirmed no pools is not still hydrating, and it is not zero volume.";
  }
  if (input.pinnedOnly) {
    return "No pinned Solana names in this view. Pin a row with the star, or switch coverage to All — pins are mint-specific, not ticker-merged.";
  }
  if (input.coverageFilter === "with-volume") {
    return robinhood
      ? "No Robinhood Chain names with reported DexScreener volume in this snapshot. Null volume stays hidden here because it is unknown, not zero."
      : "No stocks with reported DexScreener volume in this snapshot. Null volume stays hidden here because it is unknown, not zero.";
  }
  if (input.coverageFilter === "hydrating") {
    return "Nothing is still hydrating. DexScreener lookup finished for this snapshot.";
  }
  if (input.coverageFilter === "no-pools") {
    return "No confirmed-empty mints in this lane. Unfinished DexScreener lookups are not listed here.";
  }
  if (input.issuerFilter === UNKNOWN_ISSUER) {
    return "No stocks with an unknown issuer in this view. Choose All issuers, or another named issuer chip.";
  }
  if (input.issuerFilter !== ALL_ISSUERS) {
    return "No stocks match that issuer in this view. Choose All issuers, or another issuer present in this lane.";
  }
  return "No stocks match that filter.";
}

export function AssetTable({
  assets,
  catalogAssets,
  chainId,
  totalInLane,
  equityCount,
  etfCount = 0,
  privateCount = 0,
  lane = "equity",
  coverageFilter = "all",
  defaultCoverage = "all",
  sortKey = "volume24hUsd",
  pinnedOnly = false,
  issuerFilter = ALL_ISSUERS,
  issuerFacets = [],
  unknownIssuerCount = 0,
  etfChipVisible,
  privateChipVisible,
  showRobinhoodMarks = true,
  enableFavorites = false,
  rangeViews,
}: {
  assets: AssetSummary[];
  catalogAssets?: Array<
    Pick<
      AssetSummary,
      | "symbol"
      | "name"
      | "issuer"
      | "contractAddress"
      | "volume24hUsd"
      | "displayedLiquidityUsd"
      | "poolCount"
      | "volumeCoverage"
      | "instrumentKind"
    >
  >;
  chainId: string;
  totalInLane: number;
  equityCount: number;
  etfCount?: number;
  privateCount?: number;
  lane?: InstrumentKind;
  coverageFilter?: CoverageFilter;
  defaultCoverage?: CoverageFilter;
  sortKey?: AssetSortKey;
  pinnedOnly?: boolean;
  issuerFilter?: IssuerFilter;
  issuerFacets?: readonly IssuerFacet[];
  unknownIssuerCount?: number;
  /** Lane exists in the catalog. The parenthesis count can be 0 when the list view filters it out. */
  etfChipVisible?: boolean;
  privateChipVisible?: boolean;
  showRobinhoodMarks?: boolean;
  enableFavorites?: boolean;
  /**
   * BNB Chain windows. When set, the grid, lane counts, and issuer chips follow the
   * selected 24H/7D/14D/30D range instead of one fixed registry list.
   */
  rangeViews?: Partial<
    Record<
      VolumeChartRangeId,
      {
        addresses: readonly string[];
        equityCount: number;
        etfCount: number;
        privateCount: number;
        issuerFacets: readonly IssuerFacet[];
        unknownIssuerCount: number;
      }
    >
  >;
}) {
  const [query, setQuery] = useState("");
  const [dayVolumeByMint, setDayVolumeByMint] = useState<Record<string, VolumeHistoryPoint[]>>({});
  const favorites = useSolanaFavorites();
  const catalog = catalogAssets ?? assets;
  const deskRange = useDeskVolumeRange("24h");
  const rangeView = rangeViews?.[deskRange.range] ?? null;
  const rangeAddresses = useMemo(() => {
    if (!rangeView) return null;
    return new Set(rangeView.addresses.map((address) => equityCardRangeAddressKey(address)));
  }, [rangeView]);
  const equityCountShown = rangeView?.equityCount ?? equityCount;
  const etfCountShown = rangeView?.etfCount ?? etfCount;
  const privateCountShown = rangeView?.privateCount ?? privateCount;
  const issuerFacetsShown = rangeView?.issuerFacets ?? issuerFacets;
  const unknownIssuerCountShown = rangeView?.unknownIssuerCount ?? unknownIssuerCount;

  useEffect(() => {
    if (chainId !== SOLANA_CHAIN_ID) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = (attempt: number) => {
      void fetch("/api/solana/card-volume-series", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { series?: Record<string, VolumeHistoryPoint[]>; pending?: boolean } | null) => {
          if (cancelled || !payload?.series || typeof payload.series !== "object" || Array.isArray(payload.series)) {
            return;
          }
          setDayVolumeByMint(payload.series);
          if (payload.pending && attempt < CARD_VOLUME_POLL_ATTEMPTS) {
            timer = setTimeout(() => poll(attempt + 1), CARD_VOLUME_POLL_MS);
          }
        })
        .catch(() => {
          if (!cancelled && attempt < CARD_VOLUME_POLL_ATTEMPTS) {
            timer = setTimeout(() => poll(attempt + 1), CARD_VOLUME_POLL_MS);
          }
        });
    };
    poll(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [chainId]);

  const marketValueHidden = isMarketValueHidden();
  const activeSortKey = marketValueHidden && sortKey === "marketValueUsd" ? "volume24hUsd" : sortKey;
  const hrefFor = (
    next: Partial<{
      lane: InstrumentKind;
      coverage: CoverageFilter;
      sortKey: AssetSortKey;
      pinned: boolean;
      issuer: IssuerFilter;
    }> = {},
  ) =>
    solanaChainHref({
      chainId,
      lane: next.lane ?? lane,
      coverage: next.coverage ?? coverageFilter,
      defaultCoverage,
      sortKey: next.sortKey ?? activeSortKey,
      pinned: next.pinned ?? pinnedOnly,
      issuer: next.issuer ?? issuerFilter,
    });
  const solanaDesk = chainId === SOLANA_CHAIN_ID;
  /** Solana, Robinhood Chain, Base, and BNB Chain share the Volume | Liquidity | Market value strip. */
  const marketsDesk = solanaDesk || chainId === ROBINHOOD_CHAIN_ID || chainId === BASE_CHAIN_ID || chainId === BNB_CHAIN_ID;
  const showIssuerFilter = (marketsDesk || enableFavorites) && (issuerFacetsShown.length > 0 || unknownIssuerCountShown > 0);
  const activeIssuerLabel = issuerFilterLabel(issuerFilter, issuerFacetsShown);

  const rows = useMemo(() => {
    const inWindow = rangeAddresses
      ? assets.filter((asset) => rangeAddresses.has(equityCardRangeAddressKey(asset.contractAddress)))
      : assets;
    const searched = query.trim() ? inWindow.filter((asset) => assetMatchesSearch(asset, query)) : inWindow;
    const scoped = pinnedOnly ? searched.filter((asset) => favorites.favoriteSet.has(asset.contractAddress)) : searched;
    const range = deskRange.range;
    const liquidityMode = activeSortKey === "displayedLiquidityUsd";
    const marketMode = activeSortKey === "marketValueUsd";
    const sorted = marketMode
      ? [...scoped].sort((a, b) => compareByEquityCardMarketValue(a, b, deskRange.marketValue, range))
      : liquidityMode
        ? [...scoped].sort((a, b) => compareByEquityCardRangeLiquidity(a, b, deskRange.liquidity, range))
        : activeSortKey === "volume24hUsd" && range !== "24h"
          ? [...scoped].sort((a, b) => compareByEquityCardRangeVolume(a, b, deskRange.volumes, range))
          : sortAssets(scoped, activeSortKey);
    if (pinnedOnly || !enableFavorites || favorites.favoriteSet.size === 0) return sorted;
    const pins = sorted.filter((asset) => favorites.favoriteSet.has(asset.contractAddress));
    const rest = sorted.filter((asset) => !favorites.favoriteSet.has(asset.contractAddress));
    return [...pins, ...rest];
  }, [
    assets,
    deskRange.liquidity,
    deskRange.marketValue,
    deskRange.range,
    deskRange.volumes,
    enableFavorites,
    favorites.favoriteSet,
    pinnedOnly,
    query,
    rangeAddresses,
    activeSortKey,
  ]);

  const compareRows = useMemo(() => {
    if (!enableFavorites) return [];
    return selectPinnedCompareRows(catalog, favorites.favoriteMints, PIN_COMPARE_MAX);
  }, [catalog, enableFavorites, favorites.favoriteMints]);
  const compareHidden = Math.max(0, favorites.favoriteMints.length - compareRows.length);
  const hydratingVisible = rows.filter((asset) => asset.volumeCoverage === "hydrate_incomplete").length;
  const sortColumns = deskSortOptions({
    solanaDesk: marketsDesk,
    showRobinhoodMarks,
    includeMarketValue: !marketValueHidden,
  });

  const coverageChips: Array<[CoverageFilter, string]> = [
    ["all", "All"],
    ["with-volume", "With volume"],
    ["no-pools", "Confirmed no pools"],
  ];

  const showEtfChip = etfChipVisible ?? etfCountShown > 0;
  const showPrivateChip = privateChipVisible ?? privateCountShown > 0;
  const laneChips =
    showEtfChip || showPrivateChip ? (
      <div className="flex flex-wrap gap-2">
        <Link href={hrefFor({ lane: "equity" })} scroll={false} className={chipClass(lane === "equity")}>
          Equities ({equityCountShown})
        </Link>
        {showEtfChip ? (
          <Link href={hrefFor({ lane: "etf" })} scroll={false} className={chipClass(lane === "etf")}>
            ETF / index ({etfCountShown})
          </Link>
        ) : null}
        {showPrivateChip ? (
          <Link href={hrefFor({ lane: "private" })} scroll={false} className={chipClass(lane === "private")}>
            Private market ({privateCountShown})
          </Link>
        ) : null}
      </div>
    ) : null;

  const issuerChips = showIssuerFilter ? (
    <div className="flex flex-wrap gap-2 text-xs" aria-label="Filter by issuer">
      <Link href={hrefFor({ issuer: ALL_ISSUERS })} scroll={false} className={chipClass(issuerFilter === ALL_ISSUERS)}>
        All issuers
      </Link>
      {issuerFacetsShown.map((facet) => (
        <Link
          key={facet.slug}
          href={hrefFor({ issuer: facet.slug })}
          scroll={false}
          className={chipClass(issuerFilter === facet.slug)}
        >
          {facet.label} ({facet.count})
        </Link>
      ))}
      {unknownIssuerCountShown > 0 ? (
        <Link
          href={hrefFor({ issuer: UNKNOWN_ISSUER })}
          scroll={false}
          className={chipClass(issuerFilter === UNKNOWN_ISSUER)}
        >
          Unknown ({unknownIssuerCountShown})
        </Link>
      ) : null}
    </div>
  ) : null;

  const sortChips = (
    <div className={`flex flex-wrap gap-2 text-xs ${solanaDesk ? "shrink-0 justify-end" : ""}`} data-desk-sort>
      {sortColumns.map(([key, label]) => (
        <Link key={key} href={hrefFor({ sortKey: key })} scroll={false} className={chipClass(activeSortKey === key)}>
          {label}
        </Link>
      ))}
    </div>
  );

  return (
    <div className="space-y-3" data-markets-desk={marketsDesk ? chainId : undefined}>
      {marketsDesk ? (
        <div className="flex items-start justify-between gap-x-3 gap-y-1" data-filter-strip>
          {laneChips || issuerChips ? (
            <div className="flex min-w-0 flex-col gap-1" data-lane-issuers>
              {laneChips}
              {issuerChips}
            </div>
          ) : (
            <div className="min-w-0" data-lane-issuers />
          )}
          {sortChips}
        </div>
      ) : laneChips || issuerChips ? (
        <div className="flex flex-col gap-2" data-lane-issuers>
          {laneChips}
          {issuerChips}
        </div>
      ) : null}
      {lane === "etf" ? (
        <p className="text-xs text-muted-foreground">
          {chainId === ROBINHOOD_CHAIN_ID
            ? "ETF and index products on Robinhood Chain are listed here and are not mixed into the public-equity ranking."
            : chainId === BASE_CHAIN_ID
              ? "ETF and index products on Base are listed here and are not mixed into the public-equity ranking."
              : chainId === BNB_CHAIN_ID
                ? "ETF and index products on BNB Chain are listed here and are not mixed into the public-equity ranking."
                : "ETF and index products are catalogued here and are not mixed into the public-equity ranking."}
        </p>
      ) : null}
      {lane === "private" ? (
        <p className="text-xs text-muted-foreground">
          {chainId === ROBINHOOD_CHAIN_ID
            ? "Private-market names on Robinhood Chain stay in this lane. They are not mixed into the public-equity ranking."
            : chainId === BASE_CHAIN_ID
              ? "Private-market names on Base stay in this lane. They are not mixed into the public-equity ranking."
              : chainId === BNB_CHAIN_ID
                ? "Private-market names on BNB Chain stay in this lane. They are not mixed into the public-equity ranking."
                : "Private-market, PreStocks, and Tessera T-Token names are catalogued here. Volume is DexScreener 24h per mint across Solana pools. This lane is not mixed into public-equity ranking; reported 24h is included in the Daily Volume headline."}
        </p>
      ) : null}
      {marketsDesk ? null : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter this list · / jumps to an asset"
            aria-label="Filter stocks in this list"
            className="h-8 w-full max-w-md rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {sortChips}
        </div>
      )}
      {enableFavorites ? (
        <DeskHeaderActions>
          <DeskCsvButton rows={rows} lane={lane} coverage={coverageFilter} sortKey={activeSortKey} />
        </DeskHeaderActions>
      ) : null}
      {enableFavorites && shouldShowPinCompare(compareRows) ? (
        <PinCompareStrip
          chainId={chainId}
          rows={compareRows}
          catalog={catalog}
          hiddenCount={compareHidden}
        />
      ) : null}
      {marketsDesk ? null : (
        <div className="flex flex-wrap gap-2 text-xs">
          {coverageChips.map(([key, label]) => (
            <Link key={key} href={hrefFor({ coverage: key })} scroll={false} className={chipClass(coverageFilter === key)}>
              {label}
            </Link>
          ))}
          {enableFavorites ? (
            <Link href={hrefFor({ pinned: !pinnedOnly })} scroll={false} className={chipClass(pinnedOnly)}>
              Pinned{favorites.ready && favorites.favoriteMints.length > 0 ? ` (${favorites.favoriteMints.length})` : ""}
            </Link>
          ) : null}
        </div>
      )}
      {marketsDesk ? null : (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Ranked by {SORT_LABELS[activeSortKey]}
          {activeSortKey === "volume24hUsd" ? " (coverage, then volume, liquidity, pools)" : ""}
          {enableFavorites && !pinnedOnly ? " · pinned float to the top" : ""} · showing {rows.length} of {totalInLane}
          {coverageFilter !== "all" ? ` · ${coverageFilter.replace("-", " ")}` : ""}
          {activeIssuerLabel ? ` · ${activeIssuerLabel}` : ""}
          {pinnedOnly ? " · pinned" : ""}
        </p>
      )}
      {hydratingVisible > 0 ? (
        <p className="text-xs text-amber-200/90">
          {hydratingVisible} {hydratingVisible === 1 ? "row is" : "rows are"} still hydrating DexScreener
          {coverageFilter === "with-volume"
            ? " and will appear under With volume once a pair reports 24h volume. Reload to pick up background enrichment."
            : " — that is not the same as confirmed no pools. Volume is unknown, not zero."}
        </p>
      ) : !marketsDesk && coverageFilter === "no-pools" ? (
        <p className="text-xs text-muted-foreground">
          Confirmed no pools means DexScreener lookup finished empty. It is not still hydrating, and it is not zero
          volume.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((asset) => {
            const liquidityMode = activeSortKey === "displayedLiquidityUsd";
            const marketMode = activeSortKey === "marketValueUsd";
            const closedRange =
              marketMode || liquidityMode || deskRange.range === "24h" ? null : deskRange.range;
            const total = closedRange ? equityCardRangeTotal(deskRange.volumes, asset.contractAddress, closedRange) : null;
            const liquidity = liquidityMode
              ? equityCardLiquidityForRange(deskRange.liquidity, asset.contractAddress, deskRange.range)
              : null;
            const market = marketMode
              ? equityCardMarketValueForRange(deskRange.marketValue, asset.contractAddress, deskRange.range)
              : null;
            const rangePrice = equityCardPriceForRange(deskRange.prices, asset.contractAddress, deskRange.range);
            const volumePoints =
              marketMode || liquidityMode
                ? []
                : equityCardVolumeSeriesForRange(deskRange.volumeSeries, asset.contractAddress, deskRange.range);
            return (
              <EquityCard
                key={asset.contractAddress}
                asset={asset}
                href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, catalog))}`}
                sortKey={activeSortKey}
                dayVolumeSeries={dayVolumeByMint[asset.contractAddress]}
                rangeVolume={
                  closedRange
                    ? { id: closedRange, volumeUsd: total?.volumeUsd ?? null, days: total?.days ?? 0 }
                    : null
                }
                rangeLiquidity={
                  liquidityMode
                    ? {
                        id: deskRange.range,
                        liquidityUsd: liquidity?.liquidityUsd ?? null,
                        days: liquidity?.days ?? 0,
                        series: liquidity?.series ?? [],
                      }
                    : null
                }
                rangeMarketValue={
                  marketMode
                    ? {
                        id: deskRange.range,
                        marketValueUsd: market?.marketValueUsd ?? null,
                        days: market?.days ?? 0,
                        recorded: market !== null,
                        series: market?.series ?? [],
                      }
                    : null
                }
                rangePrice={
                  rangePrice
                    ? {
                        priceUsd: rangePrice.priceUsd,
                        changePct: rangePrice.changePct,
                        series: rangePrice.series,
                      }
                    : null
                }
                rangeVolumeSeries={volumePoints.map((point) => ({
                  t: point.t,
                  volumeUsd: point.volumeUsd,
                  kind: "calendar_day" as const,
                }))}
                enableFavorites={enableFavorites}
                pinned={favorites.isFavorite(asset.contractAddress)}
                onTogglePin={() => favorites.toggle(asset.contractAddress)}
              />
            );
          })}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyCopy({
            totalInLane: rangeView ? rangeView.addresses.length : totalInLane,
            lane,
            query,
            pinnedOnly,
            coverageFilter,
            issuerFilter,
            chainId,
          })}
        </p>
      ) : null}
    </div>
  );
}
