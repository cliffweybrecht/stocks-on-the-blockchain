import { TableSkeleton } from "@/components/loading-skeleton";
import { PageShell } from "@/components/page-shell";

export default function PerpsLoading() {
  return (
    <PageShell>
      <div aria-busy="true" aria-label="Loading equity perps">
        <TableSkeleton />
      </div>
    </PageShell>
  );
}
