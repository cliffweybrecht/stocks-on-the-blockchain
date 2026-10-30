import { DEFAULT_HOLDER_SNAPSHOT_DIR, holderSnapshotChainId, type HolderSnapshotChainId } from "../src/lib/market/holder-snapshots";
import {
  captureHolderSnapshot,
  formatHolderSnapshotLine,
  loadHolderUniverse,
  rpcUrlFor,
} from "../src/lib/market/holder-snapshot-job";
import { holderSnapshotPath, saveHolderSnapshotDay } from "../src/lib/market/holder-snapshot-store";
import { holderGuard, holderShardOf, priorHolderDay, unionWithPriorDay } from "../src/lib/market/holder-universe-union";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { easternDayKey } from "../src/lib/market/volume-snapshots";

const CHAINS: readonly HolderSnapshotChainId[] = ["solana", "base", "bnb", "robinhood"];

function argValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function selectedChains(argv: readonly string[]): HolderSnapshotChainId[] {
  const raw = argValue(argv, "--chain");
  if (!raw || raw === "all") return [...CHAINS];
  const chain = holderSnapshotChainId(raw);
  if (!chain) {
    throw new Error(`Unknown holder chain ${raw}. Use solana, base, bnb, robinhood, or all.`);
  }
  return [chain];
}

export async function runHolderSnapshotCli(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Nightly holder and supply snapshot for the desk universe.

Runs at 11:59 PM America/New_York, from each chain's volume writer
(snapshot:volume, snapshot:base-volume, snapshot:bnb-volume, snapshot:robinhood-volume).
The record key is that Eastern calendar date. This command does not land to main.

  npm run snapshot:holders -- --chain solana
  npm run snapshot:holders -- --chain base
  npm run snapshot:holders -- --chain bnb
  npm run snapshot:holders -- --chain robinhood
  npm run snapshot:holders -- --chain all

HOLDER_SNAPSHOT_DATE=YYYY-MM-DD forces the Eastern day key. It does not invent counts.
Then land with:
  npm run snapshot:land -- --chain holders-<chain> --push-main
`);
    return 0;
  }

  let chains: HolderSnapshotChainId[];
  try {
    chains = selectedChains(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "snapshot:holders failed.");
    return 1;
  }

  const override = process.env.HOLDER_SNAPSHOT_DATE?.trim() || process.env.SNAPSHOT_DATE?.trim() || "";
  if (override && !/^\d{4}-\d{2}-\d{2}$/.test(override)) {
    console.error("HOLDER_SNAPSHOT_DATE must be an Eastern YYYY-MM-DD. It does not invent counts.");
    return 1;
  }
  const nowSeconds = Date.now() / 1000;
  const today = easternDayKey(nowSeconds);
  if (!override && !today) {
    console.error("Could not resolve the America/New_York calendar date.");
    return 1;
  }

  const dir = process.env.HOLDER_SNAPSHOT_DIR?.trim() || DEFAULT_HOLDER_SNAPSHOT_DIR;
  let failed = 0;
  for (const chainId of chains) {
    try {
      console.log(`snapshot:holders loading ${chainId} universe`);
      const live = await loadHolderUniverse(chainId);
      const date = override || today;
      const prior = await priorHolderDay(chainId, date, dir);
      const { universe: full, carried } = await unionWithPriorDay({ chainId, universe: live, prior });
      console.log(`snapshot:holders ${chainId} live=${live.length} carriedFromPrior=${carried} prior=${prior?.date ?? "none"}`);
      const shardSpec = process.env.HOLDER_SHARD?.trim() || "";
      const shardMatch = /^(\d+)\/(\d+)$/.exec(shardSpec);
      const universe = shardMatch
        ? full.filter((row) => holderShardOf(row.address, Number(shardMatch[2])) === Number(shardMatch[1]))
        : full;
      if (universe.length === 0) {
        console.error(`snapshot:holders ${chainId} universe was empty. Nothing was written.`);
        failed += 1;
        continue;
      }
      console.log(`snapshot:holders ${chainId} universe=${universe.length} rpc=${rpcUrlFor(chainId)}`);
      const day = await captureHolderSnapshot({
        chainId,
        universe,
        unixSeconds: nowSeconds,
        date,
        log: (message) => console.log(message),
      });
      const shardOut = process.env.HOLDER_SHARD_OUT?.trim();
      if (shardMatch && shardOut) {
        await mkdir(dirname(shardOut), { recursive: true });
        await writeFile(shardOut, JSON.stringify({ chainId, shard: shardSpec, universeTotal: full.length, day }), "utf8");
        console.log(`snapshot:holders ${chainId} shard ${shardSpec} assets=${day.assets.length} -> ${shardOut}`);
        continue;
      }
      const refused = holderGuard(day, prior);
      if (refused) {
        console.error(`snapshot:holders ${chainId} NOT READY: ${refused}`);
        failed += 1;
        continue;
      }
      await saveHolderSnapshotDay(chainId, day, dir);
      console.log(formatHolderSnapshotLine(chainId, day, holderSnapshotPath(chainId, dir)));
    } catch (error) {
      failed += 1;
      console.error(error instanceof Error ? error.message : `snapshot:holders ${chainId} failed.`);
    }
  }
  return failed === 0 ? 0 : 1;
}

const invokedDirectly = (process.argv[1] ?? "").replaceAll("\\", "/");
if (invokedDirectly.endsWith("/scripts/snapshot-holders.ts") || invokedDirectly.endsWith("/scripts/snapshot-holders.js")) {
  runHolderSnapshotCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "snapshot:holders failed.");
      process.exit(1);
    });
}
