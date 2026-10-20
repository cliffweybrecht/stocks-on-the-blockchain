import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";

export default function ChainNotFound() {
  return (
    <PageShell>
      <EmptyState
        title="That page is not in this desk"
        detail="Use the chain list to move from volume → stocks → a single asset."
      />
    </PageShell>
  );
}
