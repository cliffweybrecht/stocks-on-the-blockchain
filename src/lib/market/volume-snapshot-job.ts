import { join } from "node:path";
import { createSolanaMarketDataSource, isSolanaMarketEnabled, type MarketEnv } from "./factory";
import type { MarketDataSource } from "./types";
import { FileDeskVolumeSnapshotStore } from "./volume-snapshot-store";
import {
  DEFAULT_VOLUME_SNAPSHOT_DIR,
  MemoryDeskVolumeSnapshotStore,
  recordDeskVolumeFromChain,
  SOLANA_VOLUME_SNAPSHOT_FILE,
  type DeskSnapshotAssetSource,
  type DeskVolumeSnapshotStore,
  type RecordDeskVolumeResult,
} from "./volume-snapshots";

export type DeskVolumeSnapshotSource = Pick<MarketDataSource, "getChain">;

function formatUsdLeg(value: number | null): string {
  return value === null ? "null" : String(value);
}

function snapshotAssetsFromDetail(detail: {
  assets: readonly DeskSnapshotAssetSource[];
  etfAssets?: readonly DeskSnapshotAssetSource[];
  privateAssets?: readonly DeskSnapshotAssetSource[];
}): DeskSnapshotAssetSource[] {
  return [...detail.assets, ...(detail.etfAssets ?? []), ...(detail.privateAssets ?? [])];
}

export async function runDeskVolumeSnapshotJob(input: {
  source: DeskVolumeSnapshotSource;
  store: DeskVolumeSnapshotStore;
}): Promise<RecordDeskVolumeResult> {
  let detail;
  try {
    detail = await input.source.getChain("solana");
  } catch (error) {
    const message = error instanceof Error ? error.message : "getChain threw.";
    return { ok: false, reason: `Solana DexScreener desk snapshot failed: ${message}` };
  }
  if (!detail) {
    return { ok: false, reason: 'Solana DexScreener desk snapshot failed: getChain("solana") returned null.' };
  }
  const generatedAt = detail.provenance.generatedAt ?? detail.provenance.fetchedAt;
  if (!generatedAt) {
    return { ok: false, reason: "Solana DexScreener desk snapshot failed: missing provenance timestamp." };
  }
  return recordDeskVolumeFromChain(
    input.store,
    detail.chain,
    generatedAt,
    undefined,
    snapshotAssetsFromDetail(detail),
  );
}

export function formatDeskVolumeSnapshotSuccess(
  result: Extract<RecordDeskVolumeResult, { ok: true }>,
  filePath: string,
): string {
  const action = result.unchanged ? "unchanged" : "wrote";
  const { snapshot } = result;
  const assetCount = snapshot.assets?.length ?? 0;
  return `snapshot:volume ${action} ${snapshot.date} combined=${formatUsdLeg(snapshot.combined24hUsd)} public=${formatUsdLeg(snapshot.publicEquity24hUsd)} private=${formatUsdLeg(snapshot.private24hUsd)} etf=${formatUsdLeg(snapshot.etfIndex24hUsd)} assets=${assetCount} -> ${filePath}`;
}

export async function runDeskVolumeSnapshotCli(options: {
  env?: MarketEnv;
  source?: DeskVolumeSnapshotSource;
  store?: DeskVolumeSnapshotStore;
  log?: (message: string) => void;
  error?: (message: string) => void;
} = {}): Promise<number> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  if (!isSolanaMarketEnabled(env)) {
    error(
      "snapshot:volume requires SOLANA_MARKET_ENABLED=true (live DexScreener Solana source, not the seed adapter).",
    );
    return 1;
  }
  const dir = env.SOLANA_VOLUME_SNAPSHOT_DIR?.trim() || DEFAULT_VOLUME_SNAPSHOT_DIR;
  const store = options.store ?? new FileDeskVolumeSnapshotStore(dir);
  const source =
    options.source ??
    createSolanaMarketDataSource(env, {
      backgroundEnrichment: false,
      // Fire-and-forget UI persist must not race the awaited CLI write.
      volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    });
  try {
    const result = await runDeskVolumeSnapshotJob({ source, store });
    if (!result.ok) {
      error(result.reason);
      return 1;
    }
    log(formatDeskVolumeSnapshotSuccess(result, join(dir, SOLANA_VOLUME_SNAPSHOT_FILE)));
    return 0;
  } catch (err) {
    error(err instanceof Error ? err.message : "snapshot:volume failed.");
    return 1;
  }
}
