import { captureLendingSnapshot } from "./lending-fetch";
import { loadLatestLendingSnapshot, saveLendingDay } from "./lending-snapshot-file";
import type { LendingDaySnapshot } from "./lending-snapshot";
import { venusEstimateFromSnapshot } from "./lending-venus-estimate";

const LENDING_SNAPSHOT_DATE_KEYS = ["LENDING_SNAPSHOT_DATE", "SNAPSHOT_DATE"] as const;

function hasAmount(day: LendingDaySnapshot): boolean {
  return day.rows.some((row) => row.collateralUsd !== null || row.stableBorrowedUsd !== null);
}

/**
 * YYYY-MM-DD pin. A blank value is ignored. An impossible calendar day throws.
 * The string is the file key only; it does not move `capturedAt`.
 */
export function parseLendingSnapshotDate(raw: string): string {
  const text = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`snapshot day override must be YYYY-MM-DD, got ${JSON.stringify(raw)}`);
  }
  const [year, month, day] = text.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year, month - 1, day));
  const real = utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
  if (!real) throw new Error(`snapshot day override must be a real YYYY-MM-DD date, got ${JSON.stringify(raw)}`);
  return text;
}

/**
 * `LENDING_SNAPSHOT_DATE` wins over `SNAPSHOT_DATE`. Blank values are ignored.
 * Unset means the file keeps the America/New_York date of the capture instant.
 */
export function lendingSnapshotDateOverride(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  for (const key of LENDING_SNAPSHOT_DATE_KEYS) {
    const value = (env[key] ?? "").trim();
    if (value) return parseLendingSnapshotDate(value);
  }
  return null;
}

/**
 * Writes one America/New_York day under data/lending-snapshots.
 * `LENDING_SNAPSHOT_DATE` forces that day key only. `capturedAt` stays the capture instant.
 * Success is silent. A capture with no amounts is not written.
 */
export async function runLendingSnapshotCli(options: {
  capture?: () => Promise<LendingDaySnapshot>;
  save?: (day: LendingDaySnapshot) => Promise<void>;
  error?: (message: string) => void;
  env?: Readonly<Record<string, string | undefined>>;
} = {}): Promise<number> {
  const error = options.error ?? console.error;
  try {
    const pinnedDate = lendingSnapshotDateOverride(options.env ?? process.env);
    const capture =
      options.capture ??
      (async () => {
        const previous = await loadLatestLendingSnapshot();
        return captureLendingSnapshot(Date.now(), { previousVenusEstimate: venusEstimateFromSnapshot(previous.day) });
      });
    const captured = await capture();
    const day = pinnedDate ? { ...captured, date: pinnedDate } : captured;
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
