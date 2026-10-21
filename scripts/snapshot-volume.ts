import { runDeskVolumeSnapshotCli } from "../src/lib/market/volume-snapshot-job";
import { runHolderSnapshotCli } from "./snapshot-holders";

/**
 * 11:59 PM America/New_York desk close.
 * Volume lands in data/volume-snapshots/solana.json.
 * The same run appends that Eastern day to data/holder-snapshots/solana.json.
 * Landing is still two snapshot:land subjects (solana, then holders-solana).
 */
runDeskVolumeSnapshotCli()
  .then((code) => {
    if (code !== 0) process.exit(code);
    return runHolderSnapshotCli(["--chain", "solana"]);
  })
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "snapshot:volume failed.");
    process.exit(1);
  });
