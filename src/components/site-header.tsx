import Link from "next/link";
import { SolanaJumpSearch } from "@/components/solana-jump-search";
import { Badge } from "@/components/ui/badge";
import type { SearchableAsset } from "@/lib/market/asset-search";
import type { DataProvenance } from "@/lib/market/types";

export function SiteHeader({
  provenance,
  solanaJump,
}: {
  provenance?: DataProvenance;
  solanaJump?: { chainId: string; assets: readonly SearchableAsset[] };
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/50 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="min-w-0" aria-label="Home">
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Stocks on the Blockchain
          </h1>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {solanaJump && solanaJump.assets.length > 0 ? (
            <SolanaJumpSearch chainId={solanaJump.chainId} assets={solanaJump.assets} />
          ) : null}
          {provenance ? (
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
              {provenance.sourceId === "mock"
                ? "Seed / demo data"
                : provenance.sourceId === "solana" ||
                    (provenance.sourceId === "composite" && provenance.sourceLabel.toLowerCase().includes("solana"))
                  ? "Live Solana"
                  : provenance.sourceId === "composite"
                    ? "Live sources"
                    : "Live Terminal"}
            </Badge>
          ) : null}
        </div>
      </div>
    </header>
  );
}
