import { CompositeMarketDataSource } from "./composite-source";
import { MockMarketDataSource } from "./mock-source";
import { SolanaMarketDataSource } from "./solana-source";
import { TerminalMarketDataSource } from "./terminal-source";
import type { MarketDataSource } from "./types";

export type MarketEnv = Record<string, string | undefined>;

export function getTerminalBaseUrl(env: MarketEnv = process.env): string | null {
  const value = env.TERMINAL_BASE_URL?.trim();
  return value ? value : null;
}

export function isSolanaMarketEnabled(env: MarketEnv = process.env): boolean {
  const flag = env.SOLANA_MARKET_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

export function getSolanaDexScreenerBaseUrl(env: MarketEnv = process.env): string {
  return env.SOLANA_DEXSCREENER_BASE_URL?.trim() || "https://api.dexscreener.com";
}

export function createLiveAdapters(env: MarketEnv = process.env): MarketDataSource[] {
  const adapters: MarketDataSource[] = [];
  const terminalUrl = getTerminalBaseUrl(env);
  if (terminalUrl) {
    adapters.push(new TerminalMarketDataSource(terminalUrl));
  }
  if (isSolanaMarketEnabled(env)) {
    adapters.push(
      new SolanaMarketDataSource({
        baseUrl: getSolanaDexScreenerBaseUrl(env),
        timeoutMs: Number(env.SOLANA_TIMEOUT_MS ?? 15_000),
        requestGapMs: Number(env.SOLANA_REQUEST_GAP_MS ?? 200),
        enableRegistry: env.SOLANA_XSTOCKS_REGISTRY_ENABLED?.trim().toLowerCase() !== "false",
        registryBaseUrl: env.SOLANA_XSTOCKS_REGISTRY_URL?.trim() || undefined,
      }),
    );
  }
  return adapters;
}

export function createMarketDataSource(env: MarketEnv = process.env): MarketDataSource {
  const adapters = createLiveAdapters(env);
  if (adapters.length === 0) {
    return new MockMarketDataSource();
  }
  if (adapters.length === 1) {
    return adapters[0] as MarketDataSource;
  }
  return new CompositeMarketDataSource(adapters);
}
