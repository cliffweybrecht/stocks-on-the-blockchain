/**
 * Restate the 2026-10-08 holder rows under the circulating-supply rule.
 * Reads volume snapshots only for stored pool reserves. Does not write them.
 *
 *   npx tsx scripts/restate-holder-supply-2026-10-08.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  holderAddressKey,
  restateHolderSupplyDay,
  serializeHolderSnapshotFile,
  type HolderSnapshotChainId,
  type HolderSnapshotDay,
  type HolderSnapshotFile,
} from "../src/lib/market/holder-snapshots";

const DATE = "2026-10-08";

/**
 * Jupiter `launchpad: met-dbc` mints with liquidity under $1 on the 2026-10-08
 * capture. Several are absent from the volume file, so the reserve was not stored.
 */
const DUST_CLONES = [
  "GsJP2MKbBTAgeRWQhPJJ96XiX4BTMugZnvD67zGojups",
  "ACpLkFd3hiAD2khfhNeW2Xie22RDUmwNWN9peyrVjups",
  "3KsvGerrfFfohXMAKGdkawMJYzJaT7PezHVj9dixmoon",
  "FoDrP1nj6zFNL5nfUb7rFeS4n7wTHwS8dY5SoBLyjups",
  "HGC9HUKamUkq5p91z9SdppRC6fZLjx8LWXDf5pZbjups",
  "54nTMg3bNtMohRufmMqja5rB4bdNRwN55C6e2stBmoon",
  "EdD1Fvv4VW2FXZxQLwgZwEHt88omd5Kagsvc45Ujups",
  "FiR8RG4JVBoyFMVu9KvRGWS4NmJZ4SBGatEc1xKSbonk",
  "6ZnJQLZjMqodq2FMjJvD19AEsEmYZ56u8myECQY8nj59",
];

const CHAINS: { id: HolderSnapshotChainId; holder: string; volume: string }[] = [
  { id: "solana", holder: "solana.json", volume: "solana.json" },
  { id: "base", holder: "base.json", volume: "base.json" },
  { id: "bnb", holder: "bnb.json", volume: "bnb.json" },
  { id: "robinhood", holder: "robinhood.json", volume: "robinhood.json" },
];

function deepestLiquidity(asset: {
  pools?: { liquidityUsd?: number | null }[];
  displayedLiquidityUsd?: number | null;
}): number | null {
  let best: number | null = null;
  let saw = false;
  for (const pool of asset.pools ?? []) {
    const liquidity = pool.liquidityUsd;
    if (typeof liquidity !== "number" || !Number.isFinite(liquidity) || liquidity < 0) continue;
    saw = true;
    if (best === null || liquidity > best) best = liquidity;
  }
  if (saw) return best;
  const displayed = asset.displayedLiquidityUsd;
  if (typeof displayed === "number" && Number.isFinite(displayed) && displayed >= 0) return displayed;
  return null;
}

function liquidityForDay(volumePath: string): Map<string, number | null> {
  const payload = JSON.parse(readFileSync(volumePath, "utf8")) as {
    records?: { date?: string; assets?: { address?: string; pools?: { liquidityUsd?: number | null }[]; displayedLiquidityUsd?: number | null }[] }[];
  };
  const day = payload.records?.find((row) => row.date === DATE);
  const map = new Map<string, number | null>();
  for (const asset of day?.assets ?? []) {
    if (!asset.address) continue;
    map.set(holderAddressKey(asset.address), deepestLiquidity(asset));
  }
  return map;
}

function main() {
  const dust = new Set(DUST_CLONES);
  for (const chain of CHAINS) {
    const holderPath = join("data/holder-snapshots", chain.holder);
    const before = JSON.parse(readFileSync(holderPath, "utf8")) as HolderSnapshotFile;
    const october19 = JSON.stringify(before.records.find((row) => row.date === "2026-10-19"));
    const day = before.records.find((row) => row.date === DATE);
    if (!day) throw new Error(`${chain.id} has no ${DATE} row`);
    const restated = restateHolderSupplyDay(day, {
      liquidityByAddress: liquidityForDay(join("data/volume-snapshots", chain.volume)),
      dustCloneAddresses: chain.id === "solana" ? dust : new Set(),
    });
    const records = before.records.map((row) => (row.date === DATE ? restated : row)) as HolderSnapshotDay[];
    const file: HolderSnapshotFile = { version: 1, chainId: chain.id, records };
    writeFileSync(holderPath, serializeHolderSnapshotFile(file));
    const after = JSON.parse(readFileSync(holderPath, "utf8")) as HolderSnapshotFile;
    const october19After = JSON.stringify(after.records.find((row) => row.date === "2026-10-19"));
    if (october19After !== october19) throw new Error(`${chain.id} 2026-10-19 changed`);
    const row = after.records.find((item) => item.date === DATE);
    const nulled = row?.assets.filter((asset) => asset.correction && asset.supplyUsd === null).length ?? 0;
    const repriced = row?.assets.filter((asset) => asset.correction && asset.supplyUsd !== null).length ?? 0;
    console.log(
      JSON.stringify({
        chain: chain.id,
        before: day.supplyUsd,
        after: row?.supplyUsd,
        priced: row?.assetsWithSupplyUsd,
        nulled,
        repriced,
        public: row?.publicMarketValueUsd,
        private: row?.privateMarketValueUsd,
        etf: row?.etfMarketValueUsd,
      }),
    );
  }
}

main();
