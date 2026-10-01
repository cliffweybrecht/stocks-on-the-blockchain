import { findAssetByKey } from "./identity";
import { MOCK_ASSETS, MOCK_CHAINS, MOCK_DETAILS, MOCK_PRIVATE_ASSETS, mockProvenance } from "./mock-data";
import {
  emptyAllMarketsVolumeSnapshot,
  type AssetDetailResult,
  type AssetPriceHistoryResult,
  type ChainDetailResult,
  type ChainListResult,
  type DeskLiveRolling24h,
  type EquityVolumeHistoryResult,
  type MarketDataSource,
  type VolumeHistoryPoint,
} from "./types";
import { emptyAssetPriceHistory } from "./asset-price-history";
import { emptyEquityVolumeHistory } from "./volume-history";
import { emptyHourlyRollingVolumeHistory } from "./volume-hourly-snapshots";

export class MockMarketDataSource implements MarketDataSource {
  readonly id = "mock" as const;
  readonly label = "Seed market adapter";

  async listChains(): Promise<ChainListResult> {
    return {
      chains: MOCK_CHAINS,
      provenance: mockProvenance(),
    };
  }

  async getChain(chainId: string): Promise<ChainDetailResult | null> {
    const chain = MOCK_CHAINS.find((entry) => entry.id === chainId);
    const assets = MOCK_ASSETS[chainId];
    if (!chain || !assets) return null;
    return {
      chain,
      assets,
      privateAssets: MOCK_PRIVATE_ASSETS[chainId] ?? [],
      provenance: mockProvenance(),
    };
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    const chain = MOCK_CHAINS.find((entry) => entry.id === chainId);
    const asset = findAssetByKey(MOCK_DETAILS[chainId] ?? [], symbol);
    if (!chain || !asset) return null;
    return { chain, asset, provenance: mockProvenance() };
  }

  async getEquityVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    return emptyEquityVolumeHistory(
      "Seed adapter does not invent a historical volume series. Enable live Solana to record DexScreener 24h snapshots.",
    );
  }

  async getEquityHourlyRollingVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    return emptyHourlyRollingVolumeHistory(
      "Seed adapter does not invent hourly desk volume. Enable live Solana to read solana-hourly.json.",
    );
  }

  async getLiveDeskRolling24h(): Promise<DeskLiveRolling24h | null> {
    return null;
  }

  async getAssetPriceHistory(): Promise<AssetPriceHistoryResult> {
    return emptyAssetPriceHistory(
      "Seed adapter does not invent a price series. Enable live Solana to load GeckoTerminal pool closes.",
    );
  }

  async getEquityCardDayVolumeSeries(): Promise<Record<string, VolumeHistoryPoint[]>> {
    return {};
  }

  async getEquityCardDayVolumeSeriesSnapshot() {
    return { series: {}, pending: false };
  }

  async getAssetAllMarketsVolumeSnapshot() {
    return emptyAllMarketsVolumeSnapshot();
  }
}
