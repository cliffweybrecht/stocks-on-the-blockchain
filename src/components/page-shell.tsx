import { DeskHeaderActionsProvider } from "@/components/desk-header-actions";
import { PriceTicker } from "@/components/price-ticker";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { EquityPriceTickerItem } from "@/lib/desk/price-ticker";
import type { SearchableAsset } from "@/lib/market/asset-search";
import type { DataProvenance } from "@/lib/market/types";

export function PageShell({
  children,
  provenance,
  solanaJump,
  priceTicker,
}: {
  children: React.ReactNode;
  provenance?: DataProvenance;
  solanaJump?: { chainId: string; assets: readonly SearchableAsset[] };
  priceTicker?: readonly EquityPriceTickerItem[];
}) {
  return (
    <DeskHeaderActionsProvider>
      <div className="flex min-h-full flex-col bg-background">
        <SiteHeader provenance={provenance} solanaJump={solanaJump} />
        <PriceTicker items={priceTicker ?? []} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <SiteFooter />
      </div>
    </DeskHeaderActionsProvider>
  );
}
