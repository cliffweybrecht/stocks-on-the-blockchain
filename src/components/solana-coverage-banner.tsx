import Link from "next/link";
import { formatCount } from "@/lib/market/format";
import { solanaChainHref } from "@/lib/desk/solana-chain-href";
import type { ChainVolume } from "@/lib/market/types";
import { SOLANA_CHAIN_ID } from "@/lib/market/types";
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
        {formatCount(progress.classified)} classified public equities
        {chain.etfCount > 0 ? ` · ${formatCount(chain.etfCount)} ETF/index products kept out of this ranking` : ""}.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Link
          href={solanaChainHref({ chainId: SOLANA_CHAIN_ID, coverage: "with-volume", defaultCoverage: "with-volume" })}
          className="rounded-lg border border-primary/20 bg-background/40 px-3 py-2 hover:border-primary/50"
        >
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">With volume</p>
          <p className="num mt-0.5 text-lg text-primary">{formatCount(progress.withVolume)}</p>
          <p className="text-[11px] text-muted-foreground">Reported DexScreener 24h volume</p>
        </Link>
        <Link
          href={solanaChainHref({ chainId: SOLANA_CHAIN_ID, coverage: "hydrating", defaultCoverage: "with-volume" })}
          className="rounded-lg border border-amber-400/25 bg-background/40 px-3 py-2 hover:border-amber-400/50"
        >
          <p className="text-[11px] tracking-wide text-amber-200/80 uppercase">Still hydrating</p>
          <p className="num mt-0.5 text-lg text-amber-200">{formatCount(progress.stillHydrating)}</p>
          <p className="text-[11px] text-muted-foreground">Lookup not finished — unknown, not zero</p>
        </Link>
        <Link
          href={solanaChainHref({
            chainId: SOLANA_CHAIN_ID,
            coverage: "no-pools",
            defaultCoverage: "with-volume",
          })}
          className="rounded-lg border border-border bg-background/40 px-3 py-2 hover:border-foreground/30"
        >
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">Confirmed no pools</p>
          <p className="num mt-0.5 text-lg">{formatCount(progress.confirmedNoPools)}</p>
          <p className="text-[11px] text-muted-foreground">DexScreener index ceiling, not zero volume</p>
        </Link>
      </div>
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
            ? `${formatCount(progress.stillHydrating)} mint(s) still hydrating in the background. Counts are so-far, not final — reload to see with-volume rise.`
            : `${formatCount(progress.confirmedNoPools)} classified mint(s) finished DexScreener lookup with no indexed pools.`}{" "}
          {aggregation}
        </p>
      </div>
    </aside>
  );
}
