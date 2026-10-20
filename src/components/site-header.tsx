import Link from "next/link";
import { DeskHeaderActionsSlot } from "@/components/desk-header-actions";
import { DeskNav } from "@/components/desk-nav";
import { SolanaJumpSearch } from "@/components/solana-jump-search";
import { Badge } from "@/components/ui/badge";
import { headerStatusLabel } from "@/lib/desk/header-status";
import type { SearchableAsset } from "@/lib/market/asset-search";
import { isChainEnabled } from "@/lib/market/chain-config";
import type { DataProvenance } from "@/lib/market/types";

export function SiteHeader({
  provenance,
  solanaJump,
}: {
  provenance?: DataProvenance;
  solanaJump?: { chainId: string; assets: readonly SearchableAsset[] };
}) {
  const statusLabel = provenance ? headerStatusLabel(provenance) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link href="/" className="min-w-0" aria-label="Home">
            <h1 className="truncate font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Stocks on the Blockchain
            </h1>
          </Link>
          <DeskNav />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {solanaJump && isChainEnabled(solanaJump.chainId) && solanaJump.assets.length > 0 ? (
            <SolanaJumpSearch chainId={solanaJump.chainId} assets={solanaJump.assets} />
          ) : null}
          <DeskHeaderActionsSlot />
          {statusLabel ? (
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
              {statusLabel}
            </Badge>
          ) : null}
        </div>
      </div>
    </header>
  );
}
