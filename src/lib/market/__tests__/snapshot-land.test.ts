import { describe, expect, it } from "vitest";
import {
  assertAppendOnlySnapshot,
  assertSnapshotCommitSubjects,
  assertSnapshotOnlyNameStatus,
  assertSnapshotWorktree,
  chainSnapshotFiles,
  isDailySnapshotPath,
  isPoolRegistryPath,
  isSnapshotCommitSubject,
  manualMergeComment,
  newestSnapshotDate,
  parseOriginPrListNumber,
  parseOriginPrView,
  snapshotCommitSubject,
  volumeSnapshotChain,
} from "../snapshot-land";

describe("snapshot land guards", () => {
  it("accepts only volume snapshot JSON in the worktree", () => {
    expect(assertSnapshotWorktree([" M data/volume-snapshots/solana.json", "?? data/volume-snapshots/base.json"]).ok).toBe(
      true,
    );
    const dirty = assertSnapshotWorktree([" M data/volume-snapshots/solana.json", " M README.md"]);
    expect(dirty.ok).toBe(false);
    if (!dirty.ok) expect(dirty.reason).toMatch(/non-snapshot/);
    expect(assertSnapshotWorktree(["R  data/volume-snapshots/old.json -> data/volume-snapshots/solana.json"]).ok).toBe(
      false,
    );
  });

  it("allows a push to main only for snapshot JSON commits with the chore subject", () => {
    const diff = assertSnapshotOnlyNameStatus([
      "M\tdata/volume-snapshots/solana.json",
      "A\tdata/volume-snapshots/bnb.json",
    ]);
    expect(diff.ok).toBe(true);
    expect(assertSnapshotOnlyNameStatus(["M\tsrc/lib/market/eastern-day.ts"]).ok).toBe(false);
    expect(assertSnapshotOnlyNameStatus(["D\tdata/volume-snapshots/solana.json"]).ok).toBe(false);
    expect(assertSnapshotOnlyNameStatus([]).ok).toBe(false);
    expect(
      assertSnapshotOnlyNameStatus(["M\tsrc/lib/market/__tests__/robinhood-desk-volume.test.ts"]).ok,
    ).toBe(false);

    const withTest = assertSnapshotOnlyNameStatus(
      [
        "M\tdata/volume-snapshots/robinhood.json",
        "M\tsrc/lib/market/__tests__/robinhood-desk-volume.test.ts",
      ],
      { allowTests: true },
    );
    expect(withTest.ok).toBe(true);

    expect(isSnapshotCommitSubject(snapshotCommitSubject("Solana", "2026-09-24"))).toBe(true);
    expect(isSnapshotCommitSubject("chore: Base DexScreener volume snapshot 2026-09-24")).toBe(true);
    expect(isSnapshotCommitSubject("chore: Robinhood volume snapshot 2026-10-07")).toBe(true);
    expect(assertSnapshotCommitSubjects(["chore: Solana volume snapshot 2026-09-24"]).ok).toBe(true);
    expect(assertSnapshotCommitSubjects(["feat: Solana volume snapshot 2026-09-24"]).ok).toBe(false);
    expect(assertSnapshotCommitSubjects(["Merge branch 'cursor/bnb-volume-2026-10-07-3320'"]).ok).toBe(false);
  });

  it("appends new days and refuses edits to days already on main", () => {
    const main = {
      version: 1,
      records: [
        { date: "2026-10-05", combined24hUsd: 10, issuersByLane: { equity: [{ slug: "a" }] } },
      ],
    };
    const appended = {
      version: 1,
      records: [
        { issuersByLane: { equity: [{ slug: "a" }] }, combined24hUsd: 10, date: "2026-10-05" },
        { date: "2026-10-07", combined24hUsd: 12 },
      ],
    };
    const added = assertAppendOnlySnapshot(main, appended);
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.added).toEqual(["2026-10-07"]);

    const rewritten = assertAppendOnlySnapshot(main, {
      version: 1,
      records: [
        { date: "2026-10-05", combined24hUsd: 11 },
        { date: "2026-10-07", combined24hUsd: 12 },
      ],
    });
    expect(rewritten.ok).toBe(false);

    const duplicate = assertAppendOnlySnapshot(main, main);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.reason).toMatch(/no new snapshot day/);

    const removed = assertAppendOnlySnapshot(main, { version: 1, records: [{ date: "2026-10-07", combined24hUsd: 1 }] });
    expect(removed.ok).toBe(false);
  });

  it("reads the newest Eastern day key from snapshot JSON", () => {
    expect(
      newestSnapshotDate({
        version: 1,
        records: [
          { date: "2026-09-23", t: 1 },
          { date: "2026-09-24", t: 2 },
        ],
      }),
    ).toBe("2026-09-24");
    expect(newestSnapshotDate({ records: [] })).toBeNull();
    expect(volumeSnapshotChain("bsc")?.file).toBe("data/volume-snapshots/bnb.json");
    expect(chainSnapshotFiles(volumeSnapshotChain("bnb")!)).toEqual([
      "data/volume-snapshots/bnb.json",
      "data/volume-snapshots/bnb-pools.json",
    ]);
    expect(chainSnapshotFiles(volumeSnapshotChain("base")!)).toEqual(["data/volume-snapshots/base.json"]);
    expect(chainSnapshotFiles(volumeSnapshotChain("solana")!)).toEqual(["data/volume-snapshots/solana.json"]);
    expect(chainSnapshotFiles(volumeSnapshotChain("robinhood")!)).toEqual(["data/volume-snapshots/robinhood.json"]);
    expect(chainSnapshotFiles(volumeSnapshotChain("perps")!)).toEqual(["data/perps-snapshots/perps.json"]);
    expect(isPoolRegistryPath("data/volume-snapshots/bnb-pools.json")).toBe(true);
    expect(isPoolRegistryPath("data/volume-snapshots/base-pools.json")).toBe(true);
    expect(isPoolRegistryPath("data/volume-snapshots/bnb.json")).toBe(false);
    expect(isDailySnapshotPath("data/volume-snapshots/bnb.json")).toBe(true);
    expect(isDailySnapshotPath("data/volume-snapshots/bnb-pools.json")).toBe(false);
    expect(isDailySnapshotPath("data/perps-snapshots/perps.json")).toBe(true);
    expect(
      assertSnapshotOnlyNameStatus([
        "M\tdata/volume-snapshots/bnb.json",
        "M\tdata/volume-snapshots/bnb-pools.json",
      ]).ok,
    ).toBe(true);
    expect(volumeSnapshotChain("robinhood-chain")?.label).toBe("Robinhood");
    expect(volumeSnapshotChain("perps")?.file).toBe("data/perps-snapshots/perps.json");
    expect(volumeSnapshotChain("ethereum")).toBeNull();
    expect(assertSnapshotWorktree(["?? data/perps-snapshots/perps.json"]).ok).toBe(true);
    expect(
      assertSnapshotOnlyNameStatus(["A\tdata/perps-snapshots/perps.json"]).ok,
    ).toBe(true);
  });

  it("names the merge commit in the manual-land comment and parses Origin PR text", () => {
    expect(manualMergeComment("abc123")).toBe(
      "Merged manually to main. Origin merge was refused (token not scoped for this operation). Merge commit: abc123.",
    );
    const view = parseOriginPrView(
      "chore: BNB DexScreener volume snapshot 2026-10-07 #371\nrepo • draft • cursor/bnb-volume-2026-10-07-3320 → main\n",
    );
    expect(view).toEqual({ number: 371, head: "cursor/bnb-volume-2026-10-07-3320" });
    expect(
      parseOriginPrListNumber(
        "Showing 1 change(s)\n\n#372  draft  chore: Robinhood volume snapshot 2026-10-07  cursor/robinhood-volume-2026-10-07-5445\n",
      ),
    ).toBe(372);
  });
});
