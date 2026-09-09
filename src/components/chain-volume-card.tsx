import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCount, formatUsdCompact, volumeShare } from "@/lib/market/format";
import { SOLANA_CHAIN_ID, type ChainVolume } from "@/lib/market/types";
import { solanaHydrateProgress } from "@/lib/market/volume-coverage";

export function ChainVolumeCard({
  chain,
  rank,
  maxVolume,
}: {
  chain: ChainVolume;
  rank: number;
  maxVolume: number | null;
}) {
  const share = volumeShare(chain.volume24hUsd, maxVolume);
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const progress = isSolana ? solanaHydrateProgress(chain) : null;

  return (
    <Link href={`/chains/${chain.id}`} prefetch className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="transition-colors hover:bg-accent/40">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <p className="num text-xs text-muted-foreground">#{rank}</p>
            <CardTitle className="mt-1 text-xl">{chain.name}</CardTitle>
            <CardDescription>
              {chain.shortName}
              {chain.nativeChainId ? ` · chain ${chain.nativeChainId}` : ""}
              {` · ${chain.sourceLabel}`}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">24h volume</p>
            <p className="num text-2xl font-medium text-primary">{formatUsdCompact(chain.volume24hUsd)}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
          </div>
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
          {progress ? (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${progress.checkedPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {progress.stillHydrating > 0
                  ? `${formatCount(progress.stillHydrating)} still hydrating DexScreener · ${formatCount(progress.checked)} / ${formatCount(progress.classified)} looked up. Reload to see with-volume rise. Null is unknown, not zero.`
                  : `${formatCount(progress.confirmedNoPools)} confirmed no DexScreener pools (index ceiling, not zero volume).`}
              </p>
            </div>
          ) : null}
          {chain.etfCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatCount(chain.etfCount)} ETF/index products are catalogued on the chain page and are not in this
              equity ranking.
            </p>
          ) : null}
          {chain.privateCount > 0 ? (
            <p className="text-xs text-muted-foreground">
              Private market {formatUsdCompact(chain.privateVolume24hUsd)} 24h across {formatCount(chain.privateCount)}{" "}
              names — labeled separately, not in this public-equity ranking or Daily Volume.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{chain.coverageNote}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
