import { runLendingSnapshotCli } from "../src/lib/market/lending-snapshot-job";

runLendingSnapshotCli().then((code) => {
  process.exit(code);
});
