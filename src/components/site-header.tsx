import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { DataProvenance } from "@/lib/market/types";

export function SiteHeader({ provenance }: { provenance?: DataProvenance }) {
  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="group min-w-0">
          <p className="text-[11px] font-medium tracking-[0.22em] text-primary uppercase">
            On-chain equities
          </p>
          <h1 className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
            Stocks on the Blockchain
          </h1>
          <p className="text-sm text-muted-foreground">
            Volume first. Then the chain. Then the stock.
          </p>
        </Link>
        {provenance ? (
          <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
            {provenance.sourceId === "mock" ? "Seed / demo data" : "Live Terminal"}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}
