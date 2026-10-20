import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PerpsDesk } from "@/components/perps-desk";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";
import { canonicalUrl } from "@/lib/site/seo";
import { isSectionHidden } from "@/lib/site/visibility";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perps",
  description:
    "Equity perpetual futures volume. Synthetic oracle-priced perps, separate from tokenized-stock spot totals.",
  alternates: { canonical: canonicalUrl("/perps") },
};

export default async function PerpsPage() {
  if (isSectionHidden("perps")) notFound();
  const model = await loadPerpsDeskModel();
  return (
    <PageShell>
      <PerpsDesk model={model} />
    </PageShell>
  );
}
