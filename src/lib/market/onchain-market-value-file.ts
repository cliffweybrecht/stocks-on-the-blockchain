import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BASE_DESK } from "./base-desk-volume";
import { BNB_DESK } from "./bnb-desk-volume";
import { holderSnapshotChainId, parseHolderSnapshotFile, type HolderSnapshotChainId } from "./holder-snapshots";
import {
  EMPTY_ONCHAIN_MARKET_VALUE,
  onchainMarketValueHistoryFromPayloads,
  type OnchainMarketValueHistory,
} from "./onchain-market-value";
import { ROBINHOOD_VOLUME_SNAPSHOT_FILE } from "./robinhood-desk-volume";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID } from "./types";
import { DEFAULT_VOLUME_SNAPSHOT_DIR, SOLANA_VOLUME_SNAPSHOT_FILE, easternDayKey } from "./volume-snapshots";

const SNAPSHOT_FILE_BY_CHAIN: Record<string, string> = {
  [SOLANA_CHAIN_ID]: SOLANA_VOLUME_SNAPSHOT_FILE,
  [ROBINHOOD_CHAIN_ID]: ROBINHOOD_VOLUME_SNAPSHOT_FILE,
  [BASE_CHAIN_ID]: BASE_DESK.file,
  [BNB_CHAIN_ID]: BNB_DESK.file,
};

interface CacheEntry {
  key: string;
  history: OnchainMarketValueHistory;
}

const cache = new Map<string, CacheEntry>();

/** Test hook. The desk cache is process-local. */
export function resetOnchainMarketValueCache(): void {
  cache.clear();
}

function volumePath(chainId: string, volumeDir: string): string | null {
  const file = SNAPSHOT_FILE_BY_CHAIN[chainId];
  if (!file) return null;
  if (volumeDir === DEFAULT_VOLUME_SNAPSHOT_DIR) {
    switch (chainId) {
      case SOLANA_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "solana.json");
      case ROBINHOOD_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "robinhood.json");
      case BASE_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "base.json");
      case BNB_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "bnb.json");
      default:
        return null;
    }
  }
  return join(/*turbopackIgnore: true*/ volumeDir, file);
}

function backfillPath(chainId: string, volumeDir: string): string | null {
  const file = SNAPSHOT_FILE_BY_CHAIN[chainId];
  if (!file) return null;
  const name = file.replace(/\.json$/, "-asset-daily.json");
  if (volumeDir === DEFAULT_VOLUME_SNAPSHOT_DIR) {
    switch (chainId) {
      case SOLANA_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "solana-asset-daily.json");
      case ROBINHOOD_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "robinhood-asset-daily.json");
      case BASE_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "base-asset-daily.json");
      case BNB_CHAIN_ID:
        return join(process.cwd(), "data", "volume-snapshots", "bnb-asset-daily.json");
      default:
        return null;
    }
  }
  return join(/*turbopackIgnore: true*/ volumeDir, name);
}

function holderPath(chainId: HolderSnapshotChainId, holderDir: string): string {
  const file = `${chainId}.json`;
  if (holderDir === "data/holder-snapshots") {
    switch (chainId) {
      case "solana":
        return join(process.cwd(), "data", "holder-snapshots", "solana.json");
      case "base":
        return join(process.cwd(), "data", "holder-snapshots", "base.json");
      case "bnb":
        return join(process.cwd(), "data", "holder-snapshots", "bnb.json");
      case "robinhood":
        return join(process.cwd(), "data", "holder-snapshots", "robinhood.json");
    }
  }
  return join(/*turbopackIgnore: true*/ holderDir, file);
}

/**
 * Read-only market value history for one chain desk.
 * Volume files supply the closed Eastern day window. Holder files supply
 * supply × price. A missing file is an empty history, not a fetch and not a write.
 */
export async function loadOnchainMarketValueHistory(
  chainId: string,
  nowT = Date.now() / 1000,
  volumeDir = DEFAULT_VOLUME_SNAPSHOT_DIR,
  holderDir = "data/holder-snapshots",
): Promise<OnchainMarketValueHistory> {
  const holderChain = holderSnapshotChainId(chainId);
  const path = volumePath(chainId, volumeDir);
  if (!holderChain || !path) return structuredClone(EMPTY_ONCHAIN_MARKET_VALUE);
  const dayKey = easternDayKey(nowT);
  if (!dayKey) return structuredClone(EMPTY_ONCHAIN_MARKET_VALUE);
  let volumeMtime = 0;
  let volumePayload: unknown = null;
  try {
    volumeMtime = (await stat(path)).mtimeMs;
    volumePayload = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return structuredClone(EMPTY_ONCHAIN_MARKET_VALUE);
  }
  const backfill = backfillPath(chainId, volumeDir);
  let backfillMtime = 0;
  let backfillPayload: unknown = null;
  if (backfill) {
    try {
      backfillMtime = (await stat(backfill)).mtimeMs;
      backfillPayload = JSON.parse(await readFile(backfill, "utf8"));
    } catch {
      backfillPayload = null;
      backfillMtime = 0;
    }
  }
  const holders = holderPath(holderChain, holderDir);
  let holderMtime = 0;
  let holderFile = null;
  try {
    holderMtime = (await stat(holders)).mtimeMs;
    holderFile = parseHolderSnapshotFile(JSON.parse(await readFile(holders, "utf8")), holderChain);
  } catch {
    holderFile = null;
    holderMtime = 0;
  }
  const key = `${volumeMtime}:${backfillMtime}:${holderMtime}:${dayKey}`;
  const hit = cache.get(path + holderChain);
  if (hit && hit.key === key) return structuredClone(hit.history);
  const history = onchainMarketValueHistoryFromPayloads(volumePayload, holderFile, nowT, backfillPayload);
  const stored = structuredClone(history);
  cache.set(path + holderChain, { key, history: stored });
  return structuredClone(stored);
}
