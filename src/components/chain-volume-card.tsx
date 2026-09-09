import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { chainCombinedVolume24h } from "@/lib/market/aggregate";
import { formatCount, formatUsdCompact, volumeShare } from "@/lib/market/format";
import { SOLANA_CHAIN_ID, type ChainVolume } from "@/lib/market/types";

export function ChainVolumeCard({
  chain,
  rank,
  maxVolume,
}: {
  chain: ChainVolume;
  rank: number;
  maxVolume: number | null;
}) {
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const combinedVolume = chainCombinedVolume24h(chain);
  const share = volumeShare(combinedVolume, maxVolume);

  return (
    <Link href={`/chains/${chain.id}`} prefetch className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="transition-colors hover:bg-accent/40">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <p className="num text-xs text-muted-foreground">#{rank}</p>
            <CardTitle className="mt-1 text-xl">{chain.name}</CardTitle>
          </div>
          <div className="text-right">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {isSolana ? "24h volume · public + private" : "24h volume"}
            </p>
            <p className="num text-2xl font-medium text-primary" data-combined-volume>
              {formatUsdCompact(combinedVolume)}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
          </div>
          {isSolana ? (
            <dl className="grid grid-cols-2 gap-3 text-sm" data-solana-volume-split>
              <div>
                <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Public 24h</dt>
                <dd className="num mt-0.5 text-lg font-medium" data-public-volume>
                  {formatUsdCompact(chain.volume24hUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Private 24h</dt>
                <dd className="num mt-0.5 text-lg font-medium" data-private-volume>
                  {formatUsdCompact(chain.privateVolume24hUsd)}
                </dd>
              </div>
            </dl>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Displayed liquidity</dt>
              <dd className="num mt-0.5">{formatUsdCompact(chain.displayedLiquidityUsd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Classified</dt>
              <dd className="num mt-0.5">{formatCount(chain.assetCount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">With volume</dt>
              <dd className="num mt-0.5">{formatCount(chain.assetsWithVolume)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">With pools</dt>
              <dd className="num mt-0.5">{formatCount(chain.assetsWithPools)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </Link>
  );
}
