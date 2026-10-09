import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  SNAPSHOT_LAND_PUSH_REJECTED,
  assertAppendOnlySnapshot,
  assertSnapshotCommitSubjects,
  assertSnapshotOnlyNameStatus,
  assertSnapshotWorktree,
  manualMergeComment,
  newestSnapshotDate,
  parseOriginPrListNumber,
  parseOriginPrView,
  snapshotCommitSubject,
  snapshotGitMaxBuffer,
  volumeSnapshotChain,
  type VolumeSnapshotChain,
} from "../src/lib/market/snapshot-land";
import { assertPerpsLandSnapshot } from "../src/lib/market/perps-snapshot";

const HELP = `Land a DexScreener desk volume snapshot onto main.

The nightly sample runs at end of the America/New_York day:
  CRON_TZ=America/New_York
  59 23 * * *

Usage:
  npm run snapshot:land -- --chain bnb --push-main
  npm run snapshot:land -- --chain base
  npm run snapshot:land -- --pr 371
  npm run snapshot:land -- --check

--chain solana|base|bnb|robinhood|perps
  Commit that chain's snapshot JSON when it has uncommitted edits.
  Perps writes data/perps-snapshots/perps.json (not a spot total).
  Subject: chore: <Chain> volume snapshot YYYY-MM-DD
  Refuses if any non-snapshot file is dirty.

--push-main
  Push the snapshot branch, open a ready PR, and try \`origin pr merge\`.
  If Origin rejects the token, \`git merge --no-ff\` into main, push main
  (never force), comment the merge commit, and close the PR.

--pr <number>
  Land an existing snapshot PR the same way. The diff must only append
  daily rows (a companion src/**/*.test.ts assertion update is allowed).
  Dates already on main must be unchanged.

--check
  Exit 0 only when HEAD versus origin/main is already a snapshot-only land.
`;

interface GitError extends Error {
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  status?: number | null;
}

function gitText(error: unknown): string {
  const err = error as GitError;
  const stderr = typeof err.stderr === "string" ? err.stderr : err.stderr?.toString("utf8");
  const stdout = typeof err.stdout === "string" ? err.stdout : err.stdout?.toString("utf8");
  return (stderr || stdout || err.message || "git failed").trim();
}

function git(args: string[], cwd: string): string {
  const maxBuffer = snapshotGitMaxBuffer(args);
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...(maxBuffer === undefined ? {} : { maxBuffer }),
    });
  } catch (error) {
    throw new Error(gitText(error));
  }
}

function origin(args: string[], cwd: string): { ok: true; stdout: string } | { ok: false; output: string } {
  try {
    const stdout = execFileSync("origin", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch (error) {
    return { ok: false, output: gitText(error) };
  }
}

function argValue(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function statusLines(cwd: string): string[] {
  return git(["status", "--porcelain"], cwd)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function fileDirty(cwd: string, file: string): boolean {
  const tracked = git(["ls-files", "--", file], cwd).trim();
  if (!tracked) return existsSync(file);
  const unstaged = git(["diff", "--", file], cwd);
  const staged = git(["diff", "--cached", "--", file], cwd);
  return unstaged.length > 0 || staged.length > 0;
}

function currentBranch(cwd: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd).trim();
}

function fetchMain(cwd: string): number {
  try {
    git(["fetch", "origin", "main"], cwd);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "git fetch origin main failed.");
    return 1;
  }
}

function nameStatusAndSubjects(cwd: string, rev = "HEAD"): { nameStatus: string; subjects: string[] } {
  const nameStatus = git(["diff", "--name-status", `origin/main...${rev}`], cwd);
  const subjectsRaw = git(["log", "--format=%s", `origin/main..${rev}`], cwd);
  return {
    nameStatus,
    subjects: subjectsRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  };
}

function verifyCommitShape(cwd: string, rev: string, allowTests: boolean): number {
  let diff: ReturnType<typeof nameStatusAndSubjects>;
  try {
    diff = nameStatusAndSubjects(cwd, rev);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "git diff against origin/main failed.");
    return 1;
  }
  const files = assertSnapshotOnlyNameStatus(diff.nameStatus.split("\n"), { allowTests });
  if (!files.ok) {
    console.error(files.reason);
    return 1;
  }
  const subjects = assertSnapshotCommitSubjects(diff.subjects);
  if (!subjects.ok) {
    console.error(subjects.reason);
    return 1;
  }
  const appended = verifyAppendOnly(cwd, rev, files.files);
  if (!appended.ok) {
    console.error(appended.reason);
    return 1;
  }
  console.log(`Snapshot-only versus origin/main: ${files.files.join(", ")} (added ${appended.added.join(", ")})`);
  return 0;
}

function verifyAppendOnly(
  cwd: string,
  rev: string,
  files: readonly string[],
): { ok: true; added: string[] } | { ok: false; reason: string } {
  const added: string[] = [];
  for (const file of files) {
    if (!file.startsWith("data/volume-snapshots/") && !file.startsWith("data/perps-snapshots/")) continue;
    let beforeText = "";
    try {
      beforeText = git(["show", `origin/main:${file}`], cwd);
    } catch {
      beforeText = "";
    }
    const afterText = git(["show", `${rev}:${file}`], cwd);
    const before = beforeText ? JSON.parse(beforeText) : { records: [] };
    const after = JSON.parse(afterText) as unknown;
    const check =
      file === "data/perps-snapshots/perps.json"
        ? assertPerpsLandSnapshot(before, after)
        : assertAppendOnlySnapshot(before, after);
    if (!check.ok) return check;
    added.push(...check.added.map((date) => `${file}:${date}`));
  }
  if (added.length === 0) return { ok: false, reason: "Refusing land: no new snapshot day versus main." };
  return { ok: true, added };
}

function ensurePr(cwd: string, branch: string, title: string): number | null {
  const listed = origin(["pr", "list", "--head", branch, "--state", "all", "--limit", "5"], cwd);
  const existing = listed.ok ? parseOriginPrListNumber(listed.stdout) : null;
  if (existing) {
    console.log(`Using existing PR #${existing} for ${branch}.`);
    return existing;
  }
  const body = [
    `Records the DexScreener desk volume snapshot in \`${title}\`.`,
    "",
    "Land with `npm run snapshot:land -- --push-main` (or `--pr`). Origin merge is tried first. If the token is refused, the land is `git merge --no-ff` into main, a non-force push, and a PR comment that names the merge commit.",
  ].join("\n");
  const created = origin(
    ["pr", "create", "--title", title, "--body", body, "--head", branch, "--base", "main", "--draft=false"],
    cwd,
  );
  if (!created.ok) {
    console.error(created.output);
    return null;
  }
  if (created.stdout.trim()) console.log(created.stdout.trim());
  const again = origin(["pr", "list", "--head", branch, "--state", "all", "--limit", "5"], cwd);
  const number = again.ok ? parseOriginPrListNumber(again.stdout) : parseOriginPrView(created.stdout)?.number ?? null;
  if (!number) console.error("Opened a PR but could not read its number.");
  return number;
}

function branchContains(cwd: string, ancestor: string, descendant: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    return true;
  } catch {
    return false;
  }
}

function closeWithComment(cwd: string, pr: number, mergeSha: string): void {
  const comment = origin(["pr", "comment", String(pr), "--body", manualMergeComment(mergeSha)], cwd);
  if (!comment.ok) console.error(comment.output);
  else if (comment.stdout.trim()) console.log(comment.stdout.trim());
  const closed = origin(["pr", "close", String(pr)], cwd);
  if (!closed.ok) console.error(closed.output);
  else if (closed.stdout.trim()) console.log(closed.stdout.trim());
}

/**
 * Try Origin merge. On refusal, merge --no-ff into main and push (never force).
 * Returns the merge commit on origin/main, or null.
 */
function landBranch(cwd: string, branch: string, pr: number | null, mergeLabel?: string): string | null {
  const branchSha = git(["rev-parse", branch], cwd).trim();
  if (pr) {
    const merged = origin(["pr", "merge", String(pr)], cwd);
    if (!merged.ok) console.error(merged.output);
    else if (merged.stdout.trim()) console.log(merged.stdout.trim());
    git(["fetch", "origin", "main"], cwd);
    if (branchContains(cwd, branchSha, "origin/main")) {
      const sha = git(["rev-parse", "origin/main"], cwd).trim();
      console.log(`Origin merged ${branch} to main as ${sha}.`);
      return sha;
    }
    console.error("Origin merge did not land the snapshot commit on main.");
  }

  const starting = currentBranch(cwd);
  if (statusLines(cwd).length > 0) {
    console.error("Refusing local merge: worktree is dirty.");
    return null;
  }
  git(["checkout", "main"], cwd);
  git(["merge", "--ff-only", "origin/main"], cwd);
  const label = mergeLabel ?? branch;
  git(["merge", "--no-ff", branch, "-m", `Merge branch '${label}'`], cwd);
  const mergeSha = git(["rev-parse", "HEAD"], cwd).trim();
  try {
    const pushed = git(["push", "origin", "main"], cwd);
    if (pushed.trim()) console.log(pushed.trim());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "git push origin main failed.");
    console.error(SNAPSHOT_LAND_PUSH_REJECTED);
    if (starting !== "main") {
      try {
        git(["checkout", starting], cwd);
      } catch {
        // Stay on the local main that failed to push.
      }
    }
    return null;
  }
  git(["fetch", "origin", "main"], cwd);
  if (!branchContains(cwd, branchSha, "origin/main")) {
    console.error(`Push reported success but ${branchSha} is not on origin/main.`);
    return null;
  }
  console.log(`Merged ${branch} to main as ${mergeSha}.`);
  if (pr) closeWithComment(cwd, pr, mergeSha);
  return mergeSha;
}

function commitChain(cwd: string, chain: VolumeSnapshotChain): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(chain.file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unreadable snapshot JSON";
    console.error(`Refusing to commit ${chain.file}: ${message}`);
    return null;
  }
  const day = newestSnapshotDate(payload);
  if (!day) {
    console.error(`Refusing to commit ${chain.file}: no YYYY-MM-DD record date.`);
    return null;
  }
  const subject = snapshotCommitSubject(chain.label, day);
  let branch = currentBranch(cwd);
  if (branch === "main" || branch === "HEAD") {
    const suffix = randomBytes(2).toString("hex");
    branch = `cursor/${chain.id}-volume-${day}-${suffix}`;
    git(["checkout", "-b", branch], cwd);
  }
  git(["add", "-f", "--", chain.file], cwd);
  git(["commit", "-m", subject, "--", chain.file], cwd);
  console.log(subject);
  return branch;
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const cwd = process.cwd();
  const check = argv.includes("--check");
  const pushMain = argv.includes("--push-main");
  const chainId = argValue(argv, "--chain");
  const prArg = argValue(argv, "--pr");

  if (prArg && !/^\d+$/.test(prArg)) {
    console.error(`--pr must be a pull request number (${prArg}).`);
    return 1;
  }

  const status = statusLines(cwd);
  if (prArg) {
    if (status.length > 0) {
      console.error("Refusing --pr: worktree is dirty. Land from a clean checkout of main.");
      return 1;
    }
    if (fetchMain(cwd) !== 0) return 1;
    const viewed = origin(["pr", "view", prArg], cwd);
    if (!viewed.ok) {
      console.error(viewed.output);
      return 1;
    }
    const parsed = parseOriginPrView(viewed.stdout);
    if (!parsed?.head) {
      console.error(`Could not read the head branch for PR #${prArg}.`);
      return 1;
    }
    try {
      git(["fetch", "origin", parsed.head], cwd);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "git fetch of the PR branch failed.");
      return 1;
    }
    const rev = `origin/${parsed.head}`;
    if (verifyCommitShape(cwd, rev, true) !== 0) return 1;
    const sha = landBranch(cwd, rev, parsed.number, parsed.head);
    return sha ? 0 : 2;
  }

  const worktree = assertSnapshotWorktree(status);
  if (!worktree.ok) {
    console.error(worktree.reason);
    return 1;
  }

  if (check) {
    if (status.length > 0) {
      console.error("Uncommitted snapshot edits. Run snapshot:land --chain <chain> before --check.");
      return 1;
    }
    if (fetchMain(cwd) !== 0) return 1;
    return verifyCommitShape(cwd, "HEAD", false);
  }

  if (!chainId) {
    console.error("snapshot:land requires --chain solana|base|bnb|robinhood|perps, --pr <number>, or --check.");
    console.error(HELP);
    return 1;
  }
  const chain = volumeSnapshotChain(chainId);
  if (!chain) {
    console.error(`Unknown volume snapshot chain ${chainId}. Use solana, base, bnb, robinhood, or perps.`);
    return 1;
  }

  const otherDirty = status.filter((line) => {
    const path = line.startsWith("?? ") ? line.slice(3) : line.slice(3);
    return path !== chain.file;
  });
  if (otherDirty.length > 0) {
    console.error(`Refusing to land ${chain.id}: another snapshot file is also dirty (${otherDirty.join("; ")}).`);
    return 1;
  }

  if (!existsSync(chain.file)) {
    console.error(`No snapshot file at ${chain.file}. Run the chain writer first.`);
    return 1;
  }

  let branch = currentBranch(cwd);
  if (fileDirty(cwd, chain.file)) {
    try {
      const committed = commitChain(cwd, chain);
      if (!committed) return 1;
      branch = committed;
    } catch (error) {
      console.error(error instanceof Error ? error.message : "git commit failed.");
      return 1;
    }
  } else if (!pushMain) {
    console.log(`No uncommitted changes in ${chain.file}.`);
    return 0;
  }

  if (!pushMain) {
    console.log(`Next: npm run snapshot:land -- --chain ${chain.id} --push-main`);
    console.log("That opens a PR and lands it with origin pr merge, or git merge --no-ff if Origin refuses.");
    console.log("See docs/volume-snapshots.md.");
    return 0;
  }

  if (fetchMain(cwd) !== 0) return 1;
  if (verifyCommitShape(cwd, "HEAD", false) !== 0) return 1;
  try {
    const pushed = git(["push", "-u", "origin", branch], cwd);
    if (pushed.trim()) console.log(pushed.trim());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "git push of the snapshot branch failed.");
    return 1;
  }
  const title = git(["log", "-1", "--format=%s"], cwd).trim();
  const pr = ensurePr(cwd, branch, title);
  const sha = landBranch(cwd, branch, pr, branch);
  if (!sha) {
    console.error(SNAPSHOT_LAND_PUSH_REJECTED);
    return 2;
  }
  return 0;
}

process.exit(main());
