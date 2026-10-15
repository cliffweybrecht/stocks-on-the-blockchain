/**
 * Rewrite stored per-asset liquidity that fails the sanity guard.
 * Volume fields are not modified. Safe to re-run: a row already corrected
 * is left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { correctStoredSnapshotAssets } from "../src/lib/market/liquidity-sanity";

const FILES = [
  "data/volume-snapshots/solana.json",
  "data/volume-snapshots/bnb.json",
  "data/volume-snapshots/robinhood.json",
  "data/volume-snapshots/base.json",
];

for (const file of FILES) {
  const payload = JSON.parse(readFileSync(file, "utf8"));
  const changes = correctStoredSnapshotAssets(payload);
  if (changes.length === 0) {
    console.log(`${file}: no changes`);
    continue;
  }
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`${file}: ${changes.length}`);
  for (const change of changes) {
    console.log(
      [
        change.date,
        change.symbol,
        change.address,
        String(change.displayedLiquidityUsdBefore),
        "->",
        String(change.displayedLiquidityUsdAfter),
        change.excludedLiquidityPools.map((row) => `${row.poolId} ${row.liquidityUsd} ${row.reason}`).join("; "),
      ].join(" "),
    );
  }
}
