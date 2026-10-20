import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitStdout } from "../snapshot-git";

const FIVE_MB = 5 * 1024 * 1024;

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

describe("snapshot git stdout", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("reads a snapshot blob larger than Node's 1MB stdio buffer", () => {
    const root = mkdtempSync(join(tmpdir(), "snapshot-git-"));
    roots.push(root);
    const rel = "data/volume-snapshots/robinhood.json";
    mkdirSync(join(root, "data/volume-snapshots"), { recursive: true });
    const records = Array.from({ length: 20_000 }, (_, index) => ({
      date: "2026-01-01",
      n: index,
      pad: "x".repeat(240),
    }));
    const body = JSON.stringify({ version: 1, records }, null, 2);
    expect(Buffer.byteLength(body)).toBeGreaterThan(FIVE_MB);
    const file = join(root, rel);
    writeFileSync(file, body);

    git(["init", "-b", "main"], root);
    git(["config", "user.email", "snapshot-land@example.com"], root);
    git(["config", "user.name", "snapshot-land"], root);
    git(["add", "-f", "--", rel], root);
    git(["commit", "-m", "chore: Robinhood volume snapshot 2026-01-01"], root);

    expect(() =>
      execFileSync("git", ["show", `HEAD:${rel}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).toThrow(/ENOBUFS/);

    const shown = readGitStdout(["show", `HEAD:${rel}`], root);
    expect(shown).toBe(body);
    expect(Buffer.byteLength(shown)).toBeGreaterThan(FIVE_MB);
    expect(JSON.parse(shown).records).toHaveLength(20_000);

    writeFileSync(file, body.replace('"version": 1', '"version": 2'));
    const diff = readGitStdout(["diff", "--", rel], root);
    expect(diff).toContain("data/volume-snapshots/robinhood.json");
    expect(diff).toContain('"version": 2');
    expect(() => readGitStdout(["show", "HEAD:missing.json"], root)).toThrow(/missing\.json/);
  });
});
