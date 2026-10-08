/**
 * Guards for landing nightly DexScreener volume snapshots on main.
 * A land is snapshot-only when every path is data/volume-snapshots/*.json
 * (optional *.test.ts companions when landing an existing PR) and every
 * commit subject matches `chore: … volume snapshot YYYY-MM-DD`.
 * Existing record dates must be unchanged. New dates may fill gaps.
 */

export const VOLUME_SNAPSHOT_COMMIT_RE = /^chore: .+ volume snapshot \d{4}-\d{2}-\d{2}$/;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SNAPSHOT_PATH_RE = /^data\/(?:volume-snapshots|perps-snapshots)\/[a-z0-9][a-z0-9-]*\.json$/;
const COMPANION_TEST_RE = /^src\/.*\.test\.tsx?$/;

export interface VolumeSnapshotChain {
  id: string;
  label: string;
  file: string;
}

export const VOLUME_SNAPSHOT_CHAINS: readonly VolumeSnapshotChain[] = [
  { id: "solana", label: "Solana", file: "data/volume-snapshots/solana.json" },
  { id: "base", label: "Base", file: "data/volume-snapshots/base.json" },
  { id: "bnb", label: "BNB", file: "data/volume-snapshots/bnb.json" },
  { id: "robinhood", label: "Robinhood", file: "data/volume-snapshots/robinhood.json" },
  { id: "perps", label: "Perps", file: "data/perps-snapshots/perps.json" },
];

const CHAIN_ALIASES: Record<string, string> = {
  solana: "solana",
  base: "base",
  bnb: "bnb",
  bsc: "bnb",
  robinhood: "robinhood",
  "robinhood-chain": "robinhood",
  perps: "perps",
  "equity-perps": "perps",
};

export function isVolumeSnapshotPath(filePath: string): boolean {
  return SNAPSHOT_PATH_RE.test(filePath);
}

export function isCompanionTestPath(filePath: string): boolean {
  return COMPANION_TEST_RE.test(filePath);
}

export function volumeSnapshotChain(id: string): VolumeSnapshotChain | null {
  const canonical = CHAIN_ALIASES[id.trim().toLowerCase()];
  if (!canonical) return null;
  return VOLUME_SNAPSHOT_CHAINS.find((chain) => chain.id === canonical) ?? null;
}

export function snapshotCommitSubject(label: string, day: string): string {
  return `chore: ${label} volume snapshot ${day}`;
}

export function isSnapshotCommitSubject(subject: string): boolean {
  return VOLUME_SNAPSHOT_COMMIT_RE.test(subject.trim());
}

export function manualMergeComment(mergeSha: string): string {
  return `Merged manually to main. Origin merge was refused (token not scoped for this operation). Merge commit: ${mergeSha}.`;
}

/** Path from `git status --porcelain` (no rename form). */
export function porcelainPath(line: string): string | null {
  const trimmed = line.trimEnd();
  if (!trimmed) return null;
  if (trimmed.includes(" -> ")) return null;
  if (trimmed.startsWith("?? ")) return trimmed.slice(3);
  if (trimmed.length >= 4 && trimmed[2] === " ") return trimmed.slice(3);
  return null;
}

export function assertSnapshotWorktree(statusLines: readonly string[]): { ok: true } | { ok: false; reason: string } {
  for (const line of statusLines) {
    if (!line.trim()) continue;
    const path = porcelainPath(line);
    if (!path || !isVolumeSnapshotPath(path)) {
      return {
        ok: false,
        reason: `Refusing to land: worktree has a non-snapshot change (${line.trim() || "unparsed"}). Commit only data/volume-snapshots/*.json or data/perps-snapshots/*.json.`,
      };
    }
  }
  return { ok: true };
}

/**
 * `git diff --name-status origin/main...HEAD` lines.
 * Additions and modifications of snapshot JSON only, plus test files when
 * `allowTests` is set (an already-open snapshot PR may update a date assertion).
 */
export function assertSnapshotOnlyNameStatus(
  nameStatusLines: readonly string[],
  options?: { allowTests?: boolean },
): { ok: true; files: string[] } | { ok: false; reason: string } {
  const allowTests = options?.allowTests === true;
  const files: string[] = [];
  let snapshotFiles = 0;
  for (const line of nameStatusLines) {
    if (!line.trim()) continue;
    const [status, path] = line.split("\t");
    if (!status || !path || status.includes(" -> ") || path.includes(" -> ")) {
      return { ok: false, reason: `Refusing push to main: unexpected diff line (${line.trim()}).` };
    }
    const kind = status.slice(0, 1);
    if (kind !== "A" && kind !== "M") {
      return {
        ok: false,
        reason: `Refusing push to main: only additions and edits of snapshot JSON are allowed (${line.trim()}).`,
      };
    }
    const snapshot = isVolumeSnapshotPath(path);
    const test = allowTests && isCompanionTestPath(path);
    if (!snapshot && !test) {
      return {
        ok: false,
        reason: `Refusing push to main: ${path} is outside data/volume-snapshots/*.json and data/perps-snapshots/*.json.`,
      };
    }
    if (snapshot) snapshotFiles += 1;
    files.push(path);
  }
  if (snapshotFiles === 0) {
    return { ok: false, reason: "Refusing push to main: no snapshot JSON changes versus origin/main." };
  }
  return { ok: true, files };
}

export function assertSnapshotCommitSubjects(
  subjects: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (subjects.length === 0) {
    return { ok: false, reason: "Refusing push to main: no commits versus origin/main." };
  }
  for (const subject of subjects) {
    if (!isSnapshotCommitSubject(subject)) {
      return {
        ok: false,
        reason: `Refusing push to main: commit subject must match \`chore: … volume snapshot YYYY-MM-DD\` (${subject.trim() || "empty"}).`,
      };
    }
  }
  return { ok: true };
}

export function newestSnapshotDate(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const records = (payload as { records?: unknown }).records;
  if (!Array.isArray(records)) return null;
  let newest = "";
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const date = (row as { date?: unknown }).date;
    if (typeof date === "string" && DAY_KEY.test(date) && date > newest) newest = date;
  }
  return newest || null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = sortKeys(source[key]);
    return sorted;
  }
  return value;
}

function snapshotRecords(payload: unknown): { ok: true; records: Record<string, unknown>[] } | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "Snapshot JSON must be an object with a records array." };
  }
  const records = (payload as { records?: unknown }).records;
  if (!Array.isArray(records)) return { ok: false, reason: "Snapshot JSON has no records array." };
  const rows: Record<string, unknown>[] = [];
  for (const row of records) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, reason: "Snapshot record is not an object." };
    }
    const date = (row as { date?: unknown }).date;
    if (typeof date !== "string" || !DAY_KEY.test(date)) {
      return { ok: false, reason: "Snapshot record is missing a YYYY-MM-DD date." };
    }
    rows.push(row as Record<string, unknown>);
  }
  return { ok: true, records: rows };
}

/**
 * Dates already on main must stay byte-for-value identical.
 * Dates only on the PR are the new daily rows (gaps are allowed).
 */
export function assertAppendOnlySnapshot(
  before: unknown,
  after: unknown,
): { ok: true; added: string[] } | { ok: false; reason: string } {
  const prior = snapshotRecords(before);
  if (!prior.ok) return prior;
  const next = snapshotRecords(after);
  if (!next.ok) return next;
  const beforeByDate = new Map<string, Record<string, unknown>>();
  for (const row of prior.records) {
    const date = String(row.date);
    if (beforeByDate.has(date)) return { ok: false, reason: `Duplicate snapshot date on main (${date}).` };
    beforeByDate.set(date, row);
  }
  const afterByDate = new Map<string, Record<string, unknown>>();
  for (const row of next.records) {
    const date = String(row.date);
    if (afterByDate.has(date)) return { ok: false, reason: `Duplicate snapshot date in the PR (${date}).` };
    afterByDate.set(date, row);
  }
  for (const [date, row] of beforeByDate) {
    const nextRow = afterByDate.get(date);
    if (!nextRow) return { ok: false, reason: `Refusing land: snapshot date ${date} was removed.` };
    if (stableJson(row) !== stableJson(nextRow)) {
      return { ok: false, reason: `Refusing land: snapshot date ${date} changed. Only new days may be added.` };
    }
  }
  const added = [...afterByDate.keys()].filter((date) => !beforeByDate.has(date)).sort();
  if (added.length === 0) {
    return { ok: false, reason: "Refusing land: no new snapshot day versus main." };
  }
  const beforeRest = { ...(before as Record<string, unknown>) };
  const afterRest = { ...(after as Record<string, unknown>) };
  delete beforeRest.records;
  delete afterRest.records;
  if (stableJson(beforeRest) !== stableJson(afterRest)) {
    return { ok: false, reason: "Refusing land: snapshot JSON changed outside the records array." };
  }
  return { ok: true, added };
}

export function parseOriginPrView(text: string): { number: number; head: string | null } | null {
  const numberMatch = text.match(/#(\d+)/);
  if (!numberMatch) return null;
  const headMatch = text.match(/(\S+)\s+→\s+(\S+)/);
  return {
    number: Number(numberMatch[1]),
    head: headMatch ? headMatch[1] : null,
  };
}

export function parseOriginPrListNumber(text: string): number | null {
  const match = text.match(/^#(\d+)\b/m);
  return match ? Number(match[1]) : null;
}

export const SNAPSHOT_LAND_PUSH_REJECTED = `Origin rejected merging this snapshot PR.
Landed locally instead when possible: git merge --no-ff into main, push origin main (never force), then comment the merge commit and close the PR.
Do not force-push main.`;
