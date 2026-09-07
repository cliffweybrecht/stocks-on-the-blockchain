import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { AssetSummary, DataProvenance } from "@/lib/market/types";

export function PageShell({
  children,
  provenance,
  solanaJump,
}: {
  children: React.ReactNode;
  provenance?: DataProvenance;
  solanaJump?: { chainId: string; assets: readonly AssetSummary[] };
}) {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader provenance={provenance} solanaJump={solanaJump} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
