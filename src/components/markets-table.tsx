import { ExternalLink } from "lucide-react";
import { AssetLogo } from "@/components/asset-logo";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { marketsPairLabel, marketsPoolHref, marketsTokenLogoUrl } from "@/lib/desk/markets-pool";
import { formatAddress, formatCountCompact, formatPct, formatUsdCompact } from "@/lib/market/format";
import type { AssetDetail, AssetPoolMark } from "@/lib/market/types";

function changeTone(value: number | null): "up" | "down" | "flat" | "empty" {
  if (value === null || !Number.isFinite(value)) return "empty";
  if (value === 0) return "flat";
  return value > 0 ? "up" : "down";
}

function MarketsChange({ value }: { value: number | null }) {
  const tone = changeTone(value);
  const toneClass =
    tone === "up" ? "text-price-up" : tone === "down" ? "text-price-down" : "text-muted-foreground";
  return (
    <div className={`num text-xs ${toneClass}`} data-markets-change={tone}>
      {formatPct(value)}
    </div>
  );
}

function MarketsMetric({
  value,
  change,
  format,
}: {
  value: number | null;
  change: number | null;
  format: (value: number | null) => string;
}) {
  return (
    <div className="text-right">
      <div className="num text-sm text-foreground">{format(value)}</div>
      {value !== null || change !== null ? <MarketsChange value={change} /> : null}
    </div>
  );
}

function PairGlyphs({
  pool,
  asset,
}: {
  pool: AssetPoolMark;
  asset: Pick<AssetDetail, "contractAddress" | "logoUrl">;
}) {
  const mintLogo = asset.logoUrl;
  const baseFallback = pool.baseAddress === asset.contractAddress ? mintLogo : null;
  const quoteFallback = pool.quoteAddress === asset.contractAddress ? mintLogo : null;
  const baseLogo = marketsTokenLogoUrl(pool.baseLogoUrl, baseFallback);
  const quoteLogo = marketsTokenLogoUrl(pool.quoteLogoUrl, quoteFallback);
  const baseName = pool.baseName || pool.baseSymbol || "Base";
  const quoteName = pool.quoteName || pool.quoteSymbol || "Quote";
  const baseSymbol = pool.baseSymbol || pool.baseName || "?";
  const quoteSymbol = pool.quoteSymbol || pool.quoteName || "?";

  return (
    <div className="flex shrink-0 items-center" aria-hidden="true">
      <AssetLogo logoUrl={baseLogo} name={baseName} symbol={baseSymbol} size="sm" />
      <div className="-ml-2.5">
        <AssetLogo logoUrl={quoteLogo} name={quoteName} symbol={quoteSymbol} size="sm" />
      </div>
    </div>
  );
}

export function MarketsTable({
  asset,
  pools,
}: {
  asset: Pick<AssetDetail, "contractAddress" | "logoUrl" | "chainId">;
  pools: readonly AssetPoolMark[];
}) {
  return (
    <section className="space-y-3" data-markets>
      <h3 className="font-heading text-lg font-medium">Markets</h3>
      <div className="rounded-2xl bg-card/90 px-1 py-2 sm:px-3 sm:py-3">
        <Table className="min-w-[52rem]">
          <TableHeader className="[&_tr]:border-0">
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead className="w-10 font-normal text-muted-foreground">#</TableHead>
              <TableHead className="font-normal text-muted-foreground">Pair</TableHead>
              <TableHead className="text-right font-normal text-muted-foreground">Liquidity</TableHead>
              <TableHead className="text-right font-normal text-muted-foreground">24h Volume</TableHead>
              <TableHead className="text-right font-normal text-muted-foreground">24h Trades</TableHead>
              <TableHead className="text-right font-normal text-muted-foreground">24h Wallets</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pools.map((pool, index) => {
              const label = marketsPairLabel(pool);
              const href = marketsPoolHref({
                chainId: asset.chainId,
                pairAddress: pool.pairAddress,
                url: pool.url,
              });
              const address = pool.pairAddress.trim();
              const trades = pool.trades24h ?? null;
              const wallets = pool.wallets24h ?? null;

              return (
                <TableRow
                  key={address || `${pool.dexId}-${index}`}
                  className="border-0 hover:bg-muted/20"
                  data-markets-row={address || `${pool.dexId}-${index}`}
                >
                  <TableCell className="num py-3.5 text-muted-foreground">{index + 1}</TableCell>
                  <TableCell className="py-3.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <PairGlyphs pool={pool} asset={asset} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground" data-pair-label>
                          {label ?? "—"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="num truncate">{address ? formatAddress(address) : "—"}</span>
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-muted-foreground hover:text-foreground"
                              aria-label={`Open ${label ?? "pair"} on DexScreener`}
                            >
                              <ExternalLink className="size-3" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="num py-3.5 text-right text-foreground">
                    {formatUsdCompact(pool.liquidityUsd)}
                  </TableCell>
                  <TableCell className="num py-3.5 text-right text-foreground">
                    {formatUsdCompact(pool.volume24hUsd)}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <MarketsMetric
                      value={trades}
                      change={pool.tradesChange24hPct ?? null}
                      format={formatCountCompact}
                    />
                  </TableCell>
                  <TableCell className="py-3.5">
                    <MarketsMetric
                      value={wallets}
                      change={pool.walletsChange24hPct ?? null}
                      format={formatCountCompact}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
