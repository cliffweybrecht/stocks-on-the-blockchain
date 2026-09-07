import { ChainVolumeCard } from "@/components/chain-volume-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { SolanaCoverageBanner } from "@/components/solana-coverage-banner";
import { TrustBanner } from "@/components/trust-banner";
import { createMarketDataSource } from "@/lib/market/factory";
import { maxNullable } from "@/lib/market/numbers";
import { SOLANA_CHAIN_ID } from "@/lib/market/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = createMarketDataSource();

  let loaded;
  try {
    loaded = await source.listChains();
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : "The market data source failed before any chain list could be built.";
    return (
      <PageShell>
        <ErrorState detail={detail} />
      </PageShell>
    );
  }

  const { chains, provenance } = loaded;
  const maxVolume = maxNullable(chains.map((chain) => chain.volume24hUsd));

  return (
    <PageShell provenance={provenance}>
      <div className="space-y-5">
        <TrustBanner />
        <ProvenanceBar provenance={provenance} />
        <section className="space-y-3">
          <div>
            <h2 className="font-heading text-lg font-medium">Chain volume</h2>
            <p className="text-sm text-muted-foreground">
              Ranked by observed 24h volume when the source reports it. Liquidity is secondary
              and is displayed, not executable. Missing volume stays a dash, never a zero.
            </p>
          </div>
          {chains.some((chain) => chain.id === SOLANA_CHAIN_ID) ? (
            <>
              <SolanaCoverageBanner chain={chains.find((chain) => chain.id === SOLANA_CHAIN_ID)!} />
              <p className="text-xs text-muted-foreground">
                On the Solana desk, press{" "}
                <kbd className="rounded border border-border px-1 font-mono">/</kbd> or{" "}
                <kbd className="rounded border border-border px-1 font-mono">⌘K</kbd> to jump by symbol, name,
                issuer, or mint. Pin two or more names to compare them. Export CSV from the chain page.
              </p>
            </>
          ) : null}
          {chains.length === 0 ? (
            <EmptyState
              title="No chains reported"
              detail="The configured market sources returned zero chains. A live adapter that failed is listed in provenance rather than filled with invented volume."
            />
          ) : (
            <div className="grid gap-4">
              {chains.map((chain, index) => (
                <ChainVolumeCard
                  key={chain.id}
                  chain={chain}
                  rank={index + 1}
                  maxVolume={maxVolume}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
