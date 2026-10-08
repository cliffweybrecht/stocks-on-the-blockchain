import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { asNonNegativeNumber } from "./numbers";
import type { VolumeHistoryPoint } from "./types";
import {
  DEFAULT_VOLUME_SNAPSHOT_DIR,
  SOLANA_VOLUME_SNAPSHOT_FILE,
  utcInstantForDayKey,
} from "./volume-snapshots";

interface CachedAssetDays {
  mtimeMs: number;
  byMint: Map<string, VolumeHistoryPoint[]>;
  bySymbol: Map<string, VolumeHistoryPoint[]>;
}

let cached: CachedAssetDays | null = null;

function dayPoints(rows: Map<number, number>): VolumeHistoryPoint[] {
  return [...rows.entries()]
    .map(([t, volumeUsd]) => ({ t, volumeUsd, kind: "calendar_day" as const }))
    .sort((a, b) => a.t - b.t);
}

/**
 * Per-asset closed-day volume from `solana.json` rows that still carry an
 * `assets` list. Later desk files omit that list; those days contribute nothing.
 * Keyed by the Eastern date already stored on the record (`t` is UTC midnight of that date).
 */
export function assetSnapshotVolumeFromPayload(payload: unknown): {
  byMint: Map<string, VolumeHistoryPoint[]>;
  bySymbol: Map<string, VolumeHistoryPoint[]>;
} {
  const byMintAcc = new Map<string, Map<number, number>>();
  const bySymbolAcc = new Map<string, Map<number, number>>();
  const records =
    payload && typeof payload === "object" && Array.isArray((payload as { records?: unknown }).records)
      ? (payload as { records: unknown[] }).records
      : [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const row = record as { date?: unknown; assets?: unknown; etfAssets?: unknown; privateAssets?: unknown };
    const date = typeof row.date === "string" ? row.date : "";
    const t = utcInstantForDayKey(date);
    if (t <= 0) continue;
    const lists = [row.assets, row.etfAssets, row.privateAssets];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const asset of list) {
        if (!asset || typeof asset !== "object") continue;
        const volumeUsd = asNonNegativeNumber((asset as { volume24hUsd?: unknown }).volume24hUsd);
        if (volumeUsd === null) continue;
        const address = typeof (asset as { address?: unknown }).address === "string"
          ? (asset as { address: string }).address.trim()
          : "";
        const symbol = typeof (asset as { symbol?: unknown }).symbol === "string"
          ? (asset as { symbol: string }).symbol.trim().toLowerCase()
          : "";
        if (address) {
          const days = byMintAcc.get(address) ?? new Map<number, number>();
          days.set(t, volumeUsd);
          byMintAcc.set(address, days);
        }
        if (symbol) {
          const days = bySymbolAcc.get(symbol) ?? new Map<number, number>();
          if (!days.has(t)) days.set(t, volumeUsd);
          bySymbolAcc.set(symbol, days);
        }
      }
    }
  }
  const byMint = new Map<string, VolumeHistoryPoint[]>();
  const bySymbol = new Map<string, VolumeHistoryPoint[]>();
  for (const [mint, days] of byMintAcc) byMint.set(mint, dayPoints(days));
  for (const [symbol, days] of bySymbolAcc) bySymbol.set(symbol, dayPoints(days));
  return { byMint, bySymbol };
}

export function lookupAssetSnapshotVolume(
  index: { byMint: Map<string, VolumeHistoryPoint[]>; bySymbol: Map<string, VolumeHistoryPoint[]> },
  key: { mint?: string | null; symbol?: string | null },
): VolumeHistoryPoint[] {
  const mint = key.mint?.trim() ?? "";
  if (mint && index.byMint.has(mint)) return index.byMint.get(mint) ?? [];
  const symbol = key.symbol?.trim().toLowerCase() ?? "";
  if (symbol && index.bySymbol.has(symbol)) return index.bySymbol.get(symbol) ?? [];
  return [];
}

/** Disk read of stored per-asset days. Missing file is an empty series, not an error. */
export async function readStoredAssetSnapshotVolume(key: {
  mint?: string | null;
  symbol?: string | null;
  filePath?: string;
}): Promise<VolumeHistoryPoint[]> {
  const filePath = key.filePath ?? join(DEFAULT_VOLUME_SNAPSHOT_DIR, SOLANA_VOLUME_SNAPSHOT_FILE);
  try {
    const info = await stat(filePath);
    if (!cached || cached.mtimeMs !== info.mtimeMs) {
      const raw = await readFile(filePath, "utf8");
      const parsed = assetSnapshotVolumeFromPayload(JSON.parse(raw) as unknown);
      cached = { mtimeMs: info.mtimeMs, ...parsed };
    }
    return lookupAssetSnapshotVolume(cached, key);
  } catch {
    return [];
  }
}
