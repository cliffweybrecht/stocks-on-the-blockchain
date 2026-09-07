"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAddress, formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import { compareNullableDesc } from "@/lib/market/numbers";
import type { AssetSummary } from "@/lib/market/types";

type SortKey = "volume24hUsd" | "displayedLiquidityUsd" | "premiumDiscountPct";

export function AssetTable({ assets, chainId }: { assets: AssetSummary[]; chainId: string }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("volume24hUsd");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? assets.filter(
          (asset) =>
            asset.symbol.toLowerCase().includes(needle) ||
            asset.name.toLowerCase().includes(needle) ||
            asset.contractAddress.toLowerCase().includes(needle),
        )
      : assets;

    return [...filtered].sort((a, b) => {
      const compared = compareNullableDesc(a[sortKey], b[sortKey]);
      if (compared !== 0) return compared;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [assets, query, sortKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={query}
          onValueChange={setQuery}
          placeholder="Filter by symbol, name, or contract"
          aria-label="Filter stocks"
          className="max-w-md"
        />
        <div className="flex flex-wrap gap-2 text-xs">
          {(
            [
              ["volume24hUsd", "Volume"],
              ["displayedLiquidityUsd", "Liquidity"],
              ["premiumDiscountPct", "RH vs DEX"],
            ] as const
          ).map(([key, label]) => (
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

      <div className="grid gap-3 lg:hidden">
        {rows.map((asset) => (
          <Link
            key={asset.symbol}
            href={`/chains/${chainId}/assets/${encodeURIComponent(asset.symbol)}`}
            className="block rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{asset.symbol}</p>
                <p className="text-xs text-muted-foreground">{asset.name}</p>
              </div>
              <p className="num text-primary">{formatUsdCompact(asset.volume24hUsd)}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Liq {formatUsdCompact(asset.displayedLiquidityUsd)} · {asset.poolCount} pools ·{" "}
              {formatAddress(asset.contractAddress)}
            </p>
          </Link>
        ))}
      </div>

      <div className="hidden rounded-xl border border-border bg-card lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stock</TableHead>
              <TableHead>Contract</TableHead>
              <TableHead className="text-right">24h volume</TableHead>
              <TableHead className="text-right">Displayed liq</TableHead>
              <TableHead className="text-right">RH mark</TableHead>
              <TableHead className="text-right">DEX median</TableHead>
              <TableHead className="text-right">RH vs DEX</TableHead>
              <TableHead className="text-right">Pools / DEXes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((asset) => (
              <TableRow key={asset.symbol}>
                <TableCell>
                  <Link
                    href={`/chains/${chainId}/assets/${encodeURIComponent(asset.symbol)}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {asset.symbol}
                  </Link>
                  <div className="text-xs text-muted-foreground">{asset.name}</div>
                </TableCell>
                <TableCell className="num text-xs">{formatAddress(asset.contractAddress)}</TableCell>
                <TableCell className="num text-right">{formatUsdCompact(asset.volume24hUsd)}</TableCell>
                <TableCell className="num text-right">{formatUsdCompact(asset.displayedLiquidityUsd)}</TableCell>
                <TableCell className="num text-right">{formatPrice(asset.robinhoodReferencePriceUsd)}</TableCell>
                <TableCell className="num text-right">{formatPrice(asset.dexMedianPriceUsd)}</TableCell>
                <TableCell className="num text-right text-interpretive">
                  {formatPct(asset.premiumDiscountPct)}
                </TableCell>
                <TableCell className="num text-right">
                  {asset.poolCount} / {asset.dexCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No stocks match that filter.
        </p>
      ) : null}
    </div>
  );
}
