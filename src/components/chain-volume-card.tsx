import Link from "next/link";
import { cn } from "cn";
import { chainCombinedVolume24h } from "@/lib/market/aggregate";
import { type VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import { formatUsdCompact, volumeShare } from "@/lib/market/format";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type ChainVolume } from "@/lib/market/types";
import { isMarketValueHidden } from "@/lib/site/visibility";

/**
 * One track list for the header and every chain bubble.
 * Subgrid rows inherit these tracks, so rank, name, volume, and lanes stay lined up across the card.
 */
export const CHAIN_VOLUME_TRACKS =
  "grid-cols-[2.75rem_minmax(11rem,1.35fr)_minmax(9rem,1.2fr)_minmax(7rem,1fr)_minmax(7.25rem,1fr)_minmax(8.5rem,1.1fr)_minmax(8rem,1fr)]";

/** Same tracks without the Market value column. */
export const CHAIN_VOLUME_TRACKS_WITHOUT_MARKET =
  "grid-cols-[2.75rem_minmax(11rem,1.35fr)_minmax(9rem,1.2fr)_minmax(7rem,1fr)_minmax(7.25rem,1fr)_minmax(8.5rem,1.1fr)]";

const HEADER_LABEL = "min-w-0 text-xs font-normal text-muted-foreground";

export interface ChainVolumeRow {
  chain: ChainVolume;
  rank: number;
  maxVolume: number | null;
  /** Range combined total. 24H rows omit this and use the chain's live legs. */
  combinedUsd?: number | null;
  /** Partial closed window, for example "4 of 7 days". */
  coverageHint?: string | null;
  /** Onchain market value for the same range. Null stays empty. */
  marketValueUsd?: number | null;
  /** `24H`, `avg 7D · n of 7 days`, or `current`. */
  marketValueHint?: string | null;
}

const RANGE_WORD: Record<VolumeChartRangeId, string> = {
  "24h": "24H",
  "7d": "7D",
  "14d": "14D",
  "30d": "30D",
};

export function chainVolumeHeaderLabels(range: VolumeChartRangeId): {
  combined: string;
  publicLane: string;
  privateLane: string;
  etf: string;
} {
  const word = RANGE_WORD[range];
  return {
    combined: `${word} Volume`,
    publicLane: `Public ${word}`,
    privateLane: `Private ${word}`,
    etf: `ETF/Index ${word}`,
  };
}

export function ChainVolumeHeader({
  range = "24h",
  showMarketValue = !isMarketValueHidden(),
}: {
  range?: VolumeChartRangeId;
  showMarketValue?: boolean;
}) {
  const labels = chainVolumeHeaderLabels(range);
  return (
    <div
      className="col-span-full grid grid-cols-subgrid items-center px-4"
      data-chain-volume-header
      data-chain-volume-range={range}
    >
      <div className={HEADER_LABEL}>#</div>
      <div className={HEADER_LABEL}>Chain</div>
      <div className={cn(HEADER_LABEL, "text-right")}>{labels.combined}</div>
      <div className={cn(HEADER_LABEL, "text-right")}>{labels.publicLane}</div>
      <div className={cn(HEADER_LABEL, "text-right")}>{labels.privateLane}</div>
      <div className={cn(HEADER_LABEL, "text-right")}>{labels.etf}</div>
      {showMarketValue ? <div className={cn(HEADER_LABEL, "text-right")}>Market value</div> : null}
    </div>
  );
}

export function ChainVolumeCard({
  chain,
  rank,
  maxVolume,
  combinedUsd,
  coverageHint,
  marketValueUsd = null,
  marketValueHint = null,
  showMarketValue = !isMarketValueHidden(),
}: ChainVolumeRow & { showMarketValue?: boolean }) {
  const isSolana = chain.id === SOLANA_CHAIN_ID;
  const showLanes =
    isSolana || chain.id === ROBINHOOD_CHAIN_ID || chain.id === BASE_CHAIN_ID || chain.id === BNB_CHAIN_ID;
  const combinedVolume = combinedUsd === undefined ? chainCombinedVolume24h(chain) : combinedUsd;
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
        {coverageHint ? (
          <p className="mt-1 text-right text-[10px] leading-none text-muted-foreground" data-chain-coverage>
            {coverageHint}
          </p>
        ) : null}
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
      {showMarketValue ? (
        <div className="min-w-0 text-right" data-market-value>
          <p className="num text-sm font-medium whitespace-nowrap">{formatUsdCompact(marketValueUsd)}</p>
          {marketValueHint ? (
            <p className="mt-1 text-[10px] leading-none text-muted-foreground" data-market-value-hint>
              {marketValueHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}

/** Header plus one rounded row per chain. Narrow viewports scroll the pair together. */
export function ChainVolumeTable({
  rows,
  range = "24h",
}: {
  rows: readonly ChainVolumeRow[];
  range?: VolumeChartRangeId;
}) {
  if (rows.length === 0) return null;
  const showMarketValue = !isMarketValueHidden();
  return (
    <div className="overflow-x-auto" data-chain-volume-scroll>
      <div
        className={cn(
          "grid w-full gap-x-4 gap-y-3",
          showMarketValue ? "min-w-[62rem]" : "min-w-[52rem]",
          showMarketValue ? CHAIN_VOLUME_TRACKS : CHAIN_VOLUME_TRACKS_WITHOUT_MARKET,
        )}
        data-chain-volume-table
        data-market-value-column={showMarketValue ? "shown" : "hidden"}
      >
        <ChainVolumeHeader range={range} showMarketValue={showMarketValue} />
        {rows.map((row) => (
          <ChainVolumeCard key={row.chain.id} {...row} showMarketValue={showMarketValue} />
        ))}
      </div>
    </div>
  );
}
