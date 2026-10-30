/**
 * Merge HOLDER_SHARD partials for one chain into one day, apply the completeness guard,
 * and save it to HOLDER_SNAPSHOT_DIR. Every shard must be present or nothing is written.
 *   tsx scripts/merge-holder-shards.ts CHAIN SHARD_DIR N
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DEFAULT_HOLDER_SNAPSHOT_DIR,
  holderSnapshotChainId,
  holderSnapshotTotals,
  sortHolderAssets,
  type HolderSnapshotDay,
} from "../src/lib/market/holder-snapshots";
import { formatHolderSnapshotLine } from "../src/lib/market/holder-snapshot-job";
import { holderSnapshotPath, saveHolderSnapshotDay } from "../src/lib/market/holder-snapshot-store";
import { holderGuard, priorHolderDay } from "../src/lib/market/holder-universe-union";

async function main(): Promise<number> {
  const [chainRaw, shardDir, nRaw] = process.argv.slice(2);
  const chainId = holderSnapshotChainId(chainRaw ?? "");
  const n = Number(nRaw);
  if (!chainId || !shardDir || !Number.isInteger(n) || n < 1) {
    console.error("usage: merge-holder-shards.ts CHAIN SHARD_DIR N");
    return 1;
  }
  const dir = process.env.HOLDER_SNAPSHOT_DIR?.trim() || DEFAULT_HOLDER_SNAPSHOT_DIR;
  const files: string[] = [];
  for (const entry of await readdir(shardDir, { recursive: true })) {
    if (String(entry).endsWith(".json")) files.push(join(shardDir, String(entry)));
  }
  const parts: Array<{ shard: string; universeTotal: number; day: HolderSnapshotDay }> = [];
  for (const f of files) {
    const p = JSON.parse(await readFile(f, "utf8"));
    if (p.chainId === chainId) parts.push(p);
  }
  const shards = new Set(parts.map((p) => p.shard));
  const missing = Array.from({ length: n }, (_, i) => `${i}/${n}`).filter((s) => !shards.has(s));
  if (missing.length) {
    console.error(`merge:holders ${chainId} NOT READY: missing shards ${missing.join(",")}`);
    return 1;
  }
  const dates = new Set(parts.map((p) => p.day.date));
  if (dates.size !== 1) {
    console.error(`merge:holders ${chainId} NOT READY: shard dates differ ${[...dates].join(",")}`);
    return 1;
  }
  const assets = sortHolderAssets(parts.flatMap((p) => p.day.assets));
  const universeTotal = parts[0].universeTotal;
  if (assets.length !== universeTotal) {
    console.error(`merge:holders ${chainId} NOT READY: merged ${assets.length} assets != universe ${universeTotal}`);
    return 1;
  }
  const first = parts[0].day;
  const capturedAt = parts.map((p) => p.day.capturedAt).sort().at(-1) ?? first.capturedAt;
  const day: HolderSnapshotDay = {
    date: first.date,
    t: first.t,
    capturedAt,
    ...holderSnapshotTotals(assets),
    limits: first.limits,
    assets,
  };
  const prior = await priorHolderDay(chainId, day.date, dir);
  const refused = holderGuard(day, prior);
  if (refused) {
    console.error(`merge:holders ${chainId} NOT READY: ${refused}`);
    return 1;
  }
  await saveHolderSnapshotDay(chainId, day, dir);
  console.log(formatHolderSnapshotLine(chainId, day, holderSnapshotPath(chainId, dir)));
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
