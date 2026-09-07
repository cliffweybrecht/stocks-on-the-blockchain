"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type AssetSortKey, assetSortQueryValue, sortAssets } from "@/lib/market/aggregate";
import { assetRouteKey } from "@/lib/market/identity";
import { formatAddress, formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary, InstrumentKind, VolumeCoverage } from "@/lib/market/types";
import {
  type CoverageFilter,
  volumeCoverageLabel,
} from "@/lib/market/volume-coverage";

const SORT_LABELS: Record<AssetSortKey, string> = {
  volume24hUsd: "24h volume",
  displayedLiquidityUsd: "Displayed liq",
  poolCount: "Pools",
  premiumDiscountPct: "RH vs DEX",
};

function coverageVariant(coverage: VolumeCoverage): "default" | "secondary" | "outline" | "destructive" {
  switch (coverage) {
    case "reported":
      return "default";
    case "no_indexed_pools":
      return "secondary";
    case "pools_without_volume":
      return "outline";
    case "hydrate_failed":
      return "destructive";
    case "hydrate_incomplete":
      return "outline";
  }
}

function chipClass(active: boolean): string {
  return `rounded-full border px-3 py-1 text-xs ${
    active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
  }`;
}

function chainHref(
  chainId: string,
  lane: InstrumentKind,
  coverage: CoverageFilter,
  defaultCoverage: CoverageFilter,
  sortKey: AssetSortKey = "volume24hUsd",
): string {
  const params = new URLSearchParams();
  if (lane === "etf") params.set("lane", "etf");
  if (coverage !== defaultCoverage) params.set("coverage", coverage);
  const sortQuery = assetSortQueryValue(sortKey);
  if (sortQuery) params.set("sort", sortQuery);
  const query = params.toString();
  return query ? `/chains/${chainId}?${query}` : `/chains/${chainId}`;
}

function sortHeadClass(active: boolean, align: "left" | "right" = "right"): string {
  return `w-full ${align === "right" ? "text-right" : "text-left"} ${
    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
  }`;
}

export function AssetTable({
  assets,
  chainId,
  totalInLane,
  equityCount,
  etfCount = 0,
  lane = "equity",
  coverageFilter = "all",
  defaultCoverage = "all",
  sortKey = "volume24hUsd",
  showRobinhoodMarks = true,
}: {
  assets: AssetSummary[];
  chainId: string;
  totalInLane: number;
  equityCount: number;
  etfCount?: number;
  lane?: InstrumentKind;
  coverageFilter?: CoverageFilter;
  defaultCoverage?: CoverageFilter;
  sortKey?: AssetSortKey;
  showRobinhoodMarks?: boolean;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? assets.filter(
          (asset) =>
            asset.symbol.toLowerCase().includes(needle) ||
            asset.name.toLowerCase().includes(needle) ||
            asset.contractAddress.toLowerCase().includes(needle) ||
            (asset.issuer ?? "").toLowerCase().includes(needle),
        )
      : assets;

    return sortAssets(filtered, sortKey);
  }, [assets, query, sortKey]);

  const hydratingCount = rows.filter((asset) => asset.volumeCoverage === "hydrate_incomplete").length;
  const sortColumns = (
    [
      ["volume24hUsd", "Volume"],
      ["displayedLiquidityUsd", "Liquidity"],
      ["poolCount", "Pools"],
      ...(showRobinhoodMarks ? ([["premiumDiscountPct", "RH vs DEX"]] as const) : []),
    ] as const
  );

  return (
    <div className="space-y-3">
      {etfCount > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={chainHref(chainId, "equity", coverageFilter, defaultCoverage, sortKey)}
            className={chipClass(lane === "equity")}
          >
            Equities ({equityCount})
          </Link>
          <Link
            href={chainHref(chainId, "etf", coverageFilter, defaultCoverage, sortKey)}
            className={chipClass(lane === "etf")}
          >
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
          placeholder="Filter by symbol, name, issuer, or mint"
          aria-label="Filter stocks"
          className="h-8 w-full max-w-md rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex flex-wrap gap-2 text-xs lg:hidden">
          {sortColumns.map(([key, label]) => (
            <Link
              key={key}
              href={chainHref(chainId, lane, coverageFilter, defaultCoverage, key)}
              className={chipClass(sortKey === key)}
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {(
          [
            ["all", "All"],
            ["with-volume", "With volume"],
            ["with-pools", "With pools"],
            ["no-pools", "No pools yet"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={chainHref(chainId, lane, key, defaultCoverage, sortKey)}
            className={chipClass(coverageFilter === key)}
          >
            {label}
          </Link>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Ranked by {SORT_LABELS[sortKey]}
        {sortKey === "volume24hUsd" ? " (coverage, then volume, liquidity, pools)" : ""} · showing {rows.length} of{" "}
        {totalInLane}
        {coverageFilter !== "all" ? ` · ${coverageFilter.replace("-", " ")}` : ""}
      </p>
      {coverageFilter === "all" && hydratingCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {hydratingCount} still hydrating {hydratingCount === 1 ? "row sits" : "rows sit"} below names with reported
          volume. That volume is unknown, not zero.
        </p>
      ) : null}

      <div className="grid gap-3 lg:hidden">
        {rows.map((asset, index) => (
          <Link
            key={asset.contractAddress}
            href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, assets))}`}
            className="block rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  <span className="num mr-2 text-xs text-muted-foreground">#{index + 1}</span>
                  {asset.symbol}
                </p>
                <p className="text-xs text-muted-foreground">{asset.name}</p>
                {asset.issuer ? <p className="text-xs text-muted-foreground">{asset.issuer}</p> : null}
              </div>
              <p className="num text-primary">{formatUsdCompact(asset.volume24hUsd)}</p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={coverageVariant(asset.volumeCoverage)}>{volumeCoverageLabel(asset.volumeCoverage)}</Badge>
              <span className="text-xs text-muted-foreground">
                Liq {formatUsdCompact(asset.displayedLiquidityUsd)} · {asset.poolCount} pools ·{" "}
                {formatAddress(asset.contractAddress)}
              </span>
            </div>
            {asset.pools.length > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {asset.pools
                  .slice(0, 3)
                  .map((pool) => `${pool.dexId} ${formatUsdCompact(pool.volume24hUsd)}`)
                  .join(" · ")}
                {asset.pools.length > 3 ? ` · +${asset.pools.length - 3}` : ""}
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      <div className="hidden rounded-xl border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-right">#</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Issuer</TableHead>
              <TableHead>Mint</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead className="text-right" aria-sort={sortKey === "volume24hUsd" ? "descending" : "none"}>
                <Link
                  href={chainHref(chainId, lane, coverageFilter, defaultCoverage, "volume24hUsd")}
                  className={sortHeadClass(sortKey === "volume24hUsd")}
                >
                  24h volume{sortKey === "volume24hUsd" ? " ↓" : ""}
                </Link>
              </TableHead>
              <TableHead
                className="text-right"
                aria-sort={sortKey === "displayedLiquidityUsd" ? "descending" : "none"}
              >
                <Link
                  href={chainHref(chainId, lane, coverageFilter, defaultCoverage, "displayedLiquidityUsd")}
                  className={sortHeadClass(sortKey === "displayedLiquidityUsd")}
                >
                  Displayed liq{sortKey === "displayedLiquidityUsd" ? " ↓" : ""}
                </Link>
              </TableHead>
              {showRobinhoodMarks ? (
                <>
                  <TableHead className="text-right">RH mark</TableHead>
                  <TableHead className="text-right">DEX median</TableHead>
                  <TableHead
                    className="text-right"
                    aria-sort={sortKey === "premiumDiscountPct" ? "descending" : "none"}
                  >
                    <Link
                      href={chainHref(chainId, lane, coverageFilter, defaultCoverage, "premiumDiscountPct")}
                      className={sortHeadClass(sortKey === "premiumDiscountPct")}
                    >
                      RH vs DEX{sortKey === "premiumDiscountPct" ? " ↓" : ""}
                    </Link>
                  </TableHead>
                </>
              ) : (
                <TableHead className="text-right">DEX median</TableHead>
              )}
              <TableHead className="text-right" aria-sort={sortKey === "poolCount" ? "descending" : "none"}>
                <Link
                  href={chainHref(chainId, lane, coverageFilter, defaultCoverage, "poolCount")}
                  className={sortHeadClass(sortKey === "poolCount")}
                >
                  Pools / DEXes{sortKey === "poolCount" ? " ↓" : ""}
                </Link>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((asset, index) => (
              <TableRow key={asset.contractAddress}>
                <TableCell className="num text-right text-muted-foreground">{index + 1}</TableCell>
                <TableCell>
                  <Link
                    href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, assets))}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {asset.symbol}
                  </Link>
                  <div className="text-xs text-muted-foreground">{asset.name}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{asset.issuer ?? "—"}</TableCell>
                <TableCell className="num text-xs">{formatAddress(asset.contractAddress)}</TableCell>
                <TableCell>
                  <Badge variant={coverageVariant(asset.volumeCoverage)}>
                    {volumeCoverageLabel(asset.volumeCoverage)}
                  </Badge>
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

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {totalInLane === 0
            ? lane === "etf"
              ? "No verifiable Solana ETF/index products in this snapshot."
              : "No verifiable tokenized equities in this snapshot. Discovery is fail-closed and is not a full Solana index."
            : "No stocks match that filter. Null volume stays hidden when “With volume” is on — it is unknown, not zero."}
        </p>
      ) : null}
    </div>
  );
}
