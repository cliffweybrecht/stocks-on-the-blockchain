import { ChainVolumeCard } from "@/components/chain-volume-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageShell } from "@/components/page-shell";
import { DailyVolumeChart } from "@/components/daily-volume-chart";
import { selectEquityPriceTicker } from "@/lib/desk/price-ticker";
import { chainCombinedVolume24h } from "@/lib/market/aggregate";
import { toJumpAsset } from "@/lib/market/asset-search";
import { createMarketDataSource } from "@/lib/market/factory";
import { BASE_DESK } from "@/lib/market/base-desk-volume";
import { BNB_DESK } from "@/lib/market/bnb-desk-volume";
import {
  homeChainsWithSnapshotDesks,
  robinhoodHomeChainVolume,
  robinhoodHomeVolumeDetail,
  snapshotHomeChainVolume,
  snapshotHomeVolumeDetail,
} from "@/lib/market/home-desk-volume";
import { maxNullable } from "@/lib/market/numbers";
import { loadClosedRobinhoodDeskDays } from "@/lib/market/robinhood-desk-volume-file";
import type { RobinhoodDeskDay } from "@/lib/market/robinhood-desk-volume";
import { loadClosedSnapshotDeskDays } from "@/lib/market/snapshot-desk-volume-file";
import type { SnapshotDeskDay } from "@/lib/market/snapshot-desk-volume";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type AssetSummary } from "@/lib/market/types";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";
import { emptyHourlyRollingVolumeHistory } from "@/lib/market/volume-hourly-snapshots";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = createMarketDataSource();

  let loaded;
  try {
    const [chainsSettled, historySettled, hourlySettled] = await Promise.allSettled([
      source.listChains(),
      source.getEquityVolumeHistory(),
      source.getEquityHourlyRollingVolumeHistory(),
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
    const hourlyHistory =
      hourlySettled.status === "fulfilled"
        ? hourlySettled.value
        : emptyHourlyRollingVolumeHistory(
            hourlySettled.reason instanceof Error
              ? hourlySettled.reason.message
              : "Hourly rolling volume series is unavailable.",
          );
    loaded = { ...chainsSettled.value, history, hourlyHistory };
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

  const { chains: listedChains, provenance, history, hourlyHistory } = loaded;
  const tickerAssets: AssetSummary[] = [];
  let jumpAssets: ReturnType<typeof toJumpAsset>[] = [];
  const chains = [...listedChains];
  for (const [index, chain] of listedChains.entries()) {
    try {
      const detail = await source.getChain(chain.id);
      if (!detail) continue;
      tickerAssets.push(...detail.assets);
      if (chain.id === SOLANA_CHAIN_ID) {
        // Prefer the all-pools desk rollup for the headline and Solana card.
        chains[index] = detail.chain;
        jumpAssets = [...detail.assets, ...(detail.etfAssets ?? [])].map(toJumpAsset);
      }
    } catch {
      // Skip a chain that listed but failed to hydrate. Do not invent ticker rows.
    }
  }
  let robinhoodDays: RobinhoodDeskDay[] = [];
  let baseDays: SnapshotDeskDay[] = [];
  let bnbDays: SnapshotDeskDay[] = [];
  try {
    robinhoodDays = await loadClosedRobinhoodDeskDays();
  } catch {
    // Missing Robinhood snapshots leave the Solana desk in place. Do not invent volume.
    robinhoodDays = [];
  }
  try {
    [baseDays, bnbDays] = await Promise.all([
      loadClosedSnapshotDeskDays(BASE_DESK),
      loadClosedSnapshotDeskDays(BNB_DESK),
    ]);
  } catch {
    // A missing Base or BNB file leaves that chain's volume null. Do not invent bars.
    baseDays = [];
    bnbDays = [];
  }
  const rankedChains = homeChainsWithSnapshotDesks(chains, [
    robinhoodHomeChainVolume(robinhoodDays),
    snapshotHomeChainVolume(BASE_DESK, baseDays),
    snapshotHomeChainVolume(BNB_DESK, bnbDays),
  ]);
  const maxVolume = maxNullable(rankedChains.map(chainCombinedVolume24h));
  const priceTicker = selectEquityPriceTicker(tickerAssets);
  const solanaChain = chains.find((chain) => chain.id === SOLANA_CHAIN_ID) ?? null;

  return (
    <PageShell
      provenance={provenance}
      priceTicker={priceTicker}
      solanaJump={jumpAssets.length > 0 ? { chainId: SOLANA_CHAIN_ID, assets: jumpAssets } : undefined}
    >
      <div className="space-y-4">
        <DailyVolumeChart
          history={history}
          hourlyHistory={hourlyHistory}
          rolling24h={
            solanaChain
              ? {
                  publicVolume24hUsd: solanaChain.volume24hUsd,
                  privateVolume24hUsd: solanaChain.privateVolume24hUsd,
                  etfVolume24hUsd: solanaChain.etfVolume24hUsd,
                }
              : null
          }
          robinhoodDays={robinhoodDays}
          extraDeskDays={[
            { label: BASE_DESK.name, days: baseDays },
            { label: BNB_DESK.name, days: bnbDays },
          ]}
        />
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-medium">Chain volume</h2>
          {rankedChains.length === 0 ? (
            <EmptyState
              title="No chains reported"
              detail="The configured market sources returned zero chains. A live adapter that failed is listed in provenance rather than filled with invented volume."
            />
          ) : (
            <div className="grid gap-4">
              {rankedChains.map((chain, index) => (
                <ChainVolumeCard
                  key={chain.id}
                  chain={chain}
                  rank={index + 1}
                  maxVolume={maxVolume}
                  detail={
                    chain.id === ROBINHOOD_CHAIN_ID
                      ? robinhoodHomeVolumeDetail(robinhoodDays)
                      : chain.id === BASE_CHAIN_ID
                        ? snapshotHomeVolumeDetail(baseDays, BASE_DESK.name)
                        : chain.id === BNB_CHAIN_ID
                          ? snapshotHomeVolumeDetail(bnbDays, BNB_DESK.name)
                          : null
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
