import { TableSkeleton } from "@/components/loading-skeleton";
import { PageShell } from "@/components/page-shell";

export default function PerpsTickerLoading() {
  return (
    <PageShell>
      <div aria-busy="true" aria-label="Loading equity perp ticker">
        <TableSkeleton />
      </div>
    </PageShell>
  );
}
