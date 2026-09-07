import { formatCount } from "@/lib/market/format";
import type { ChainVolume } from "@/lib/market/types";
import { solanaHydrateProgress } from "@/lib/market/volume-coverage";

export function SolanaCoverageBanner({ chain }: { chain: ChainVolume }) {
  const progress = solanaHydrateProgress(chain);
  const aggregation =
    chain.volumeAggregation === "primary-pair"
      ? "This view uses DexScreener primary-pair volume per mint. Open the Solana chain page for every-pool aggregation."
      : "Equity ranking uses aggregate 24h volume across every returned Solana pool for that mint. A pair is never treated as a stock.";

  return (
    <aside className="rounded-xl border border-primary/25 bg-primary/8 px-4 py-3 text-sm leading-relaxed">
      <p className="font-medium text-foreground">Solana coverage is partial and fail-closed</p>
      <p className="mt-2 text-muted-foreground">
        {formatCount(progress.classified)} classified public equities · {formatCount(progress.withVolume)} with
        reported DexScreener volume so far · {formatCount(progress.withPools)} with indexed pools ·{" "}
        {formatCount(progress.confirmedNoPools)} confirmed no DexScreener pools
        {progress.stillHydrating > 0
          ? ` · ${formatCount(progress.stillHydrating)} still hydrating`
          : ""}
        {chain.etfCount > 0
          ? ` · ${formatCount(chain.etfCount)} ETF/index products kept out of this ranking`
          : ""}
        .
      </p>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            DexScreener lookup {formatCount(progress.checked)} / {formatCount(progress.classified)}
          </span>
          <span className="num">{progress.checkedPct}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.checkedPct}
          aria-label="DexScreener hydrate progress"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress.checkedPct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {progress.stillHydrating > 0
            ? `${formatCount(progress.stillHydrating)} mint(s) still hydrating in the background. Counts are so-far, not final — reload to see with-volume rise. Null volume is unknown, not zero.`
            : `${formatCount(progress.confirmedNoPools)} classified mint(s) finished DexScreener lookup with no indexed pools. That is a DexScreener index ceiling, not zero volume.`}
        </p>
      </div>
      <p className="mt-2 text-muted-foreground">
        Null volume is unknown, not zero: DexScreener may have no pools, pools with no reported 24h volume, or a slow /
        failed fetch. {aggregation}
      </p>
    </aside>
  );
}
