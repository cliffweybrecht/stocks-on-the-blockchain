import { runDeskVolumeSnapshotCli } from "../src/lib/market/volume-snapshot-job";

runDeskVolumeSnapshotCli()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "snapshot:volume failed.");
    process.exit(1);
  });
