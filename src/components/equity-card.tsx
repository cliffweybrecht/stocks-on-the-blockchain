"use client";

import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { CopyAddressIcon } from "@/components/copy-address";
import { PinButton } from "@/components/pin-button";
import { VolumeSparkline } from "@/components/volume-sparkline";
import {
  equityCardDayMovePct,
  equityCardDayVolumeSeries,
  equityCardHeadline,
  equityCardSpotPriceUsd,
} from "@/lib/desk/equity-card-view";
import type { AssetSortKey } from "@/lib/market/aggregate";
import { formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary, VolumeHistoryPoint } from "@/lib/market/types";

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
  enableFavorites,
  pinned,
  onTogglePin,
}: {
  asset: AssetSummary;
  href: string;
  sortKey?: AssetSortKey;
  dayVolumeSeries?: readonly VolumeHistoryPoint[];
  enableFavorites?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const priceUsd = equityCardSpotPriceUsd(asset);
  const sparklinePoints = equityCardDayVolumeSeries(dayVolumeSeries);
  const headline = equityCardHeadline(asset, sortKey);

  return (
    <article className="group relative flex min-h-[176px] flex-col overflow-hidden rounded-2xl bg-[#141414] px-4 py-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-[#1a1a1a]">
      <Link
        href={href}
        prefetch
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
      <div className="relative z-10 mt-auto flex min-w-0 items-end gap-2 pt-4 pointer-events-none">
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="num min-w-0 truncate text-sm text-neutral-200">{formatPrice(priceUsd)}</p>
          <DayMove value={asset.priceChange24hPct} />
        </div>
        <span className="ml-auto shrink-0">
          {sparklinePoints ? (
            <VolumeSparkline points={sparklinePoints} label={`${asset.symbol} 24h volume trend`} />
          ) : null}
        </span>
      </div>
    </article>
  );
}
