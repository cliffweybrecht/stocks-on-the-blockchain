import { DeskVolumeRangeProvider } from "@/components/desk-volume-range";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { HolderSupplyPanel } from "@/components/holder-supply-panel";
import { HomeChainVolume } from "@/components/home-chain-volume";
import { PageShell } from "@/components/page-shell";
import { DailyVolumeChart } from "@/components/daily-volume-chart";
import { selectEquityPriceTicker } from "@/lib/desk/price-ticker";
import { loadSolanaDeskLaneDays, overlayHistoryWithSolanaAssetBackfill } from "@/lib/market/asset-backfill-desk-file";
import { toJumpAsset } from "@/lib/market/asset-search";
import { solanaDeskFallbackDetail, withDocumentBudget } from "@/lib/market/document-budget";
import { createMarketDataSource } from "@/lib/market/factory";
import { BASE_DESK } from "@/lib/market/base-desk-volume";
import { BNB_DESK } from "@/lib/market/bnb-desk-volume";
import {
  homeChainsWithSnapshotDesks,
  robinhoodHomeChainVolume,
  snapshotHomeChainVolume,
} from "@/lib/market/home-desk-volume";
import { homeChainClosedRangeBoard, type HomeDeskLaneDay } from "@/lib/market/home-chain-range";
import { closedRobinhoodDeskDays, type RobinhoodDeskDay } from "@/lib/market/robinhood-desk-volume";
import { loadClosedRobinhoodDeskDays } from "@/lib/market/robinhood-desk-volume-file";
import { closedSnapshotDeskDays, type SnapshotDeskDay } from "@/lib/market/snapshot-desk-volume";
import { loadClosedSnapshotDeskDays } from "@/lib/market/snapshot-desk-volume-file";
import { SOLANA_CHAIN_ID, type AssetSummary } from "@/lib/market/types";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";
import { emptyHourlyRollingVolumeHistory } from "@/lib/market/volume-hourly-snapshots";
import { FileDeskVolumeSnapshotStore } from "@/lib/market/volume-snapshot-store";
import { closedSnapshotVolumePoints } from "@/lib/market/volume-snapshots";
import { combineHolderDeskPoints, holderDeskPoints, holderPanelPoints } from "@/lib/market/holder-snapshots";
import { loadHolderSnapshotFile } from "@/lib/market/holder-snapshot-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const source = createMarketDataSource();

  let loaded;
  try {
    // Closed snapshot days are a file read. Live discovery keeps running after
    // the budget so a cold desk cannot hold the document for the full hydrate.
    void source.getEquityVolumeHistory().catch(() => undefined);
    const [historySettled, hourlySettled, chainsResult] = await Promise.all([
      source.getClosedDeskVolumeHistory().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ),
      source.getEquityHourlyRollingVolumeHistory().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      ),
      withDocumentBudget(source.listChains(), null),
    ]);
    const history = await overlayHistoryWithSolanaAssetBackfill(
      historySettled.status === "fulfilled"
        ? historySettled.value
        : emptyEquityVolumeHistory(
            historySettled.reason instanceof Error
              ? historySettled.reason.message
              : "Historical volume series is unavailable.",
          ),
    );
    const hourlyHistory =
      hourlySettled.status === "fulfilled"
        ? hourlySettled.value
        : emptyHourlyRollingVolumeHistory(
            hourlySettled.reason instanceof Error
              ? hourlySettled.reason.message
              : "Hourly rolling volume series is unavailable.",
          );
    let chains = chainsResult;
    if (!chains) {
      const fallback = solanaDeskFallbackDetail(await new FileDeskVolumeSnapshotStore().load());
      if (!fallback) {
        throw new Error(
          "Solana discovery did not finish inside the page budget, and there is no closed desk snapshot to show.",
        );
      }
      chains = { chains: [fallback.chain], provenance: fallback.provenance };
    }
    loaded = { ...chains, history, hourlyHistory };
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
  const chainDetails = await Promise.all(
    listedChains.map(async (chain, index) => {
      try {
        return { index, chainId: chain.id, detail: await withDocumentBudget(source.getChain(chain.id), null) };
      } catch {
        // Skip a chain that listed but failed to hydrate. Do not invent ticker rows.
        return { index, chainId: chain.id, detail: null };
      }
    }),
  );
  for (const { index, chainId, detail } of chainDetails) {
    if (!detail) continue;
    tickerAssets.push(...detail.assets);
    if (chainId === SOLANA_CHAIN_ID) {
      // Prefer the all-pools desk rollup for the headline and Solana card.
      chains[index] = detail.chain;
      jumpAssets = [...detail.assets, ...(detail.etfAssets ?? [])].map(toJumpAsset);
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
  const priceTicker = selectEquityPriceTicker(tickerAssets);
  const solanaChain = chains.find((chain) => chain.id === SOLANA_CHAIN_ID) ?? null;
  const parsedGeneratedAt = Date.parse(history.generatedAt);
  const deskNowT = Number.isFinite(parsedGeneratedAt)
    ? parsedGeneratedAt / 1000
    : (history.points[history.points.length - 1]?.t ?? 0);
  const solanaClosed = closedSnapshotVolumePoints(history.points, deskNowT);
  const robinhoodClosed = closedRobinhoodDeskDays(robinhoodDays, deskNowT);
  const baseClosed = closedSnapshotDeskDays(baseDays, deskNowT);
  const bnbClosed = closedSnapshotDeskDays(bnbDays, deskNowT);
  const solanaLanes: HomeDeskLaneDay[] = await loadSolanaDeskLaneDays();
  const [solanaHolders, baseHolders, bnbHolders, robinhoodHolders] = await Promise.all([
    loadHolderSnapshotFile("solana"),
    loadHolderSnapshotFile("base"),
    loadHolderSnapshotFile("bnb"),
    loadHolderSnapshotFile("robinhood"),
  ]);
  const holderPoints = holderPanelPoints(
    combineHolderDeskPoints([
      holderDeskPoints(solanaHolders),
      holderDeskPoints(baseHolders),
      holderDeskPoints(bnbHolders),
      holderDeskPoints(robinhoodHolders),
    ]),
  );
  const chainRanges = homeChainClosedRangeBoard({
    solanaClosed,
    solanaLanes,
    robinhoodDays: robinhoodClosed,
    baseDays: baseClosed,
    bnbDays: bnbClosed,
  });

  return (
    <PageShell
      provenance={provenance}
      priceTicker={priceTicker}
      solanaJump={jumpAssets.length > 0 ? { chainId: SOLANA_CHAIN_ID, assets: jumpAssets } : undefined}
    >
      <DeskVolumeRangeProvider volumes={{}} initialRange="7d">
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
          <HolderSupplyPanel
            kicker="Holders and tokenized supply"
            points={holderPoints}
            footnote="Sum of per-token holders across Solana, Base, Robinhood Chain, and BNB Chain. Not unique wallets, and a wallet on two chains is counted twice. Separate from volume."
          />
          <section className="space-y-3">
            <h2 className="font-heading text-lg font-medium">Chain volume</h2>
            {rankedChains.length === 0 ? (
              <EmptyState
                title="No chains reported"
                detail="The configured market sources returned zero chains. A live adapter that failed is listed in provenance rather than filled with invented volume."
              />
            ) : (
              <HomeChainVolume chains={rankedChains} ranges={chainRanges} />
            )}
          </section>
        </div>
      </DeskVolumeRangeProvider>
    </PageShell>
  );
}
