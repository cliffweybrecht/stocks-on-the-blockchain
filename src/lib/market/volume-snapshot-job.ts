import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSolanaMarketDataSource, isSolanaMarketEnabled, type MarketEnv } from "./factory";
import {
  buildClosedDayTotals,
  isPerpInstrument,
  loadSolanaClosedDayPools,
  readKnownPoolSides,
} from "./closed-day-capture";
import type { ChainDetailResult, MarketDataSource } from "./types";
import { easternDayKey } from "./volume-snapshots";
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

export type DeskVolumeSnapshotSource = Pick<MarketDataSource, "getChain"> & {
  /** Full token-pairs hydrate. The nightly writer uses this instead of a warm light preview. */
  captureFullChain?: () => Promise<ChainDetailResult | null>;
};

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
  /** Nightly capture. Forces the full pool set and the Eastern candle sum. */
  closedDay?: { fetchImpl?: typeof fetch; nowT?: number; knownPoolsJson?: string };
}): Promise<RecordDeskVolumeResult> {
  let detail;
  try {
    detail = input.closedDay && input.source.captureFullChain
      ? await input.source.captureFullChain()
      : await input.source.getChain("solana");
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
  let chain = detail.chain;
  let assets = snapshotAssetsFromDetail(detail);
  let extras: {
    volumeSource?: string;
    dexCombined24hUsd?: number | null;
    geckoCombined24hUsd?: number | null;
    crossCheck?: string | null;
    gapPct?: number | null;
  } = {};
  if (input.closedDay) {
    const nowT = input.closedDay.nowT ?? Date.parse(generatedAt) / 1000;
    const dayKey = easternDayKey(nowT);
    const visible = [...detail.assets, ...(detail.etfAssets ?? []), ...(detail.privateAssets ?? [])].filter(
      (asset) => !isPerpInstrument(asset.symbol, asset.name),
    );
    try {
      const knownPath = input.closedDay.knownPoolsJson ?? join(process.cwd(), "data", "volume-known-pools", "solana.json");
      let knownPools: ReturnType<typeof readKnownPoolSides> = [];
      try {
        knownPools = readKnownPoolSides(readFileSync(knownPath, "utf8"));
      } catch {
        knownPools = [];
      }
      const pools = await loadSolanaClosedDayPools({
        assets: visible,
        fetchImpl: input.closedDay.fetchImpl ?? fetch,
        dayKey,
        knownPools,
      });
      const kinds = new Map(
        visible.map((asset) => [asset.contractAddress, asset.instrumentKind] as const),
      );
      const totals = buildClosedDayTotals({ pools, kinds });
      if (totals.combined24hUsd !== null) {
        chain = {
          ...chain,
          volume24hUsd: totals.publicEquity24hUsd,
          privateVolume24hUsd: totals.private24hUsd,
          etfVolume24hUsd: totals.etfIndex24hUsd,
          volumeAggregation: "all-pools",
        };
        assets = assets
          .filter((asset) => !isPerpInstrument(asset.symbol, ""))
          .map((asset) => {
            const row = totals.byAddress.get(asset.contractAddress);
            return {
              ...asset,
              volume24hUsd: row?.volumeUsd ?? null,
              pools: row?.pools.length ? row.pools : asset.pools,
            };
          });
        extras = {
          volumeSource: totals.volumeSource,
          dexCombined24hUsd: totals.dexCombined24hUsd,
          geckoCombined24hUsd: totals.geckoCombined24hUsd,
          crossCheck: totals.crossCheck,
          gapPct: totals.gapPct,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "gecko closed day failed";
      extras = { volumeSource: "dexscreener-h24-fallback", crossCheck: `gecko-failed: ${message}` };
    }
  }
  return recordDeskVolumeFromChain(
    input.store,
    chain,
    generatedAt,
    input.closedDay?.nowT,
    assets,
    extras,
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
      // The nightly file must finish token-pairs. A 60s preview budget drops pools.
      fullBudgetMs: 20 * 60 * 1000,
      // Fire-and-forget UI persist must not race the awaited CLI write.
      volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    });
  try {
    const result = await runDeskVolumeSnapshotJob({
      source,
      store,
      closedDay: options.source
        ? undefined
        : { knownPoolsJson: join(dir, "..", "volume-known-pools", "solana.json") },
    });
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
