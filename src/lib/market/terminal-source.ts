import { TERMINAL_SOURCE_NOTE } from "./trust";
import {
  enrichDetailFromTerminal,
  mapTerminalSnapshot,
  unwrapSnapshot,
  type TerminalAssetLiquidityProfile,
  type TerminalPriceComparison,
} from "./map-terminal";
import { ROBINHOOD_CHAIN_ID, emptyAllMarketsVolumeSnapshot, type AssetDetailResult, type AssetPriceHistoryResult, type ChainDetailResult, type ChainListResult, type EquityVolumeHistoryResult, type MarketDataSource, type VolumeHistoryPoint } from "./types";
import { emptyAssetPriceHistory } from "./asset-price-history";
import { emptyEquityVolumeHistory } from "./volume-history";

interface CachedSnapshot {
  mapped: ReturnType<typeof mapTerminalSnapshot>;
  expiresAt: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CACHE_MS = 60_000;

function terminalSingleton(): { cache: CachedSnapshot | null } {
  const globalForCache = globalThis as typeof globalThis & {
    __sotbTerminalCache?: { cache: CachedSnapshot | null };
  };
  if (!globalForCache.__sotbTerminalCache) {
    globalForCache.__sotbTerminalCache = { cache: null };
  }
  return globalForCache.__sotbTerminalCache;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Terminal ${response.status} from ${url}`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Terminal did not respond within ${Math.round(timeoutMs / 1000)}s. A cold market snapshot can take several minutes.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export class TerminalMarketDataSource implements MarketDataSource {
  readonly id = "terminal" as const;
  readonly label = "Robinhood Liquidity Terminal";

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = Number(process.env.TERMINAL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  ) {}

  private async loadMapped() {
    const store = terminalSingleton();
    const now = Date.now();
    if (store.cache && store.cache.expiresAt > now) {
      return store.cache.mapped;
    }

    const payload = await fetchJson(joinUrl(this.baseUrl, "/api/market/liquidity"), this.timeoutMs);
    const { snapshot, cacheStatus, cacheAgeMs } = unwrapSnapshot(payload);
    const mapped = mapTerminalSnapshot({
      snapshot,
      cacheStatus,
      cacheAgeMs,
      fetchedAt: new Date().toISOString(),
      sourceId: "terminal",
      sourceLabel: this.label,
      notes: [TERMINAL_SOURCE_NOTE],
    });
    store.cache = { mapped, expiresAt: now + DEFAULT_CACHE_MS };
    return mapped;
  }

  async listChains(): Promise<ChainListResult> {
    const mapped = await this.loadMapped();
    return { chains: [mapped.chain], provenance: mapped.provenance };
  }

  async getChain(chainId: string): Promise<ChainDetailResult | null> {
    if (chainId !== ROBINHOOD_CHAIN_ID) return null;
    const mapped = await this.loadMapped();
    return { chain: mapped.chain, assets: mapped.assets, provenance: mapped.provenance };
  }

  async getAsset(chainId: string, symbol: string): Promise<AssetDetailResult | null> {
    if (chainId !== ROBINHOOD_CHAIN_ID) return null;
    const mapped = await this.loadMapped();
    const base = mapped.details.find((row) => row.symbol.toLowerCase() === symbol.toLowerCase());
    if (!base) return null;

    let asset = base;
    const [profile, comparison] = await Promise.all([
      this.tryAssetEndpoint<TerminalAssetLiquidityProfile>(`/api/assets/${encodeURIComponent(base.symbol)}/liquidity`),
      this.tryAssetEndpoint<TerminalPriceComparison>(`/api/assets/${encodeURIComponent(base.symbol)}/price`),
    ]);
    asset = enrichDetailFromTerminal(base, profile, comparison);

    return { chain: mapped.chain, asset, provenance: mapped.provenance };
  }

  async getEquityVolumeHistory(): Promise<EquityVolumeHistoryResult> {
    return emptyEquityVolumeHistory(
      "Robinhood Terminal has no Solana desk snapshots. This series is DexScreener 24h history for classified Solana stocks only.",
    );
  }

  async getAssetPriceHistory(): Promise<AssetPriceHistoryResult> {
    return emptyAssetPriceHistory(
      "Robinhood Terminal has no GeckoTerminal price candles. This series is pool USD closes for Solana mints only.",
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

  private async tryAssetEndpoint<T>(path: string): Promise<T | null> {
    try {
      const payload = await fetchJson(joinUrl(this.baseUrl, path), Math.min(this.timeoutMs, 20_000));
      if (!payload || typeof payload !== "object") return null;
      const envelope = payload as { data?: T };
      return (envelope.data ?? payload) as T;
    } catch {
      return null;
    }
  }
}
