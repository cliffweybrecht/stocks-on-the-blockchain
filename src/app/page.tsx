import { ChainVolumeCard } from "@/components/chain-volume-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { TrustBanner } from "@/components/trust-banner";
import { createMarketDataSource } from "@/lib/market/factory";
import { maxNullable } from "@/lib/market/numbers";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  try {
    const source = createMarketDataSource();
    const { chains, provenance } = await source.listChains();
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
                and is displayed, not executable.
              </p>
            </div>
            {chains.length === 0 ? (
              <EmptyState
                title="No chains reported"
                detail="The configured market source returned zero chains. In live mode this usually means Terminal returned an empty snapshot."
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
}
