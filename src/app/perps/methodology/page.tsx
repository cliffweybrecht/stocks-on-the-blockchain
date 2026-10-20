import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PerpsMethodology } from "@/components/perps-methodology";
import { loadPerpsDeskModel } from "@/lib/market/perps-snapshot-file";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Perps methodology",
  description:
    "What counts as an equity perpetual, how venues are tiered, and where each perps number comes from.",
};

export default async function PerpsMethodologyPage() {
  const model = await loadPerpsDeskModel();
  const latest = [...model.days].reverse().find((day) => day.archive);
  return (
    <PageShell>
      <PerpsMethodology archive={latest?.archive ? { date: latest.date, check: latest.archive } : null} />
    </PageShell>
  );
}
