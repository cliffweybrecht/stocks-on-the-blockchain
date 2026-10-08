import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PerpsDesk } from "@/components/perps-desk";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perps",
  description:
    "Equity perpetual futures volume. Synthetic oracle-priced perps, separate from tokenized-stock spot totals.",
};

export default async function PerpsPage() {
  const model = await loadPerpsDeskModel();
  return (
    <PageShell>
      <PerpsDesk model={model} />
    </PageShell>
  );
}
