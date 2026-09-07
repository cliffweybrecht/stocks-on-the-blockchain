"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CoverageBadge } from "@/components/coverage-badge";
import { DeskCsvButton } from "@/components/desk-csv-button";
import { PinButton } from "@/components/pin-button";
import { PinCompareStrip } from "@/components/pin-compare-strip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSolanaFavorites } from "@/components/use-solana-favorites";
import { type AssetSortKey, sortAssets } from "@/lib/market/aggregate";
import { assetMatchesSearch } from "@/lib/market/asset-search";
import { solanaChainHref } from "@/lib/desk/solana-chain-href";
import { assetRouteKey } from "@/lib/market/identity";
import { formatAddress, formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary, InstrumentKind } from "@/lib/market/types";
import { PIN_COMPARE_MAX, selectPinnedCompareRows, shouldShowPinCompare } from "@/lib/desk/pin-compare";
import { type CoverageFilter } from "@/lib/market/volume-coverage";

const SORT_LABELS: Record<AssetSortKey, string> = {
  volume24hUsd: "24h volume",
  displayedLiquidityUsd: "Displayed liq",
  poolCount: "Pools",
  premiumDiscountPct: "RH vs DEX",
};

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs ${
    active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
  }`;
}

function sortHeadClass(active: boolean, align: "left" | "right" = "right"): string {
  return `w-full ${align === "right" ? "text-right" : "text-left"} ${
    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
  }`;
}

function emptyCopy(input: {
  totalInLane: number;
  lane: InstrumentKind;
  query: string;
  pinnedOnly: boolean;
  coverageFilter: CoverageFilter;
}): string {
  if (input.totalInLane === 0) {
    return input.lane === "etf"
      ? "No verifiable Solana ETF/index products in this snapshot."
      : "No verifiable tokenized equities in this snapshot. Discovery is fail-closed and is not a full Solana index.";
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
    return "No stocks with reported DexScreener volume in this snapshot. Null volume stays hidden here because it is unknown, not zero.";
  }
  if (input.coverageFilter === "hydrating") {
    return "Nothing is still hydrating. DexScreener lookup finished for this snapshot.";
  }
  if (input.coverageFilter === "no-pools") {
    return "No confirmed-empty mints in this lane. Still-hydrating names live under Still hydrating, not here.";
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
  hydratingCount = 0,
  lane = "equity",
  coverageFilter = "all",
  defaultCoverage = "all",
  sortKey = "volume24hUsd",
  pinnedOnly = false,
  showRobinhoodMarks = true,
  enableFavorites = false,
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
  hydratingCount?: number;
  lane?: InstrumentKind;
  coverageFilter?: CoverageFilter;
  defaultCoverage?: CoverageFilter;
  sortKey?: AssetSortKey;
  pinnedOnly?: boolean;
  showRobinhoodMarks?: boolean;
  enableFavorites?: boolean;
}) {
  const [query, setQuery] = useState("");
  const favorites = useSolanaFavorites();
  const catalog = catalogAssets ?? assets;

  const hrefFor = (
    next: Partial<{
      lane: InstrumentKind;
      coverage: CoverageFilter;
      sortKey: AssetSortKey;
      pinned: boolean;
    }> = {},
  ) =>
    solanaChainHref({
      chainId,
      lane: next.lane ?? lane,
      coverage: next.coverage ?? coverageFilter,
      defaultCoverage,
      sortKey: next.sortKey ?? sortKey,
      pinned: next.pinned ?? pinnedOnly,
    });

  const rows = useMemo(() => {
    const searched = query.trim() ? assets.filter((asset) => assetMatchesSearch(asset, query)) : assets;
    const scoped = pinnedOnly ? searched.filter((asset) => favorites.favoriteSet.has(asset.contractAddress)) : searched;
    const sorted = sortAssets(scoped, sortKey);
    if (pinnedOnly || !enableFavorites || favorites.favoriteSet.size === 0) return sorted;
    const pins = sorted.filter((asset) => favorites.favoriteSet.has(asset.contractAddress));
    const rest = sorted.filter((asset) => !favorites.favoriteSet.has(asset.contractAddress));
    return [...pins, ...rest];
  }, [assets, enableFavorites, favorites.favoriteSet, pinnedOnly, query, sortKey]);

  const compareRows = useMemo(() => {
    if (!enableFavorites) return [];
    return selectPinnedCompareRows(catalog, favorites.favoriteMints, PIN_COMPARE_MAX);
  }, [catalog, enableFavorites, favorites.favoriteMints]);
  const compareHidden = Math.max(0, favorites.favoriteMints.length - compareRows.length);
  const hydratingVisible = rows.filter((asset) => asset.volumeCoverage === "hydrate_incomplete").length;
  const sortColumns = (
    [
      ["volume24hUsd", "Volume"],
      ["displayedLiquidityUsd", "Liquidity"],
      ["poolCount", "Pools"],
      ...(showRobinhoodMarks ? ([["premiumDiscountPct", "RH vs DEX"]] as const) : []),
    ] as const
  );

  const coverageChips: Array<[CoverageFilter, string]> = [
    ["all", "All"],
    ["with-volume", "With volume"],
    ["with-pools", "With pools"],
    ["hydrating", hydratingCount > 0 ? `Still hydrating (${hydratingCount})` : "Still hydrating"],
    ["no-pools", "Confirmed no pools"],
  ];

  return (
    <div className="space-y-3">
      {etfCount > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Link href={hrefFor({ lane: "equity" })} scroll={false} className={chipClass(lane === "equity")}>
            Equities ({equityCount})
          </Link>
          <Link href={hrefFor({ lane: "etf" })} scroll={false} className={chipClass(lane === "etf")}>
            ETF / index ({etfCount})
          </Link>
        </div>
      ) : null}
      {lane === "etf" ? (
        <p className="text-xs text-muted-foreground">
          ETF and index products are catalogued here and are not mixed into the public-equity ranking.
        </p>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Filter this list · / jumps to an asset"
          aria-label="Filter stocks in this list"
          className="h-8 w-full max-w-md rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          {enableFavorites ? (
            <DeskCsvButton rows={rows} lane={lane} coverage={coverageFilter} sortKey={sortKey} />
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs lg:hidden">
            {sortColumns.map(([key, label]) => (
              <Link key={key} href={hrefFor({ sortKey: key })} scroll={false} className={chipClass(sortKey === key)}>
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
      {enableFavorites && shouldShowPinCompare(compareRows) ? (
        <PinCompareStrip
          chainId={chainId}
          rows={compareRows}
          catalog={catalog}
          hiddenCount={compareHidden}
        />
      ) : null}
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
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Ranked by {SORT_LABELS[sortKey]}
        {sortKey === "volume24hUsd" ? " (coverage, then volume, liquidity, pools)" : ""}
        {enableFavorites && !pinnedOnly ? " · pinned float to the top" : ""} · showing {rows.length} of {totalInLane}
        {coverageFilter !== "all" ? ` · ${coverageFilter.replace("-", " ")}` : ""}
        {pinnedOnly ? " · pinned" : ""}
      </p>
      {hydratingVisible > 0 ? (
        <p className="text-xs text-amber-200/90">
          {hydratingVisible} {hydratingVisible === 1 ? "row is" : "rows are"} still hydrating DexScreener
          {coverageFilter === "with-volume"
            ? " and will appear under With volume once a pair reports 24h volume. Reload to pick up background enrichment."
            : " — that is not the same as confirmed no pools. Volume is unknown, not zero."}
        </p>
      ) : coverageFilter === "no-pools" ? (
        <p className="text-xs text-muted-foreground">
          Confirmed no pools means DexScreener lookup finished empty. It is not still hydrating, and it is not zero
          volume.
        </p>
      ) : null}

      {rows.length > 0 ? (
      <div className="grid gap-2 lg:hidden">
        {rows.map((asset, index) => (
          <div key={asset.contractAddress} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, catalog))}`}
                prefetch
                className="min-w-0 flex-1"
              >
                <p className="font-medium">
                  <span className="num mr-2 text-xs text-muted-foreground">#{index + 1}</span>
                  {asset.symbol}
                </p>
                <p className="truncate text-xs text-muted-foreground">{asset.name}</p>
                {asset.issuer ? <p className="text-xs text-muted-foreground">{asset.issuer}</p> : null}
              </Link>
              <div className="flex items-center gap-1">
                <p className="num text-sm text-primary">{formatUsdCompact(asset.volume24hUsd)}</p>
                {enableFavorites ? (
                  <PinButton
                    pinned={favorites.isFavorite(asset.contractAddress)}
                    label={asset.symbol}
                    onToggle={() => favorites.toggle(asset.contractAddress)}
                  />
                ) : null}
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <CoverageBadge coverage={asset.volumeCoverage} />
              <span className="text-xs text-muted-foreground">
                Liq {formatUsdCompact(asset.displayedLiquidityUsd)} · {asset.poolCount} pools ·{" "}
                {formatAddress(asset.contractAddress)}
              </span>
            </div>
          </div>
        ))}
      </div>
      ) : null}

      {rows.length > 0 ? (
      <div className="hidden rounded-xl border border-border bg-card lg:block">
        <Table containerClassName="max-h-[min(70vh,42rem)] overflow-auto">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky top-0 z-20 w-12 bg-card text-right">#</TableHead>
              {enableFavorites ? <TableHead className="sticky top-0 z-20 w-10 bg-card" /> : null}
              <TableHead className="sticky top-0 z-20 bg-card">Stock</TableHead>
              <TableHead className="sticky top-0 z-20 bg-card">Issuer</TableHead>
              <TableHead className="sticky top-0 z-20 bg-card">Mint</TableHead>
              <TableHead className="sticky top-0 z-20 bg-card">Coverage</TableHead>
              <TableHead
                className="sticky top-0 z-20 bg-card text-right"
                aria-sort={sortKey === "volume24hUsd" ? "descending" : "none"}
              >
                <Link href={hrefFor({ sortKey: "volume24hUsd" })} className={sortHeadClass(sortKey === "volume24hUsd")}>
                  24h volume{sortKey === "volume24hUsd" ? " ↓" : ""}
                </Link>
              </TableHead>
              <TableHead
                className="sticky top-0 z-20 bg-card text-right"
                aria-sort={sortKey === "displayedLiquidityUsd" ? "descending" : "none"}
              >
                <Link
                  href={hrefFor({ sortKey: "displayedLiquidityUsd" })}
                  className={sortHeadClass(sortKey === "displayedLiquidityUsd")}
                >
                  Displayed liq{sortKey === "displayedLiquidityUsd" ? " ↓" : ""}
                </Link>
              </TableHead>
              {showRobinhoodMarks ? (
                <>
                  <TableHead className="sticky top-0 z-20 bg-card text-right">RH mark</TableHead>
                  <TableHead className="sticky top-0 z-20 bg-card text-right">DEX median</TableHead>
                  <TableHead
                    className="sticky top-0 z-20 bg-card text-right"
                    aria-sort={sortKey === "premiumDiscountPct" ? "descending" : "none"}
                  >
                    <Link
                      href={hrefFor({ sortKey: "premiumDiscountPct" })}
                      className={sortHeadClass(sortKey === "premiumDiscountPct")}
                    >
                      RH vs DEX{sortKey === "premiumDiscountPct" ? " ↓" : ""}
                    </Link>
                  </TableHead>
                </>
              ) : (
                <TableHead className="sticky top-0 z-20 bg-card text-right">DEX median</TableHead>
              )}
              <TableHead
                className="sticky top-0 z-20 bg-card text-right"
                aria-sort={sortKey === "poolCount" ? "descending" : "none"}
              >
                <Link href={hrefFor({ sortKey: "poolCount" })} className={sortHeadClass(sortKey === "poolCount")}>
                  Pools / DEXes{sortKey === "poolCount" ? " ↓" : ""}
                </Link>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((asset, index) => (
              <TableRow key={asset.contractAddress}>
                <TableCell className="num text-right text-muted-foreground">{index + 1}</TableCell>
                {enableFavorites ? (
                  <TableCell>
                    <PinButton
                      pinned={favorites.isFavorite(asset.contractAddress)}
                      label={asset.symbol}
                      onToggle={() => favorites.toggle(asset.contractAddress)}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Link
                    href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, catalog))}`}
                    prefetch
                    className="font-medium text-primary hover:underline"
                  >
                    {asset.symbol}
                  </Link>
                  <div className="text-xs text-muted-foreground">{asset.name}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{asset.issuer ?? "—"}</TableCell>
                <TableCell className="num text-xs">{formatAddress(asset.contractAddress)}</TableCell>
                <TableCell>
                  <CoverageBadge coverage={asset.volumeCoverage} />
                </TableCell>
                <TableCell className="num text-right">{formatUsdCompact(asset.volume24hUsd)}</TableCell>
                <TableCell className="num text-right">{formatUsdCompact(asset.displayedLiquidityUsd)}</TableCell>
                {showRobinhoodMarks ? (
                  <>
                    <TableCell className="num text-right">{formatPrice(asset.robinhoodReferencePriceUsd)}</TableCell>
                    <TableCell className="num text-right">{formatPrice(asset.dexMedianPriceUsd)}</TableCell>
                    <TableCell className="num text-right text-interpretive">
                      {formatPct(asset.premiumDiscountPct)}
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="num text-right">{formatPrice(asset.dexMedianPriceUsd)}</TableCell>
                )}
                <TableCell className="num text-right">
                  <div>
                    {asset.poolCount} / {asset.dexCount}
                  </div>
                  {asset.pools.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {asset.pools
                        .slice(0, 2)
                        .map((pool) => `${pool.dexId} ${formatUsdCompact(pool.volume24hUsd)}`)
                        .join(" · ")}
                      {asset.pools.length > 2 ? ` · +${asset.pools.length - 2}` : ""}
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyCopy({ totalInLane, lane, query, pinnedOnly, coverageFilter })}
        </p>
      ) : null}
    </div>
  );
}
