import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_HOLDER_SNAPSHOT_DIR,
  HOLDER_SNAPSHOT_CHAINS,
  parseHolderSnapshotFile,
  serializeHolderSnapshotFile,
  upsertHolderSnapshotDay,
  type HolderSnapshotChainId,
  type HolderSnapshotDay,
  type HolderSnapshotFile,
} from "./holder-snapshots";

export function holderSnapshotPath(chainId: HolderSnapshotChainId, dir = DEFAULT_HOLDER_SNAPSHOT_DIR): string {
  const chain = HOLDER_SNAPSHOT_CHAINS.find((row) => row.id === chainId);
  return join(dir, chain?.file ?? `${chainId}.json`);
}

export async function loadHolderSnapshotFile(
  chainId: HolderSnapshotChainId,
  dir = DEFAULT_HOLDER_SNAPSHOT_DIR,
): Promise<HolderSnapshotFile> {
  try {
    const raw = await readFile(holderSnapshotPath(chainId, dir), "utf8");
    return parseHolderSnapshotFile(JSON.parse(raw), chainId);
  } catch {
    return { version: 1, chainId, records: [] };
  }
}

export async function saveHolderSnapshotDay(
  chainId: HolderSnapshotChainId,
  day: HolderSnapshotDay,
  dir = DEFAULT_HOLDER_SNAPSHOT_DIR,
): Promise<HolderSnapshotFile> {
  const existing = await loadHolderSnapshotFile(chainId, dir);
  const file: HolderSnapshotFile = {
    version: 1,
    chainId,
    records: upsertHolderSnapshotDay(existing.records, day),
  };
  const path = holderSnapshotPath(chainId, dir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, serializeHolderSnapshotFile(file), "utf8");
  await rename(tmp, path);
  return file;
}
