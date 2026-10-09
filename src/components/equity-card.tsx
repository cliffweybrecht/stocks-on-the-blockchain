"use client";

import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { CopyAddressIcon } from "@/components/copy-address";
import { PinButton } from "@/components/pin-button";
import { useDeskVolumeRange } from "@/components/desk-volume-range";
import { VolumeSparkline } from "@/components/volume-sparkline";
import {
  equityCardDayMovePct,
  equityCardDayVolumeSeries,
  equityCardHeadline,
  equityCardMarketValueSeries,
  equityCardSpotPriceUsd,
} from "@/lib/desk/equity-card-view";
import type { AssetMarketValuePoint } from "@/lib/market/onchain-market-value";
import type { AssetSortKey } from "@/lib/market/aggregate";
import { formatCount, formatPct, formatPrice, formatTokenAmount, formatUsdCompact } from "@/lib/market/format";
import { holderAssetRangeView, type HolderAssetPoint } from "@/lib/market/holder-snapshots";
import type { AssetSummary, VolumeHistoryPoint } from "@/lib/market/types";

const warmedAssetRoutes = new Set<string>();

/** Pointer-down starts holder, supply, and chart fetches before the route paints. */
function warmSolanaAssetDetail(href: string) {
  const marker = "/chains/solana/assets/";
  const index = href.indexOf(marker);
  if (index < 0) return;
  const symbol = decodeURIComponent(href.slice(index + marker.length).split(/[?#]/)[0] ?? "");
  if (!symbol || symbol.length > 64 || warmedAssetRoutes.has(symbol)) return;
  warmedAssetRoutes.add(symbol);
  void fetch(`/api/solana/asset-warm?symbol=${encodeURIComponent(symbol)}`, {
    cache: "no-store",
    keepalive: true,
  }).catch(() => {
    warmedAssetRoutes.delete(symbol);
  });
}

function DayMove({ value }: { value: number | null }) {
  const move = equityCardDayMovePct(value);
  if (move === null) return null;
  const tone = move > 0 ? "text-price-up" : move < 0 ? "text-price-down" : "text-neutral-500";
  return (
    <span className={`num shrink-0 text-xs font-medium ${tone}`} data-price-change={move > 0 ? "up" : move < 0 ? "down" : "flat"}>
      {formatPct(move)}
    </span>
  );
}

export function EquityCard({
  asset,
  href,
  sortKey = "volume24hUsd",
  dayVolumeSeries,
  rangeVolume = null,
  rangeMarketValue = null,
  enableFavorites,
  pinned,
  onTogglePin,
  holderPoints,
}: {
  asset: AssetSummary;
  href: string;
  sortKey?: AssetSortKey;
  dayVolumeSeries?: readonly VolumeHistoryPoint[];
  /** Closed-range total. 24H and liquidity mode leave this unset. */
  rangeVolume?: {
    id: "7d" | "14d" | "30d";
    volumeUsd: number | null;
    days: number;
  } | null;
  /** Closing market value for the selected range. Set only in Market value mode. */
  rangeMarketValue?: {
    id: "24h" | "7d" | "14d" | "30d";
    marketValueUsd: number | null;
    days: number;
    recorded: boolean;
    series?: readonly AssetMarketValuePoint[];
  } | null;
  enableFavorites?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Nightly holder/supply points for this mint. Omitted on desks that do not track them. */
  holderPoints?: readonly HolderAssetPoint[];
}) {
  const deskRange = useDeskVolumeRange("7d");
  const priceUsd = equityCardSpotPriceUsd(asset);
  const marketMode = sortKey === "marketValueUsd";
  const sparklinePoints = marketMode
    ? equityCardMarketValueSeries(rangeMarketValue?.series)
    : equityCardDayVolumeSeries(dayVolumeSeries);
  const headline = equityCardHeadline(asset, sortKey, rangeVolume, marketMode ? rangeMarketValue : null);
  const holders = holderPoints ? holderAssetRangeView(holderPoints, deskRange.range) : null;
  const rangeId = marketMode ? (rangeMarketValue?.id ?? deskRange.range) : rangeVolume && sortKey !== "displayedLiquidityUsd" ? rangeVolume.id : "24h";
  const marketBasis = !marketMode
    ? undefined
    : rangeMarketValue?.recorded
      ? rangeMarketValue.id === "24h"
        ? "close"
        : "average"
      : "current";

  return (
    <article
      className="group relative flex min-h-[176px] flex-col overflow-hidden rounded-2xl bg-[#141414] px-4 py-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-[#1a1a1a]"
      data-card-range={rangeId}
      data-card-mkt-basis={marketBasis}
    >
      <Link
        href={href}
        prefetch
        onPointerDown={() => warmSolanaAssetDetail(href)}
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={`${asset.symbol} ${asset.name}`}
      />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5 pointer-events-none">
          <AssetLogo logoUrl={asset.logoUrl} name={asset.name} symbol={asset.symbol} size="md" />
          <div className="min-w-0 pt-0.5">
            <p className="truncate text-[15px] font-semibold tracking-tight text-white">{asset.symbol}</p>
            <p className="truncate text-xs text-neutral-500">{asset.name}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyAddressIcon address={asset.contractAddress} />
          {enableFavorites && onTogglePin ? (
            <PinButton pinned={Boolean(pinned)} label={asset.symbol} onToggle={onTogglePin} />
          ) : null}
        </div>
      </div>
      <p
        className="relative z-10 mt-5 flex items-baseline gap-1.5 pointer-events-none"
        data-card-metric={headline.kind}
      >
        <span className="num text-[28px] leading-none font-semibold tracking-tight text-white" data-card-amount>
          {formatUsdCompact(headline.amountUsd)}
        </span>
        <span className="shrink-0 text-sm font-normal leading-none text-neutral-200" data-card-metric-label>
          {headline.label}
        </span>
      </p>
      {headline.coverageHint ? (
        <p
          className="relative z-10 mt-1 text-[10px] leading-none font-normal text-neutral-500 pointer-events-none"
          data-card-range-days
        >
          {headline.coverageHint}
        </p>
      ) : null}
      {holders ? (
        <div className="relative z-10 mt-3 space-y-1 pointer-events-none" data-card-holders>
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-neutral-500">Holders</span>
            <span className="num text-neutral-100" data-card-holder-count>
              {formatCount(holders.holderCount)}
              {holders.holderChange !== null ? (
                <span className="ml-1.5 text-neutral-400" data-card-holder-change>
                  {holders.holderChange > 0 ? "+" : holders.holderChange < 0 ? "−" : ""}
                  {formatCount(Math.abs(holders.holderChange))}
                </span>
              ) : null}
            </span>
          </p>
          <p className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-neutral-500">Supply</span>
            <span className="num text-right text-neutral-100" data-card-supply>
              {formatUsdCompact(holders.supplyUsd)}
              <span className="text-neutral-400"> · {formatTokenAmount(holders.totalSupply)}</span>
              {holders.supplyUsdChange !== null ? (
                <span className="ml-1.5 text-neutral-400" data-card-supply-change>
                  {holders.supplyUsdChange > 0 ? "+" : holders.supplyUsdChange < 0 ? "−" : ""}
                  {formatUsdCompact(Math.abs(holders.supplyUsdChange))}
                </span>
              ) : null}
            </span>
          </p>
        </div>
      ) : null}
      <div className="relative z-10 mt-auto flex min-w-0 items-end gap-2 pt-4 pointer-events-none">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="num min-w-0 truncate text-sm text-neutral-200">{formatPrice(priceUsd)}</p>
          <DayMove value={asset.priceChange24hPct} />
        </div>
        <span className="ml-auto shrink-0">
          {sparklinePoints ? (
            <VolumeSparkline
              points={sparklinePoints}
              label={marketMode ? `${asset.symbol} market value` : `${asset.symbol} 24h volume trend`}
            />
          ) : null}
        </span>
      </div>
    </article>
  );
}
