import { readFileSync } from "node:fs";
import { formatLendingFractionPct, lendingSnapshotSanity, parseLendingSnapshot } from "../src/lib/market/lending-snapshot";

/**
 * Print the lending desk how-full number the /lending page shows.
 * Utilization is dollars borrowed divided by dollars supplied to lend.
 * It is not dollars borrowed divided by locked stock.
 */
const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("Usage: npx tsx scripts/check-lending-snapshot.ts data/lending-snapshots/YYYY-MM-DD.json");
  process.exit(1);
}

let failed = false;
for (const path of paths) {
  const day = parseLendingSnapshot(JSON.parse(readFileSync(path, "utf8")));
  if (!day) {
    console.error(`${path}: not a lending snapshot.`);
    failed = true;
    continue;
  }
  const sanity = lendingSnapshotSanity(day);
  console.log(
    JSON.stringify(
      {
        date: sanity.date,
        collateralUsd: sanity.collateralUsd,
        stableBorrowedUsd: sanity.stableBorrowedUsd,
        utilization: sanity.utilization,
        utilizationPct: formatLendingFractionPct(sanity.utilization),
        omittedVenues: sanity.omittedVenues,
        fullnessNote: sanity.fullnessNote,
      },
      null,
      2,
    ),
  );
}

if (failed) process.exit(1);
