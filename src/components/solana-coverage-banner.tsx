import { formatCount } from "@/lib/market/format";
import type { ChainVolume } from "@/lib/market/types";
import { solanaHydrateProgress } from "@/lib/market/volume-coverage";

export function SolanaCoverageBanner({ chain }: { chain: ChainVolume }) {
  const progress = solanaHydrateProgress(chain);

  return (
    <p className="text-xs text-muted-foreground">
      Coverage is partial and fail-closed
      {progress.stillHydrating > 0
        ? ` · ${formatCount(progress.stillHydrating)} still hydrating`
        : ` · ${formatCount(progress.withVolume)} with DexScreener volume`}
    </p>
  );
}
