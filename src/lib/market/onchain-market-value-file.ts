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

/** Production snapshot paths. Literals so the server trace stays inside this directory. */
function defaultVolumePath(chainId: string): string | null {
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

function defaultBackfillPath(chainId: string): string | null {
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

function defaultHolderPath(chainId: HolderSnapshotChainId): string {
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

/**
 * Read-only market value history for one chain desk.
 * Volume files supply closed Eastern days. A holder close on a closed day
 * the volume file skipped is included. Holder files supply supply × price.
 * A missing file is an empty history, not a fetch and not a write.
 */
export async function loadOnchainMarketValueHistory(
  chainId: string,
  nowT = Date.now() / 1000,
  volumeDir = DEFAULT_VOLUME_SNAPSHOT_DIR,
  holderDir = "data/holder-snapshots",
): Promise<OnchainMarketValueHistory> {
  const holderChain = holderSnapshotChainId(chainId);
  const file = SNAPSHOT_FILE_BY_CHAIN[chainId];
  if (!holderChain || !file) return structuredClone(EMPTY_ONCHAIN_MARKET_VALUE);
  const path =
    volumeDir === DEFAULT_VOLUME_SNAPSHOT_DIR
      ? defaultVolumePath(chainId)
      : join(/*turbopackIgnore: true*/ volumeDir, file);
  if (!path) return structuredClone(EMPTY_ONCHAIN_MARKET_VALUE);
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
  const backfillName = file.replace(/\.json$/, "-asset-daily.json");
  const backfill =
    volumeDir === DEFAULT_VOLUME_SNAPSHOT_DIR
      ? defaultBackfillPath(chainId)
      : join(/*turbopackIgnore: true*/ volumeDir, backfillName);
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
  const holders =
    holderDir === "data/holder-snapshots"
      ? defaultHolderPath(holderChain)
      : join(/*turbopackIgnore: true*/ holderDir, `${holderChain}.json`);
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
