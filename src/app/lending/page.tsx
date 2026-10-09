import type { Metadata } from "next";
import { LendingDesk } from "@/components/lending-desk";
import { PageShell } from "@/components/page-shell";
import { loadLendingDeskModel } from "@/lib/market/lending-snapshot-file";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lending",
  description: "Plain-language look at borrowing dollars against tokenized stocks.",
};

export default async function LendingPage() {
  const model = await loadLendingDeskModel();
  return (
    <PageShell>
      <LendingDesk model={model} />
    </PageShell>
  );
}
