import Link from "next/link";
import { cn } from "cn";
import { chainCombinedVolume24h } from "@/lib/market/aggregate";
import { formatUsdCompact, volumeShare } from "@/lib/market/format";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type ChainVolume } from "@/lib/market/types";

/**
 * One track list for the header and every chain bubble.
 * Subgrid rows inherit these tracks, so rank, name, volume, and lanes stay lined up across the card.
 */
export const CHAIN_VOLUME_TRACKS =
  "grid-cols-[2.75rem_minmax(11rem,1.35fr)_minmax(9rem,1.2fr)_minmax(7rem,1fr)_minmax(7.25rem,1fr)_minmax(8.5rem,1.1fr)]";

const HEADER_LABEL = "min-w-0 text-xs font-normal text-muted-foreground";

export interface ChainVolumeRow {
  chain: ChainVolume;
  rank: number;
  maxVolume: number | null;
}

export function ChainVolumeHeader() {
  return (
    <div
      className="col-span-full grid grid-cols-subgrid items-center px-4"
      data-chain-volume-header
    >
      <div className={HEADER_LABEL}>#</div>
      <div className={HEADER_LABEL}>Chain</div>
      <div className={cn(HEADER_LABEL, "text-right")}>24H Volume</div>
      <div className={cn(HEADER_LABEL, "text-right")}>Public 24H</div>
      <div className={cn(HEADER_LABEL, "text-right")}>Private 24H</div>
      <div className={cn(HEADER_LABEL, "text-right")}>ETF/Index 24H</div>
    </div>
  );
}

export function ChainVolumeCard({ chain, rank, maxVolume }: ChainVolumeRow) {
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const showLanes =
    isSolana || chain.id === ROBINHOOD_CHAIN_ID || chain.id === BASE_CHAIN_ID || chain.id === BNB_CHAIN_ID;
  const combinedVolume = chainCombinedVolume24h(chain);
  const share = volumeShare(combinedVolume, maxVolume);

  return (
    <Link
      href={`/chains/${chain.id}`}
      prefetch
      data-chain-id={chain.id}
      data-chain-rank={rank}
      {...(showLanes ? { "data-chain-volume-split": true } : {})}
      {...(isSolana ? { "data-solana-volume-split": true } : {})}
      className="col-span-full grid grid-cols-subgrid items-center rounded-xl bg-card px-4 py-3 text-sm text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="num min-w-0 text-xs text-muted-foreground">#{rank}</div>
      <div className="min-w-0 truncate font-heading text-sm font-medium">{chain.name}</div>
      <div className="min-w-0">
        <p className="num text-right text-sm font-medium text-primary" data-combined-volume>
          {formatUsdCompact(combinedVolume)}
        </p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" data-volume-share-bar aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
        </div>
      </div>
      <div className="num min-w-0 text-right text-sm font-medium whitespace-nowrap" data-public-volume>
        {showLanes ? formatUsdCompact(chain.volume24hUsd) : null}
      </div>
      <div className="num min-w-0 text-right text-sm font-medium whitespace-nowrap" data-private-volume>
        {showLanes ? formatUsdCompact(chain.privateVolume24hUsd) : null}
      </div>
      <div className="num min-w-0 text-right text-sm font-medium whitespace-nowrap" data-etf-volume>
        {showLanes ? formatUsdCompact(chain.etfVolume24hUsd) : null}
      </div>
    </Link>
  );
}

/** Header plus one rounded row per chain. Narrow viewports scroll the pair together. */
export function ChainVolumeTable({ rows }: { rows: readonly ChainVolumeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto" data-chain-volume-scroll>
      <div className={cn("grid w-full min-w-[53rem] gap-x-4 gap-y-3", CHAIN_VOLUME_TRACKS)} data-chain-volume-table>
        <ChainVolumeHeader />
        {rows.map((row) => (
          <ChainVolumeCard key={row.chain.id} {...row} />
        ))}
      </div>
    </div>
  );
}
