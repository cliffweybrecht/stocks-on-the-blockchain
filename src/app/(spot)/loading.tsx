import { DashboardSkeleton } from "@/components/loading-skeleton";
import { PageShell } from "@/components/page-shell";

export default function Loading() {
  return (
    <PageShell>
      <DashboardSkeleton />
    </PageShell>
  );
}
