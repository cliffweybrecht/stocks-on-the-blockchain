import Link from "next/link";
import { formatUsdCompact } from "@/lib/market/format";
import type { PerpsHomeSummary } from "@/lib/market/perps-snapshot";

function Tier({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="num truncate text-sm font-medium">{formatUsdCompact(value)}</p>
    </div>
  );
}

/** Compact home card. Not part of Chain volume or the spot chart. */
export function PerpsHomeCard({ summary }: { summary: PerpsHomeSummary }) {
  return (
    <section className="space-y-3" data-perps-home>
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-heading text-lg font-medium">Perps</h2>
        <p className="text-[11px] text-muted-foreground">Not included in spot or Chain volume</p>
      </div>
      <Link
        href="/perps"
        data-perps-home-card
        className="block rounded-xl bg-card px-4 py-3 text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <p className="text-[10px] font-medium tracking-wide text-primary">EQUITY PERPS · NOT TOKENIZED STOCK</p>
        <p className="mt-1 font-heading text-sm font-medium">Synthetic oracle-priced perpetual futures</p>
        <p className="num mt-2 text-2xl font-medium text-primary" data-perps-home-total>
          {summary.readError || !summary.hasSnapshot ? "—" : formatUsdCompact(summary.totalUsd)}
        </p>
        <p className="mt-1 max-w-2xl text-[11px] leading-snug text-muted-foreground" data-perps-home-caption>
          {summary.readError ?? summary.caption}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Tier label="Onchain" value={summary.onchainUsd} />
          <Tier label="Major CEX" value={summary.cexDirectUsd} />
          <Tier label="Binance+Bybit" value={summary.cexCoingeckoUsd} />
        </div>
        {summary.longTailUsd !== null || summary.excludedUsd !== null ? (
          <p className="mt-2 text-[11px] text-muted-foreground" data-perps-home-coverage>
            {summary.longTailUsd !== null ? `Long-tail ${formatUsdCompact(summary.longTailUsd)} is not in this total. ` : ""}
            {summary.excludedUsd !== null ? `Volume/OI screen holds out ${formatUsdCompact(summary.excludedUsd)}.` : ""}
          </p>
        ) : null}
      </Link>
    </section>
  );
}
