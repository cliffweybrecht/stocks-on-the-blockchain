import { join } from "node:path";
import { createSolanaMarketDataSource, isSolanaMarketEnabled, type MarketEnv } from "./factory";
import type { MarketDataSource } from "./types";
import { FileDeskHourlyVolumeSnapshotStore } from "./volume-hourly-snapshot-store";
import {
  deskHourlyVolumeSnapshotLabel,
  recordDeskHourlyVolumeFromDetail,
  SOLANA_HOURLY_VOLUME_SNAPSHOT_FILE,
  type DeskHourlyVolumeSnapshotStore,
  type RecordDeskHourlyVolumeResult,
} from "./volume-hourly-snapshots";
import { DEFAULT_VOLUME_SNAPSHOT_DIR, MemoryDeskVolumeSnapshotStore } from "./volume-snapshots";

export type DeskHourlyVolumeSnapshotSource = Pick<MarketDataSource, "getChain">;

function formatUsdLeg(value: number | null): string {
  return value === null ? "null" : String(value);
}

export async function runDeskHourlyVolumeSnapshotJob(input: {
  source: DeskHourlyVolumeSnapshotSource;
  store: DeskHourlyVolumeSnapshotStore;
  nowT?: number;
}): Promise<RecordDeskHourlyVolumeResult> {
  let detail;
  try {
    detail = await input.source.getChain("solana");
  } catch (error) {
    const message = error instanceof Error ? error.message : "getChain threw.";
    return { ok: false, reason: `Solana DexScreener hourly desk snapshot failed: ${message}` };
  }
  if (!detail) {
    return {
      ok: false,
      reason: 'Solana DexScreener hourly desk snapshot failed: getChain("solana") returned null.',
    };
  }
  const generatedAt = detail.provenance.generatedAt ?? detail.provenance.fetchedAt;
  if (!generatedAt) {
    return { ok: false, reason: "Solana DexScreener hourly desk snapshot failed: missing provenance timestamp." };
  }
  return recordDeskHourlyVolumeFromDetail(input.store, detail, generatedAt, input.nowT);
}

export function formatDeskHourlyVolumeSnapshotSuccess(
  result: Extract<RecordDeskHourlyVolumeResult, { ok: true }>,
  filePath: string,
): string {
  const action = result.unchanged ? "unchanged" : "wrote";
  const { snapshot } = result;
  return `snapshot:volume:hourly ${action} ${deskHourlyVolumeSnapshotLabel(snapshot)} combined=${formatUsdLeg(snapshot.combined24hUsd)} public=${formatUsdLeg(snapshot.publicEquity24hUsd)} private=${formatUsdLeg(snapshot.private24hUsd)} etf=${formatUsdLeg(snapshot.etfIndex24hUsd)} liq=${formatUsdLeg(snapshot.combinedLiquidityUsd)} -> ${filePath}`;
}

export async function runDeskHourlyVolumeSnapshotCli(options: {
  env?: MarketEnv;
  source?: DeskHourlyVolumeSnapshotSource;
  store?: DeskHourlyVolumeSnapshotStore;
  log?: (message: string) => void;
  error?: (message: string) => void;
} = {}): Promise<number> {
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  if (!isSolanaMarketEnabled(env)) {
    error(
      "snapshot:volume:hourly requires SOLANA_MARKET_ENABLED=true (live DexScreener Solana source, not the seed adapter).",
    );
    return 1;
  }
  const dir = env.SOLANA_VOLUME_SNAPSHOT_DIR?.trim() || DEFAULT_VOLUME_SNAPSHOT_DIR;
  const store = options.store ?? new FileDeskHourlyVolumeSnapshotStore(dir);
  const source =
    options.source ??
    createSolanaMarketDataSource(env, {
      backgroundEnrichment: false,
      // The desk source also persists a closed-day row. Keep that write off
      // solana.json so an hourly run cannot replace the daily series.
      volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    });
  try {
    const result = await runDeskHourlyVolumeSnapshotJob({ source, store });
    if (!result.ok) {
      error(result.reason);
      return 1;
    }
    log(formatDeskHourlyVolumeSnapshotSuccess(result, join(dir, SOLANA_HOURLY_VOLUME_SNAPSHOT_FILE)));
    return 0;
  } catch (err) {
    error(err instanceof Error ? err.message : "snapshot:volume:hourly failed.");
    return 1;
  }
}
