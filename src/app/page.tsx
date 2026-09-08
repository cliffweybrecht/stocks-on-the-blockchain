import { ChainVolumeCard } from "@/components/chain-volume-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { SolanaCoverageBanner } from "@/components/solana-coverage-banner";
import { DailyVolumeChart } from "@/components/daily-volume-chart";
import { createMarketDataSource } from "@/lib/market/factory";
import { maxNullable } from "@/lib/market/numbers";
import { SOLANA_CHAIN_ID } from "@/lib/market/types";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = createMarketDataSource();

  let loaded;
  try {
    const [chainsSettled, historySettled] = await Promise.allSettled([
      source.listChains(),
      source.getEquityVolumeHistory(),
    ]);
    if (chainsSettled.status === "rejected") {
      throw chainsSettled.reason;
    }
    const history =
      historySettled.status === "fulfilled"
        ? historySettled.value
        : emptyEquityVolumeHistory(
            historySettled.reason instanceof Error
              ? historySettled.reason.message
              : "Historical volume series is unavailable.",
          );
    loaded = { ...chainsSettled.value, history };
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

  const { chains, provenance, history } = loaded;
  const maxVolume = maxNullable(chains.map((chain) => chain.volume24hUsd));
  const solanaChain = chains.find((chain) => chain.id === SOLANA_CHAIN_ID);

  return (
    <PageShell provenance={provenance}>
      <div className="space-y-5">
        <DailyVolumeChart history={history} deskVolume24hUsd={solanaChain?.volume24hUsd ?? null} />
        <ProvenanceBar provenance={provenance} compact />
        <section className="space-y-3">
          <div>
            <h2 className="font-heading text-lg font-medium">Chain volume</h2>
            <p className="text-sm text-muted-foreground">
              Ranked by observed 24h volume when the source reports it. Liquidity is secondary
              and is displayed, not executable. Missing volume stays a dash, never a zero.
            </p>
          </div>
          {solanaChain ? <SolanaCoverageBanner chain={solanaChain} /> : null}
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
