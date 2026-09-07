import { findAssetByKey } from "./identity";
import { MOCK_ASSETS, MOCK_CHAINS, MOCK_DETAILS, mockProvenance } from "./mock-data";
import type {
  AssetDetailResult,
  ChainDetailResult,
  ChainListResult,
  MarketDataSource,
} from "./types";

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
    return { chain, assets, provenance: mockProvenance() };
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    const chain = MOCK_CHAINS.find((entry) => entry.id === chainId);
    const asset = findAssetByKey(MOCK_DETAILS[chainId] ?? [], symbol);
    if (!chain || !asset) return null;
    return { chain, asset, provenance: mockProvenance() };
  }
}
