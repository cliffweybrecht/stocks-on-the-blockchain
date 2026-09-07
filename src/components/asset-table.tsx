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
import { assetRouteKey } from "@/lib/market/identity";
import { formatAddress, formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import { compareNullableDesc } from "@/lib/market/numbers";
import type { AssetSummary, InstrumentKind, VolumeCoverage } from "@/lib/market/types";
import { volumeCoverageLabel } from "@/lib/market/volume-coverage";

type SortKey = "volume24hUsd" | "displayedLiquidityUsd" | "poolCount" | "premiumDiscountPct";
type CoverageFilter = "all" | "with-volume" | "no-pools" | "with-pools";

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

export function AssetTable({
  assets,
  chainId,
  etfAssets = [],
  showRobinhoodMarks = true,
}: {
  assets: AssetSummary[];
  chainId: string;
  etfAssets?: AssetSummary[];
  showRobinhoodMarks?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volume24hUsd");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");
  const [lane, setLane] = useState<InstrumentKind>("equity");

  const source = lane === "etf" && etfAssets.length > 0 ? etfAssets : assets;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = source.filter((asset) => {
      if (coverageFilter === "with-volume" && asset.volume24hUsd === null) return false;
      if (coverageFilter === "no-pools" && asset.poolCount > 0) return false;
      if (coverageFilter === "with-pools" && asset.poolCount === 0) return false;
      if (!needle) return true;
      return (
        asset.symbol.toLowerCase().includes(needle) ||
        asset.name.toLowerCase().includes(needle) ||
        asset.contractAddress.toLowerCase().includes(needle) ||
        (asset.issuer ?? "").toLowerCase().includes(needle)
      );
    });

    return [...filtered].sort((a, b) => {
      const left = sortKey === "poolCount" ? a.poolCount : a[sortKey];
      const right = sortKey === "poolCount" ? b.poolCount : b[sortKey];
      const compared =
        sortKey === "poolCount"
          ? (right as number) - (left as number)
          : compareNullableDesc(left as number | null, right as number | null);
      if (compared !== 0) return compared;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [source, query, sortKey, coverageFilter]);

  const sortButtons = (
    [
      ["volume24hUsd", "Volume"],
      ["displayedLiquidityUsd", "Liquidity"],
      ["poolCount", "Pools"],
      ...(showRobinhoodMarks ? ([["premiumDiscountPct", "RH vs DEX"]] as const) : []),
    ] as const
  );

  return (
    <div className="space-y-3">
      {etfAssets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLane("equity")}
            className={`rounded-full border px-3 py-1 text-xs ${
              lane === "equity" ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            Equities ({assets.length})
          </button>
          <button
            type="button"
            onClick={() => setLane("etf")}
            className={`rounded-full border px-3 py-1 text-xs ${
              lane === "etf" ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            ETF / index ({etfAssets.length})
          </button>
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
        <div className="flex flex-wrap gap-2 text-xs">
          {sortButtons.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortKey(key)}
              className={`rounded-full border px-3 py-1 ${
                sortKey === key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              Sort: {label}
            </button>
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
          <button
            key={key}
            type="button"
            onClick={() => setCoverageFilter(key)}
            className={`rounded-full border px-3 py-1 ${
              coverageFilter === key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {rows.length} of {source.length}
        {coverageFilter !== "all" ? ` · ${coverageFilter.replace("-", " ")}` : ""}
      </p>

      <div className="grid gap-3 lg:hidden">
        {rows.map((asset) => (
          <Link
            key={asset.contractAddress}
            href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, source))}`}
            className="block rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{asset.symbol}</p>
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
              <TableHead>Stock</TableHead>
              <TableHead>Issuer</TableHead>
              <TableHead>Mint</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead className="text-right">24h volume</TableHead>
              <TableHead className="text-right">Displayed liq</TableHead>
              {showRobinhoodMarks ? (
                <>
                  <TableHead className="text-right">RH mark</TableHead>
                  <TableHead className="text-right">DEX median</TableHead>
                  <TableHead className="text-right">RH vs DEX</TableHead>
                </>
              ) : (
                <TableHead className="text-right">DEX median</TableHead>
              )}
              <TableHead className="text-right">Pools / DEXes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((asset) => (
              <TableRow key={asset.contractAddress}>
                <TableCell>
                  <Link
                    href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, source))}`}
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
          {source.length === 0
            ? lane === "etf"
              ? "No verifiable Solana ETF/index products in this snapshot."
              : "No verifiable tokenized equities in this snapshot. Discovery is fail-closed and is not a full Solana index."
            : "No stocks match that filter. Null volume stays hidden when “With volume” is on — it is unknown, not zero."}
        </p>
      ) : null}
    </div>
  );
}
