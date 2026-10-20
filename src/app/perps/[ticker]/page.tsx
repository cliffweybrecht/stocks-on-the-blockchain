import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PerpsTickerView } from "@/components/perps-ticker-view";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";
import { perpsTickerModel } from "@/lib/market/perps-ticker";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const requested = decodeURIComponent(ticker);
  return {
    title: `${requested} perp`,
    description: `Equity perpetual volume and open interest for ${requested}. Separate from tokenized-stock spot.`,
  };
}

export default async function PerpsTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const model = perpsTickerModel(await loadPerpsDeskModel(), decodeURIComponent(ticker));
  return (
    <PageShell>
      <PerpsTickerView model={model} />
    </PageShell>
  );
}
