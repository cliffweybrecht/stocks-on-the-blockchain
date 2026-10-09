import { sortByVolumeThenLiquidity } from "./aggregate";
import { COMPOSITE_SOURCE_NOTE } from "./trust";
import {
  SOLANA_CHAIN_ID,
  emptyAllMarketsVolumeSnapshot,
  type AssetAllMarketsVolumeSnapshot,
  type AssetDetailResult,
  type AssetPriceHistoryResult,
  type AssetReadOptions,
  type ChainDetailResult,
  type ChainListResult,
  type DataProvenance,
  type DeskLiveRolling24h,
  type EquityVolumeHistoryResult,
  type MarketDataSource,
  type SourceFailure,
  type VolumeHistoryPoint,
} from "./types";
import { emptyAssetPriceHistory } from "./asset-price-history";
import { emptyEquityVolumeHistory } from "./volume-history";
import { emptyHourlyRollingVolumeHistory } from "./volume-hourly-snapshots";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown adapter failure.";
}

export class CompositeMarketDataSource implements MarketDataSource {
  readonly id = "composite" as const;
  readonly label: string;

  constructor(readonly adapters: readonly MarketDataSource[]) {
    if (adapters.length === 0) {
      throw new Error("CompositeMarketDataSource requires at least one adapter.");
    }
    this.label = `Composite (${adapters.map((adapter) => adapter.label).join(" + ")})`;
  }

  async listChains(): Promise<ChainListResult> {
    const settled = await Promise.allSettled(this.adapters.map((adapter) => adapter.listChains()));
    const chains: ChainListResult["chains"] = [];
    const failures: SourceFailure[] = [];
    const notes = [COMPOSITE_SOURCE_NOTE];
    const fetchedAt = new Date().toISOString();
    let generatedAt: string | null = null;

    settled.forEach((result, index) => {
      const adapter = this.adapters[index];
      if (!adapter) return;
      if (result.status === "fulfilled") {
        chains.push(...result.value.chains);
        notes.push(...result.value.provenance.notes);
        generatedAt = generatedAt ?? result.value.provenance.generatedAt;
        failures.push(...result.value.provenance.sourceFailures);
        return;
      }
      failures.push({
        sourceId: adapter.id,
        sourceLabel: adapter.label,
        message: errorMessage(result.reason),
      });
    });

    if (chains.length === 0 && failures.length === this.adapters.length) {
      throw new Error(failures.map((failure) => `${failure.sourceLabel}: ${failure.message}`).join(" · "));
    }

    const hasSolana = chains.some((chain) => chain.id === SOLANA_CHAIN_ID);
    const loudFailures: SourceFailure[] = [];
    let terminalFailed = false;
    for (const failure of failures) {
      if (hasSolana && failure.sourceId === "terminal") {
        terminalFailed = true;
        notes.push(
          `Robinhood Terminal unavailable (${failure.message}). Solana coverage is shown from DexScreener; Terminal is a secondary source and is not required for this desk.`,
        );
        continue;
      }
      loudFailures.push(failure);
    }

    const solanaAdapter = this.adapters.find((adapter) => adapter.id === "solana");
    const provenance: DataProvenance = {
      sourceId: "composite",
      sourceLabel: terminalFailed && solanaAdapter ? solanaAdapter.label : this.label,
      fetchedAt,
      generatedAt,
      refreshStartedAt: fetchedAt,
      refreshDurationMs: null,
      cacheStatus: loudFailures.length > 0 ? "partial" : "fresh",
      cacheAgeMs: 0,
      notes,
      sourceFailures: loudFailures,
    };

    return {
      chains: sortByVolumeThenLiquidity(chains),
      provenance,
    };
  }

  async getChain(chainId: string): Promise<ChainDetailResult | null> {
    const errors: Error[] = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.getChain(chainId);
        if (result) return result;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
    return null;
  }

  async getAsset(
    chainId: string,
    symbol: string,
    options?: AssetReadOptions,
  ): Promise<AssetDetailResult | null> {
    const errors: Error[] = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.getAsset(chainId, symbol, options);
        if (result) return result;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    }
    if (errors.length > 0) {
      throw errors[0];
    }
    return null;
  }

  async getEquityVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana) {
      return emptyEquityVolumeHistory(
        "No Solana adapter is configured, so there is no classified equity pool history to load.",
      );
    }
    return solana.getEquityVolumeHistory();
  }

  async getEquityHourlyRollingVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana) {
      return emptyHourlyRollingVolumeHistory(
        "No Solana adapter is configured, so there is no hourly DexScreener desk volume to load.",
      );
    }
    return solana.getEquityHourlyRollingVolumeHistory();
  }

  async getClosedDeskVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana) {
      return emptyEquityVolumeHistory(
        "No Solana adapter is configured, so there is no closed desk snapshot history to load.",
      );
    }
    return solana.getClosedDeskVolumeHistory();
  }

  async getLiveDeskRolling24h(): Promise<DeskLiveRolling24h | null> {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana) return null;
    return solana.getLiveDeskRolling24h();
  }

  async getEquityCardDayVolumeSeries(): Promise<Record<string, VolumeHistoryPoint[]>> {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana) return {};
    return solana.getEquityCardDayVolumeSeries();
  }

  async getEquityCardDayVolumeSeriesSnapshot() {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana) return { series: {}, pending: false };
    return solana.getEquityCardDayVolumeSeriesSnapshot();
  }

  async getAssetAllMarketsVolumeSnapshot(
    chainId: string,
    symbol: string,
    mint?: string,
  ): Promise<AssetAllMarketsVolumeSnapshot> {
    const solana = this.adapters.find((adapter) => adapter.id === "solana");
    if (!solana || chainId !== SOLANA_CHAIN_ID) return emptyAllMarketsVolumeSnapshot();
    return solana.getAssetAllMarketsVolumeSnapshot(chainId, symbol, mint);
  }

  async getAssetPriceHistory(chainId: string, symbol: string): Promise<AssetPriceHistoryResult> {
    const errors: Error[] = [];
    for (const adapter of this.adapters) {
      try {
        const result = await adapter.getAssetPriceHistory(chainId, symbol);
        if (result.available || adapter.id === "solana") return result;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(errorMessage(error)));
      }
    }
    if (errors.length > 0) {
      return emptyAssetPriceHistory(errors[0]!.message);
    }
    return emptyAssetPriceHistory("No adapter returned a price series for this mint.");
  }
}
