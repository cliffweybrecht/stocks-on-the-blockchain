"use client";

import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";

export default function HomeError({ error }: { error: Error }) {
  return (
    <PageShell>
      <ErrorState detail={error.message} />
    </PageShell>
  );
}
