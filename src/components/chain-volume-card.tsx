import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { chainCombinedVolume24h } from "@/lib/market/aggregate";
import { formatUsdCompact, volumeShare } from "@/lib/market/format";
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
      <Card size="sm" className="transition-colors hover:bg-accent/40">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="num text-[10px] leading-none text-muted-foreground">#{rank}</p>
            <CardTitle className="mt-0.5 text-base">{chain.name}</CardTitle>
          </div>
          <div className="text-right">
            <p className="text-[10px] leading-none tracking-wide text-muted-foreground uppercase">
              {isSolana ? "24h volume · public + private + ETF/index" : "24h volume"}
            </p>
            <p className="num mt-0.5 text-lg font-medium text-primary" data-combined-volume>
              {formatUsdCompact(combinedVolume)}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
          </div>
          {isSolana ? (
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3" data-solana-volume-split>
              <div>
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">Public 24h</dt>
                <dd className="num text-sm font-medium" data-public-volume>
                  {formatUsdCompact(chain.volume24hUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">Private 24h</dt>
                <dd className="num text-sm font-medium" data-private-volume>
                  {formatUsdCompact(chain.privateVolume24hUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">ETF/index 24h</dt>
                <dd className="num text-sm font-medium" data-etf-volume>
                  {formatUsdCompact(chain.etfVolume24hUsd)}
                </dd>
              </div>
            </dl>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
