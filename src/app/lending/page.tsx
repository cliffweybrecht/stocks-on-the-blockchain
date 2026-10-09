import type { Metadata } from "next";
import { LendingDesk } from "@/components/lending-desk";
import { PageShell } from "@/components/page-shell";
import { loadLendingDeskModel } from "@/lib/market/lending-snapshot-file";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lending",
  description: "Onchain borrowing and lending against tokenized stocks.",
};

export default async function LendingPage() {
  const model = await loadLendingDeskModel();
  return (
    <PageShell>
      <LendingDesk model={model} />
    </PageShell>
  );
}
