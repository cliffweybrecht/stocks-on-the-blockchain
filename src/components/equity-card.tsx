"use client";

import Link from "next/link";
import { CopyAddressIcon } from "@/components/copy-address";
import { PinButton } from "@/components/pin-button";
import { VolumeSparkline } from "@/components/volume-sparkline";
import { formatUsdCompact } from "@/lib/market/format";
import type { AssetSummary, VolumeHistoryPoint } from "@/lib/market/types";

export function EquityCard({
  asset,
  href,
  weekSeries,
  enableFavorites,
  pinned,
  onTogglePin,
}: {
  asset: AssetSummary;
  href: string;
  weekSeries?: readonly VolumeHistoryPoint[];
  enableFavorites?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <article className="group relative flex min-h-[168px] flex-col overflow-hidden rounded-2xl bg-[#141414] px-4 pt-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] transition-colors hover:bg-[#1a1a1a]">
      <Link
        href={href}
        prefetch
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={`${asset.symbol} ${asset.name}`}
      />
      <div className="relative z-10 flex items-start justify-between gap-2 pointer-events-none">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold tracking-tight text-white">{asset.symbol}</p>
          <p className="truncate text-xs text-neutral-500">{asset.name}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 pointer-events-auto">
          {enableFavorites && onTogglePin ? (
            <PinButton pinned={Boolean(pinned)} label={asset.symbol} onToggle={onTogglePin} />
          ) : null}
          <CopyAddressIcon address={asset.contractAddress} />
        </div>
      </div>
      <p className="relative z-10 mt-5 text-[28px] leading-none font-semibold tracking-tight text-white pointer-events-none">
        <span className="num">{formatUsdCompact(asset.volume24hUsd)}</span>
      </p>
      <div className="relative z-10 mt-auto -mx-4 pt-3 pointer-events-none">
        {weekSeries && weekSeries.length >= 2 ? (
          <VolumeSparkline
            points={weekSeries}
            label={`${asset.symbol} week volume trend`}
          />
        ) : (
          <div className="h-14" aria-hidden />
        )}
      </div>
    </article>
  );
}
