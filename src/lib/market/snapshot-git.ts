/**
 * Git stdout for snapshot:land.
 *
 * `execFileSync` / `spawnSync` pipes default to a 1 MiB maxBuffer and fail
 * with ENOBUFS once a snapshot blob exceeds it. Robinhood, Base, BNB, Solana,
 * and perps JSON are already past that, or will be. Stdout and stderr are
 * written to temporary files so the size of the blob is not capped by the
 * child-process pipe.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function gitFailure(result: SpawnSyncReturns<Buffer>, stderr: string, stdout: string): string {
  const detail = stderr.trim() || stdout.trim();
  if (detail) return detail;
  if (result.error) return result.error.message;
  if (result.signal) return `git killed by ${result.signal}`;
  return `git exited ${result.status ?? "null"}`;
}

/** Run git and return stdout. Throws stderr text when git exits non-zero. */
export function readGitStdout(args: readonly string[], cwd: string): string {
  const dir = mkdtempSync(join(tmpdir(), "snapshot-land-"));
  const outPath = join(dir, "stdout");
  const errPath = join(dir, "stderr");
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");
  let outClosed = false;
  let errClosed = false;
  try {
    const result = spawnSync("git", args, {
      cwd,
      stdio: ["ignore", outFd, errFd],
    });
    closeSync(outFd);
    outClosed = true;
    closeSync(errFd);
    errClosed = true;
    const stdout = readFileSync(outPath, "utf8");
    const stderr = readFileSync(errPath, "utf8");
    if (result.status !== 0 || result.error) {
      throw new Error(gitFailure(result, stderr, stdout));
    }
    return stdout;
  } finally {
    if (!outClosed) {
      try {
        closeSync(outFd);
      } catch {
        // The descriptor was already closed after spawn returned.
      }
    }
    if (!errClosed) {
      try {
        closeSync(errFd);
      } catch {
        // The descriptor was already closed after spawn returned.
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
