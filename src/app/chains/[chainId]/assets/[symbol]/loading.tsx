import { DetailSkeleton } from "@/components/loading-skeleton";
import { PageShell } from "@/components/page-shell";

export default function AssetLoading() {
  return (
    <PageShell>
      <DetailSkeleton />
    </PageShell>
  );
}
