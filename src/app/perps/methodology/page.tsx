import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { PerpsMethodology } from "@/components/perps-methodology";

export const metadata: Metadata = {
  title: "Perps methodology",
  description:
    "What counts as an equity perpetual, how venues are tiered, and where each perps number comes from.",
};

export default function PerpsMethodologyPage() {
  return (
    <PageShell>
      <PerpsMethodology />
    </PageShell>
  );
}
