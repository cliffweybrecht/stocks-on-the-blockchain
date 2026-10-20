import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LendingDesk } from "@/components/lending-desk";
import { PageShell } from "@/components/page-shell";
import { buildLendingDeskModel } from "@/lib/market/lending-snapshot";
import { loadLendingDays } from "@/lib/market/lending-snapshot-file";
import { canonicalUrl } from "@/lib/site/seo";
import { isSectionHidden } from "@/lib/site/visibility";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lending",
  description: "Plain-language look at borrowing dollars against tokenized stocks.",
  alternates: { canonical: canonicalUrl("/lending") },
};

export default async function LendingPage() {
  if (isSectionHidden("lending")) notFound();
  const loaded = await loadLendingDays();
  const model = buildLendingDeskModel(loaded.days.at(-1) ?? null, loaded.readError, loaded.days);
  return (
    <PageShell>
      <LendingDesk model={model} days={loaded.days} />
    </PageShell>
  );
}
