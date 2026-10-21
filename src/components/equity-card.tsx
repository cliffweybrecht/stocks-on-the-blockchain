"use client";

import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { CopyAddressIcon } from "@/components/copy-address";
import { PinButton } from "@/components/pin-button";
import { PriceSparkline } from "@/components/price-sparkline";
import { VolumeSparkline } from "@/components/volume-sparkline";
import {
  equityCardDayMovePct,
  equityCardDayVolumeSeries,
  equityCardHeadline,
  equityCardLiquiditySeries,
  equityCardMarketValueSeries,
  equityCardSpotPriceUsd,
} from "@/lib/desk/equity-card-view";
import type { EquityCardLiquidityPoint } from "@/lib/market/equity-card-range-liquidity";
import type { AssetMarketValuePoint } from "@/lib/market/onchain-market-value";
import type { AssetSortKey } from "@/lib/market/aggregate";
import { formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary, PriceHistoryPoint, VolumeHistoryPoint } from "@/lib/market/types";

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
  rangeLiquidity = null,
  rangeMarketValue = null,
  rangePrice = null,
  rangeVolumeSeries = null,
  enableFavorites,
  pinned,
  onTogglePin,
}: {
  asset: AssetSummary;
  href: string;
  sortKey?: AssetSortKey;
  dayVolumeSeries?: readonly VolumeHistoryPoint[];
  /** Closed-range volume total. 24H and liquidity mode leave this unset. */
  rangeVolume?: {
    id: "7d" | "14d" | "30d";
    volumeUsd: number | null;
    days: number;
  } | null;
  /** Closing liquidity for the selected range. Set only in Liquidity mode. */
  rangeLiquidity?: {
    id: "24h" | "7d" | "14d" | "30d";
    liquidityUsd: number | null;
    days: number;
    series?: readonly EquityCardLiquidityPoint[];
  } | null;
  /** Closing market value for the selected range. Set only in Market value mode. */
  rangeMarketValue?: {
    id: "24h" | "7d" | "14d" | "30d";
    marketValueUsd: number | null;
    days: number;
    recorded: boolean;
    series?: readonly AssetMarketValuePoint[];
  } | null;
  /**
   * Captured closes inside the selected range.
   * One close has a price and no move. No close leaves the price to the live spot.
   */
  rangePrice?: {
    priceUsd: number | null;
    changePct: number | null;
    series?: readonly PriceHistoryPoint[];
  } | null;
  /** Recorded daily volume inside a closed range. 24H keeps the hourly series. */
  rangeVolumeSeries?: readonly VolumeHistoryPoint[] | null;
  enableFavorites?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const livePriceUsd = equityCardSpotPriceUsd(asset);
  const capturedPriceUsd =
    rangePrice?.priceUsd !== null &&
    rangePrice?.priceUsd !== undefined &&
    Number.isFinite(rangePrice.priceUsd) &&
    rangePrice.priceUsd > 0
      ? rangePrice.priceUsd
      : null;
  const liquidityMode = sortKey === "displayedLiquidityUsd";
  const marketMode = sortKey === "marketValueUsd";
  const sparklinePoints = marketMode
    ? equityCardMarketValueSeries(rangeMarketValue?.series)
    : liquidityMode
      ? equityCardLiquiditySeries(rangeLiquidity?.series)
      : null;
  const rangeVolumeSparkline =
    !marketMode && !liquidityMode && rangeVolumeSeries && rangeVolumeSeries.length >= 2 ? rangeVolumeSeries : null;
  const priceSparkline =
    !marketMode && !liquidityMode && !rangeVolumeSparkline && rangePrice?.series && rangePrice.series.length >= 2
      ? rangePrice.series
      : null;
  const headline = equityCardHeadline(
    asset,
    sortKey,
    rangeVolume,
    liquidityMode ? rangeLiquidity : null,
    marketMode ? rangeMarketValue : null,
  );
  const rangeId = marketMode
    ? (rangeMarketValue?.id ?? "24h")
    : liquidityMode
      ? (rangeLiquidity?.id ?? "24h")
      : rangeVolume
        ? rangeVolume.id
        : "24h";
  const liquidityBasis =
    !liquidityMode || !rangeLiquidity
      ? undefined
      : rangeLiquidity.days > 0 && rangeLiquidity.liquidityUsd !== null && Number.isFinite(rangeLiquidity.liquidityUsd)
        ? rangeLiquidity.id === "24h"
          ? "close"
          : "average"
        : "current";
  const marketBasis = !marketMode
    ? undefined
    : rangeMarketValue?.recorded
      ? rangeMarketValue.id === "24h"
        ? "close"
        : "average"
      : "missing";
  const priceUsd = rangeId === "24h" ? (livePriceUsd ?? capturedPriceUsd) : (capturedPriceUsd ?? livePriceUsd);
  const rangeMove = equityCardDayMovePct(rangePrice?.changePct);
  const dayMove = equityCardDayMovePct(asset.priceChange24hPct);
  const priceMove = rangeId === "24h" ? (dayMove ?? rangeMove) : rangeMove;
  const hourlySparkline =
    !marketMode && !liquidityMode && !priceSparkline && !rangeVolumeSparkline
      ? equityCardDayVolumeSeries(dayVolumeSeries)
      : null;

  return (
    <article
      className="group relative flex min-h-[176px] flex-col overflow-hidden rounded-2xl bg-[#141414] px-4 py-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-[#1a1a1a]"
      data-card-range={rangeId}
      data-card-liq-basis={liquidityBasis}
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
          <AssetLogo
            logoUrl={asset.logoUrl}
            name={asset.name}
            symbol={asset.symbol}
            issuer={asset.issuer}
            size="md"
          />
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
      <div className="relative z-10 mt-auto flex min-w-0 items-end gap-2 pt-4 pointer-events-none">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="num min-w-0 truncate text-sm text-neutral-200" data-card-price>
            {formatPrice(priceUsd)}
          </p>
          <DayMove value={priceMove} />
        </div>
        <span className="ml-auto shrink-0">
          {priceSparkline ? (
            <PriceSparkline
              points={priceSparkline}
              span="range"
              label={`${asset.symbol} ${rangeId.toUpperCase()} price`}
            />
          ) : sparklinePoints ? (
            <VolumeSparkline
              points={sparklinePoints}
              label={
                marketMode
                  ? `${asset.symbol} market value`
                  : `${asset.symbol} ${rangeId.toUpperCase()} liquidity`
              }
            />
          ) : rangeVolumeSparkline ? (
            <VolumeSparkline
              points={rangeVolumeSparkline}
              label={`${asset.symbol} ${rangeId.toUpperCase()} volume`}
            />
          ) : hourlySparkline ? (
            <VolumeSparkline points={hourlySparkline} label={`${asset.symbol} 24h volume trend`} />
          ) : null}
        </span>
      </div>
    </article>
  );
}
