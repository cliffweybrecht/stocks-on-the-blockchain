import { formatCount } from "@/lib/market/format";
import type { ChainVolume } from "@/lib/market/types";

export function SolanaCoverageBanner({ chain }: { chain: ChainVolume }) {
  const classified = chain.assetCount;
  const withVolume = chain.assetsWithVolume;
  const withPools = chain.assetsWithPools;
  const noPools = Math.max(0, classified - withPools);
  const aggregation =
    chain.volumeAggregation === "primary-pair"
      ? "This view uses DexScreener primary-pair volume per mint. Open the Solana chain page for every-pool aggregation."
      : "Equity ranking uses aggregate 24h volume across every returned Solana pool for that mint. A pair is never treated as a stock.";

  return (
    <aside className="rounded-xl border border-primary/25 bg-primary/8 px-4 py-3 text-sm leading-relaxed">
      <p className="font-medium text-foreground">Solana coverage is partial and fail-closed</p>
      <p className="mt-2 text-muted-foreground">
        {formatCount(classified)} classified public equities · {formatCount(withVolume)} with reported DexScreener
        volume · {formatCount(withPools)} with indexed pools · {formatCount(noPools)} with no indexed pools yet
        {chain.etfCount > 0 ? ` · ${formatCount(chain.etfCount)} ETF/index products kept out of this ranking` : ""}.
      </p>
      <p className="mt-1 text-muted-foreground">
        Null volume is unknown, not zero: DexScreener may have no pools, pools with no reported 24h volume, or a slow /
        failed fetch. {aggregation}
      </p>
    </aside>
  );
}
