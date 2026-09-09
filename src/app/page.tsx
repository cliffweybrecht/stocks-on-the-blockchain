import { ChainVolumeCard } from "@/components/chain-volume-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";
import { ProvenanceBar } from "@/components/provenance-bar";
import { DailyVolumeChart } from "@/components/daily-volume-chart";
import { selectEquityPriceTicker } from "@/lib/desk/price-ticker";
import { toJumpAsset } from "@/lib/market/asset-search";
import { createMarketDataSource } from "@/lib/market/factory";
import { maxNullable } from "@/lib/market/numbers";
import { SOLANA_CHAIN_ID, type AssetSummary } from "@/lib/market/types";
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
  const tickerAssets: AssetSummary[] = [];
  let jumpAssets: ReturnType<typeof toJumpAsset>[] = [];
  for (const chain of chains) {
    try {
      const detail = await source.getChain(chain.id);
      if (!detail) continue;
      tickerAssets.push(...detail.assets);
      if (chain.id === SOLANA_CHAIN_ID) {
        jumpAssets = [...detail.assets, ...(detail.etfAssets ?? [])].map(toJumpAsset);
      }
    } catch {
      // Skip a chain that listed but failed to hydrate. Do not invent ticker rows.
    }
  }
  const priceTicker = selectEquityPriceTicker(tickerAssets);

  return (
    <PageShell
      provenance={provenance}
      priceTicker={priceTicker}
      solanaJump={jumpAssets.length > 0 ? { chainId: SOLANA_CHAIN_ID, assets: jumpAssets } : undefined}
    >
      <div className="space-y-4">
        <DailyVolumeChart history={history} deskVolume24hUsd={solanaChain?.volume24hUsd ?? null} />
        <ProvenanceBar provenance={provenance} compact />
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-medium">Chain volume</h2>
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
