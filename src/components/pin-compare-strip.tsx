import Link from "next/link";
import { CoverageBadge } from "@/components/coverage-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assetRouteKey } from "@/lib/market/identity";
import { formatUsdCompact } from "@/lib/market/format";
import type { PinCompareAsset } from "@/lib/desk/pin-compare";

export function PinCompareStrip({
  chainId,
  rows,
  catalog,
  hiddenCount = 0,
}: {
  chainId: string;
  rows: readonly PinCompareAsset[];
  catalog: ReadonlyArray<Pick<PinCompareAsset, "symbol" | "contractAddress">>;
  hiddenCount?: number;
}) {
  return (
    <section
      data-testid="solana-pin-compare"
      className="space-y-2 rounded-xl border border-primary/25 bg-primary/6 px-3 py-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-medium">Pinned compare</h3>
          <p className="text-xs text-muted-foreground">
            {rows.length} mint-specific favorites side by side. Not a merged ticker. Volume stays
            null when DexScreener has not reported it.
          </p>
        </div>
        {hiddenCount > 0 ? (
          <p className="text-xs text-muted-foreground">+{hiddenCount} more in Pinned</p>
        ) : null}
      </div>
      <div className="grid gap-2 lg:hidden">
        {rows.map((asset) => (
          <Link
            key={asset.contractAddress}
            href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, catalog))}`}
            prefetch
            className="rounded-lg border border-border bg-background/50 px-3 py-2"
          >
            <p className="font-medium">
              {asset.symbol}
              {asset.instrumentKind === "etf" ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">ETF</span>
              ) : asset.instrumentKind === "private" ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">Private</span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">{asset.issuer ?? "—"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <CoverageBadge coverage={asset.volumeCoverage} />
              <span className="num">{formatUsdCompact(asset.volume24hUsd)}</span>
              <span className="text-muted-foreground">Liq {formatUsdCompact(asset.displayedLiquidityUsd)}</span>
              <span className="text-muted-foreground">{asset.poolCount} pools</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-background/40 lg:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Symbol</TableHead>
              <TableHead>Issuer</TableHead>
              <TableHead>Coverage</TableHead>
              <TableHead className="text-right">24h volume</TableHead>
              <TableHead className="text-right">Displayed liq</TableHead>
              <TableHead className="text-right">Pools</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((asset) => (
              <TableRow key={asset.contractAddress}>
                <TableCell>
                  <Link
                    href={`/chains/${chainId}/assets/${encodeURIComponent(assetRouteKey(asset, catalog))}`}
                    prefetch
                    className="font-medium text-primary hover:underline"
                  >
                    {asset.symbol}
                  </Link>
                  {asset.instrumentKind === "etf" ? (
                    <div className="text-xs text-muted-foreground">ETF / index</div>
                  ) : asset.instrumentKind === "private" ? (
                    <div className="text-xs text-muted-foreground">Private market · {asset.name}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">{asset.name}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{asset.issuer ?? "—"}</TableCell>
                <TableCell>
                  <CoverageBadge coverage={asset.volumeCoverage} />
                </TableCell>
                <TableCell className="num text-right">{formatUsdCompact(asset.volume24hUsd)}</TableCell>
                <TableCell className="num text-right">{formatUsdCompact(asset.displayedLiquidityUsd)}</TableCell>
                <TableCell className="num text-right">{asset.poolCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
