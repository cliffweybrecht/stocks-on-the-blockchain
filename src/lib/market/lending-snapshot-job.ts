import { captureLendingSnapshot } from "./lending-fetch";
import { loadLatestLendingSnapshot, saveLendingDay } from "./lending-snapshot-file";
import type { LendingDaySnapshot } from "./lending-snapshot";
import { venusEstimateFromSnapshot } from "./lending-venus-estimate";

function hasAmount(day: LendingDaySnapshot): boolean {
  return day.rows.some((row) => row.collateralUsd !== null || row.stableBorrowedUsd !== null);
}

/**
 * Writes one America/New_York day under data/lending-snapshots.
 * Success is silent. A capture with no amounts is not written.
 */
export async function runLendingSnapshotCli(options: {
  capture?: () => Promise<LendingDaySnapshot>;
  save?: (day: LendingDaySnapshot) => Promise<void>;
  error?: (message: string) => void;
} = {}): Promise<number> {
  const error = options.error ?? console.error;
  try {
    const capture =
      options.capture ??
      (async () => {
        const previous = await loadLatestLendingSnapshot();
        return captureLendingSnapshot(Date.now(), { previousVenusEstimate: venusEstimateFromSnapshot(previous.day) });
      });
    const day = await capture();
    if (!hasAmount(day)) {
      error("Lending snapshot captured no amounts. File not written.");
      for (const failure of day.failures) error(`  ${failure.source}: ${failure.message}`);
      return 1;
    }
    await (options.save ?? ((next) => saveLendingDay(next).then(() => undefined)))(day);
    return 0;
  } catch (err) {
    error(err instanceof Error ? err.message : "snapshot:lending failed.");
    return 1;
  }
}
