import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PerpsTickerView } from "@/components/perps-ticker-view";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";
import { perpsTickerModel } from "@/lib/market/perps-ticker";
import { canonicalUrl } from "@/lib/site/seo";
import { isSectionHidden } from "@/lib/site/visibility";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  if (isSectionHidden("perps")) notFound();
  const { ticker } = await params;
  const requested = decodeURIComponent(ticker);
  return {
    title: `${requested} perp`,
    description: `Equity perpetual volume and open interest for ${requested}. Separate from tokenized-stock spot.`,
    alternates: { canonical: canonicalUrl(`/perps/${encodeURIComponent(requested)}`) },
  };
}

export default async function PerpsTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  if (isSectionHidden("perps")) notFound();
  const { ticker } = await params;
  const model = perpsTickerModel(await loadPerpsDeskModel(), decodeURIComponent(ticker));
  return (
    <PageShell>
      <PerpsTickerView model={model} />
    </PageShell>
  );
}
