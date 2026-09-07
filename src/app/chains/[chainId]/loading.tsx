import { TableSkeleton } from "@/components/loading-skeleton";
import { PageShell } from "@/components/page-shell";

export default function ChainLoading() {
  return (
    <PageShell>
      <TableSkeleton />
    </PageShell>
  );
}
