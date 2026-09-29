import { runDeskHourlyVolumeSnapshotCli } from "../src/lib/market/volume-hourly-snapshot-job";

runDeskHourlyVolumeSnapshotCli()
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "snapshot:volume:hourly failed.");
    process.exit(1);
  });
