import { join } from "node:path";
import { createSolanaMarketDataSource, isSolanaMarketEnabled, type MarketEnv } from "./factory";
import type { MarketDataSource } from "./types";
import { FileDeskHourlyVolumeSnapshotStore } from "./volume-hourly-snapshot-store";
import {
  deskHourlyVolumeSnapshotLabel,
  recordDeskHourlyVolumeFromDetail,
  resolvePinnedEasternHour,
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
  /** Stamp clock when no target hour is pinned. Tests pass this; the CLI does not. */
  nowT?: number;
  /**
   * Scheduled America/New_York hour (`YYYY-MM-DDTHH` or with offset).
   * The written key is this hour even when the fetch finishes after the clock rolls.
   * Volume still comes from the live `getChain` result.
   */
  targetHour?: string | null;
  /** Wall clock for the pin's lag check. Defaults to `Date.now()`. */
  clockT?: number;
}): Promise<RecordDeskHourlyVolumeResult> {
  const clockT = input.clockT ?? Date.now() / 1000;
  const pin = resolvePinnedEasternHour(input.targetHour, clockT);
  if (!pin.ok) return { ok: false, reason: pin.reason };
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
  // A pin replaces the fetch-end stamp. `generatedAt` stays the real fetch time.
  const stampT = pin.stamp ? pin.stamp.t : input.nowT;
  return recordDeskHourlyVolumeFromDetail(input.store, detail, generatedAt, stampT);
}

export type HourlyTargetHourRead = { ok: true; hour: string | undefined } | { ok: false; reason: string };

/** `--hour` / `--snapshot-hour` win over the environment. A bare flag is an error. */
export function readHourlyTargetHour(env: MarketEnv, argv: readonly string[] = []): HourlyTargetHourRead {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--hour" || arg === "--snapshot-hour") {
      const value = argv[index + 1]?.trim() ?? "";
      if (!value || value.startsWith("--")) {
        return { ok: false, reason: `${arg} needs an America/New_York hour (YYYY-MM-DDTHH).` };
      }
      return { ok: true, hour: value };
    }
    if (arg.startsWith("--hour=") || arg.startsWith("--snapshot-hour=")) {
      const value = arg.slice(arg.indexOf("=") + 1).trim();
      if (!value) return { ok: false, reason: `${arg.split("=")[0]} needs an America/New_York hour (YYYY-MM-DDTHH).` };
      return { ok: true, hour: value };
    }
  }
  const fromEnv = env.HOURLY_TARGET_HOUR?.trim() || env.SNAPSHOT_HOUR?.trim();
  return { ok: true, hour: fromEnv || undefined };
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
  argv?: readonly string[];
  source?: DeskHourlyVolumeSnapshotSource;
  store?: DeskHourlyVolumeSnapshotStore;
  clockT?: number;
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
  const target = readHourlyTargetHour(env, options.argv ?? []);
  if (!target.ok) {
    error(target.reason);
    return 1;
  }
  try {
    const result = await runDeskHourlyVolumeSnapshotJob({
      source,
      store,
      targetHour: target.hour,
      clockT: options.clockT,
    });
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
