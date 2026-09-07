import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import type { DataProvenance } from "@/lib/market/types";

export function PageShell({
  children,
  provenance,
}: {
  children: React.ReactNode;
  provenance?: DataProvenance;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader provenance={provenance} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
