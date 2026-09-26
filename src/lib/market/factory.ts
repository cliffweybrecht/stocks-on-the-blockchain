import { CompositeMarketDataSource } from "./composite-source";
import { EQUITY_CARD_DAY_VOLUME_SERIES_MAX } from "./equity-card-volume";
import { MockMarketDataSource } from "./mock-source";
import {
  SOLANA_DEFAULTS,
  SolanaMarketDataSource,
  type SolanaMarketDataSourceOptions,
} from "./solana-source";
import { TerminalMarketDataSource } from "./terminal-source";
import type { MarketDataSource } from "./types";

export type MarketEnv = Record<string, string | undefined>;

function envNumber(env: MarketEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

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

/** Same DexScreener / registry / snapshot-dir knobs the live desk uses. */
export function solanaSourceOptionsFromEnv(env: MarketEnv = process.env): SolanaMarketDataSourceOptions {
  return {
    baseUrl: getSolanaDexScreenerBaseUrl(env),
    timeoutMs: envNumber(env, "SOLANA_TIMEOUT_MS", SOLANA_DEFAULTS.timeoutMs),
    requestGapMs: envNumber(env, "SOLANA_REQUEST_GAP_MS", SOLANA_DEFAULTS.requestGapMs),
    cacheMs: envNumber(env, "SOLANA_CACHE_MS", SOLANA_DEFAULTS.cacheMs),
    maxConcurrent: envNumber(env, "SOLANA_MAX_CONCURRENT", SOLANA_DEFAULTS.maxConcurrent),
    homeBudgetMs: envNumber(env, "SOLANA_HOME_BUDGET_MS", SOLANA_DEFAULTS.homeBudgetMs),
    fullBudgetMs: envNumber(env, "SOLANA_FULL_BUDGET_MS", SOLANA_DEFAULTS.fullBudgetMs),
    enableRegistry: env.SOLANA_XSTOCKS_REGISTRY_ENABLED?.trim().toLowerCase() !== "false",
    registryBaseUrl: env.SOLANA_XSTOCKS_REGISTRY_URL?.trim() || undefined,
    enableOndoRegistry: env.SOLANA_ONDO_REGISTRY_ENABLED?.trim().toLowerCase() !== "false",
    ondoRegistryUrl: env.SOLANA_ONDO_REGISTRY_URL?.trim() || undefined,
    enableTesseraRegistry: env.SOLANA_TESSERA_REGISTRY_ENABLED?.trim().toLowerCase() !== "false",
    tesseraRegistryUrl: env.SOLANA_TESSERA_REGISTRY_URL?.trim() || undefined,
    enableSunriseRegistry: env.SOLANA_SUNRISE_REGISTRY_ENABLED?.trim().toLowerCase() !== "false",
    sunriseRegistryUrl: env.SOLANA_SUNRISE_REGISTRY_URL?.trim() || undefined,
    enableGeckoTerminal: env.SOLANA_GECKOTERMINAL_ENABLED?.trim().toLowerCase() !== "false",
    geckoTerminalBaseUrl: env.SOLANA_GECKOTERMINAL_BASE_URL?.trim() || undefined,
    enableJupiterTokenLogos: env.SOLANA_JUPITER_TOKEN_LOGOS_ENABLED?.trim().toLowerCase() !== "false",
    jupiterTokenBaseUrl: env.SOLANA_JUPITER_TOKEN_URL?.trim() || undefined,
    enableJupiterHolders: env.SOLANA_JUPITER_HOLDERS_ENABLED?.trim().toLowerCase() !== "false",
    rpcUrl: env.SOLANA_RPC_URL?.trim() || undefined,
    enableMintSupply: env.SOLANA_MINT_SUPPLY_ENABLED?.trim().toLowerCase() !== "false",
    enrichBudgetMs: envNumber(env, "SOLANA_ENRICH_BUDGET_MS", SOLANA_DEFAULTS.enrichBudgetMs),
    emptyCacheMs: envNumber(env, "SOLANA_EMPTY_CACHE_MS", SOLANA_DEFAULTS.emptyCacheMs),
    volumeHistoryCacheMs: envNumber(env, "SOLANA_VOLUME_HISTORY_CACHE_MS", SOLANA_DEFAULTS.volumeHistoryCacheMs),
    cardVolumeSeriesMax: envNumber(env, "SOLANA_CARD_VOLUME_SERIES_MAX", EQUITY_CARD_DAY_VOLUME_SERIES_MAX),
    volumeSnapshotDir: env.SOLANA_VOLUME_SNAPSHOT_DIR?.trim() || undefined,
  };
}

export function createSolanaMarketDataSource(
  env: MarketEnv = process.env,
  overrides: Partial<SolanaMarketDataSourceOptions> = {},
): SolanaMarketDataSource {
  return new SolanaMarketDataSource({
    ...solanaSourceOptionsFromEnv(env),
    ...overrides,
  });
}

function buildLiveAdapters(env: MarketEnv): MarketDataSource[] {
  const adapters: MarketDataSource[] = [];
  if (isSolanaMarketEnabled(env)) {
    adapters.push(createSolanaMarketDataSource(env));
  }
  const terminalUrl = getTerminalBaseUrl(env);
  if (terminalUrl) {
    adapters.push(new TerminalMarketDataSource(terminalUrl));
  }
  return adapters;
}

function buildSource(env: MarketEnv): MarketDataSource {
  const adapters = buildLiveAdapters(env);
  if (adapters.length === 0) {
    return new MockMarketDataSource();
  }
  if (adapters.length === 1) {
    return adapters[0] as MarketDataSource;
  }
  return new CompositeMarketDataSource(adapters);
}

function envFingerprint(env: MarketEnv): string {
  return [
    env.TERMINAL_BASE_URL,
    env.SOLANA_MARKET_ENABLED,
    env.SOLANA_DEXSCREENER_BASE_URL,
    env.SOLANA_TIMEOUT_MS,
    env.SOLANA_REQUEST_GAP_MS,
    env.SOLANA_CACHE_MS,
    env.SOLANA_MAX_CONCURRENT,
    env.SOLANA_HOME_BUDGET_MS,
    env.SOLANA_FULL_BUDGET_MS,
    env.SOLANA_ENRICH_BUDGET_MS,
    env.SOLANA_EMPTY_CACHE_MS,
    env.SOLANA_XSTOCKS_REGISTRY_ENABLED,
    env.SOLANA_XSTOCKS_REGISTRY_URL,
    env.SOLANA_ONDO_REGISTRY_ENABLED,
    env.SOLANA_ONDO_REGISTRY_URL,
    env.SOLANA_TESSERA_REGISTRY_ENABLED,
    env.SOLANA_TESSERA_REGISTRY_URL,
    env.SOLANA_SUNRISE_REGISTRY_ENABLED,
    env.SOLANA_SUNRISE_REGISTRY_URL,
    env.SOLANA_GECKOTERMINAL_ENABLED,
    env.SOLANA_GECKOTERMINAL_BASE_URL,
    env.SOLANA_JUPITER_TOKEN_LOGOS_ENABLED,
    env.SOLANA_JUPITER_TOKEN_URL,
    env.SOLANA_JUPITER_HOLDERS_ENABLED,
    env.SOLANA_RPC_URL,
    env.SOLANA_MINT_SUPPLY_ENABLED,
    env.SOLANA_VOLUME_HISTORY_CACHE_MS,
    env.SOLANA_VOLUME_SNAPSHOT_DIR,
  ].join("|");
}

let processSource: MarketDataSource | null = null;
let processSourceKey: string | null = null;

export function createLiveAdapters(env: MarketEnv = process.env): MarketDataSource[] {
  return buildLiveAdapters(env);
}

export function createMarketDataSource(env: MarketEnv = process.env): MarketDataSource {
  if (env === process.env) {
    const key = envFingerprint(env);
    if (!processSource || processSourceKey !== key) {
      processSource = buildSource(env);
      processSourceKey = key;
    }
    return processSource;
  }
  return buildSource(env);
}
