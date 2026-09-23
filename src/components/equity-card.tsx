"use client";

import Link from "next/link";
import { AssetLogo } from "@/components/asset-logo";
import { CopyAddressIcon } from "@/components/copy-address";
import { PinButton } from "@/components/pin-button";
import { PriceSparkline } from "@/components/price-sparkline";
import {
  equityCardDayMovePct,
  equityCardDayPriceSeries,
  equityCardSpotPriceUsd,
} from "@/lib/desk/equity-card-view";
import { formatPct, formatPrice, formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary, PriceHistoryPoint } from "@/lib/market/types";

function DayMove({ value }: { value: number | null }) {
  const move = equityCardDayMovePct(value);
  if (move === null) return null;
  const tone = move > 0 ? "text-price-up" : move < 0 ? "text-price-down" : "text-neutral-500";
  return (
    <span className={`num text-xs font-medium ${tone}`} data-price-change={move > 0 ? "up" : move < 0 ? "down" : "flat"}>
      {formatPct(move)}
    </span>
  );
}

export function EquityCard({
  asset,
  href,
  dayPriceSeries,
  enableFavorites,
  pinned,
  onTogglePin,
}: {
  asset: AssetSummary;
  href: string;
  dayPriceSeries?: readonly PriceHistoryPoint[];
  enableFavorites?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const priceUsd = equityCardSpotPriceUsd(asset);
  const sparklinePoints = equityCardDayPriceSeries(dayPriceSeries);

  return (
    <article className="group relative flex min-h-[176px] flex-col overflow-hidden rounded-2xl bg-[#141414] px-4 py-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-[#1a1a1a]">
      <Link
        href={href}
        prefetch
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={`${asset.symbol} ${asset.name}`}
      />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="pointer-events-none">
          <AssetLogo logoUrl={asset.logoUrl} name={asset.name} symbol={asset.symbol} size="md" />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <CopyAddressIcon address={asset.contractAddress} />
          {enableFavorites && onTogglePin ? (
            <PinButton pinned={Boolean(pinned)} label={asset.symbol} onToggle={onTogglePin} />
          ) : null}
        </div>
      </div>
      <div className="relative z-10 mt-2.5 min-w-0 pointer-events-none">
        <p className="truncate text-[15px] font-semibold tracking-tight text-white">{asset.symbol}</p>
        <p className="truncate text-xs text-neutral-500">{asset.name}</p>
      </div>
      <p className="relative z-10 mt-4 text-[28px] leading-none font-semibold tracking-tight text-white pointer-events-none">
        <span className="num">{formatUsdCompact(asset.volume24hUsd)}</span>
      </p>
      <div className="relative z-10 mt-auto flex items-end gap-2 pt-4 pointer-events-none">
        <p className="num shrink-0 text-sm text-neutral-200">{formatPrice(priceUsd)}</p>
        <DayMove value={asset.priceChange24hPct} />
        <span className="ml-auto">
          {sparklinePoints ? (
            <PriceSparkline points={sparklinePoints} label={`${asset.symbol} day price trend`} />
          ) : null}
        </span>
      </div>
    </article>
  );
}
