import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterVolumeRange, sumVolumePoints } from "../daily-volume-view";
import {
  home24hSnapshotCaption,
  homeChainsWithRobinhood,
  includeHomeSnapshotChainsInDeskHeadline,
  includeRobinhoodInDeskHeadline,
  mergeHomeDeskSnapshotPoints,
  robinhoodHomeChainVolume,
  robinhoodHomeVolumeDetail,
  snapshotSeriesIncludesRobinhood,
} from "../home-desk-volume";
import { closedRobinhoodDeskDays, parseRobinhoodDeskDays, robinhoodSnapshotChainShell } from "../robinhood-desk-volume";
import type { ChainVolume, VolumeHistoryPoint } from "../types";
import {
  closedSnapshotVolumePoints,
  parseDeskVolumeSnapshotRecords,
  pointsFromDeskVolumeSnapshots,
  utcInstantForDayKey,
} from "../volume-snapshots";

const dayStart = Date.UTC(2026, 8, 29) / 1000;

function solanaPoint(day: number, volumeUsd: number): VolumeHistoryPoint {
  const date = new Date((dayStart + day * 86_400) * 1000).toISOString().slice(0, 10);
  return { t: utcInstantForDayKey(date), volumeUsd, kind: "calendar_day" };
}

function rhDay(date: string, combined24hUsd: number | null, lanes?: { public?: number | null; private?: number | null; etf?: number | null }) {
  return {
    date,
    publicEquity24hUsd: lanes?.public ?? combined24hUsd,
    private24hUsd: lanes?.private ?? null,
    etfIndex24hUsd: lanes?.etf ?? null,
    combined24hUsd,
    generatedAt: "2026-10-06T04:00:00.000Z",
    sources: { chainId: 4663, chainSlug: "robinhood" },
  };
}

describe("mergeHomeDeskSnapshotPoints", () => {
  const solana = [solanaPoint(0, 100), solanaPoint(1, 40), solanaPoint(2, 10)];
  const robinhood = parseRobinhoodDeskDays({
    records: [
      rhDay("2026-09-29", 7, { public: 5, private: 1, etf: 1 }),
      rhDay("2026-09-30", null),
      rhDay("2026-10-01", 3, { public: 3, private: null, etf: null }),
    ],
  });

  it("sums the same Eastern day and omits a missing chain instead of adding zero", () => {
    const merged = mergeHomeDeskSnapshotPoints(solana, robinhood);
    expect(merged.map((point) => point.volumeUsd)).toEqual([107, 40, 13]);
    expect(merged.every((point) => point.kind === "calendar_day")).toBe(true);
  });

  it("keeps a Robinhood-only day and ignores a rolling Solana tip", () => {
    const merged = mergeHomeDeskSnapshotPoints(
      [...solana, { t: dayStart + 3 * 86_400, volumeUsd: 999, kind: "rolling_24h" }],
      parseRobinhoodDeskDays({ records: [rhDay("2026-10-02", 8)] }),
    );
    expect(merged.map((point) => [point.t, point.volumeUsd])).toEqual([
      [solana[0]!.t, 100],
      [solana[1]!.t, 40],
      [solana[2]!.t, 10],
      [utcInstantForDayKey("2026-10-02"), 8],
    ]);
  });

  it("detects a plotted day that includes a Robinhood snapshot", () => {
    const merged = mergeHomeDeskSnapshotPoints(solana, robinhood);
    expect(snapshotSeriesIncludesRobinhood(merged, robinhood)).toBe(true);
    expect(snapshotSeriesIncludesRobinhood([solanaPoint(1, 40)], robinhood)).toBe(false);
  });

  it("drops the in-progress Eastern day when nowT is inside that date", () => {
    const duringSep30 = Date.parse("2026-09-30T15:00:00-04:00") / 1000;
    const days = parseRobinhoodDeskDays({
      records: [rhDay("2026-09-29", 7), rhDay("2026-09-30", 50)],
    });
    const merged = mergeHomeDeskSnapshotPoints([solanaPoint(0, 100), solanaPoint(1, 40)], days, duringSep30);
    expect(merged.map((point) => point.volumeUsd)).toEqual([107, 40]);
  });
});

describe("includeRobinhoodInDeskHeadline", () => {
  const days = parseRobinhoodDeskDays({
    records: [rhDay("2026-10-04", 10), rhDay("2026-10-05", 25)],
  });

  it("adds the newest closed Robinhood day to the live 24H total", () => {
    const next = includeRobinhoodInDeskHeadline(
      { volumeUsd: 100, caption: "24h · public + private + ETF/index", kind: "combined_24h" },
      "24h",
      days,
    );
    expect(next.volumeUsd).toBe(125);
    expect(next.caption).toContain("last closed Robinhood Chain snapshot");
    expect(next.caption).not.toMatch(/trailing h24/i);
    expect(next.caption).not.toContain("12:00");
  });

  it("leaves a Solana-only headline unchanged when Robinhood has no closed day", () => {
    const headline = { volumeUsd: 100, caption: "24h · public + private + ETF/index", kind: "combined_24h" };
    expect(includeRobinhoodInDeskHeadline(headline, "24h", [])).toEqual(headline);
    expect(includeRobinhoodInDeskHeadline(headline, "7d", [])).toEqual(headline);
  });

  it("keeps the closed-range sum and says both chains are in it", () => {
    const next = includeRobinhoodInDeskHeadline(
      { volumeUsd: 890, caption: "7D · sum of desk snapshot days · public + private + ETF/index", kind: "range_sum" },
      "7d",
      days,
    );
    expect(next.volumeUsd).toBe(890);
    expect(next.caption).toBe(
      "7D · sum of desk snapshot days · public + private + ETF/index · Solana + Robinhood Chain",
    );
    expect(next.caption).not.toMatch(/trailing h24/i);
  });
});

describe("home chain rows", () => {
  function chain(partial: Partial<ChainVolume> & Pick<ChainVolume, "id" | "name" | "volume24hUsd">): ChainVolume {
    return {
      ...robinhoodSnapshotChainShell(),
      privateVolume24hUsd: null,
      etfVolume24hUsd: null,
      ...partial,
    };
  }

  it("maps the last closed day onto public, private, and ETF legs", () => {
    const days = parseRobinhoodDeskDays({
      records: [
        rhDay("2026-10-04", 10, { public: 6, private: 3, etf: 1 }),
        rhDay("2026-10-05", 48, { public: 30, private: 2, etf: 16 }),
      ],
    });
    const row = robinhoodHomeChainVolume(days);
    expect(row.id).toBe("robinhood-chain");
    expect(row.name).toBe("Robinhood Chain");
    expect(row.volume24hUsd).toBe(30);
    expect(row.privateVolume24hUsd).toBe(2);
    expect(row.etfVolume24hUsd).toBe(16);
    expect(robinhoodHomeVolumeDetail(days)).toBe("2026-10-05 America/New_York · last closed snapshot.");
    expect(robinhoodHomeVolumeDetail(days)).not.toMatch(/trailing h24/i);
  });

  it("does not invent volume when no closed day exists", () => {
    const row = robinhoodHomeChainVolume([]);
    expect(row.volume24hUsd).toBeNull();
    expect(row.privateVolume24hUsd).toBeNull();
    expect(row.etfVolume24hUsd).toBeNull();
    expect(robinhoodHomeVolumeDetail([])).toMatch(/not reported as zero/i);
  });

  it("ranks combined 24H from most to least and keeps a single Robinhood row", () => {
    const listed = [
      chain({ id: "solana", name: "Solana", volume24hUsd: 70, privateVolume24hUsd: 20, etfVolume24hUsd: 10 }),
      chain({ id: "robinhood-chain", name: "Robinhood Chain", volume24hUsd: 1 }),
      chain({ id: "other", name: "Other", volume24hUsd: null }),
    ];
    const days = parseRobinhoodDeskDays({
      records: [rhDay("2026-10-05", 48, { public: 30, private: 2, etf: 16 })],
    });
    const ranked = homeChainsWithRobinhood(listed, days);
    expect(ranked.map((row) => row.id)).toEqual(["solana", "robinhood-chain", "other"]);
    expect(ranked.filter((row) => row.id === "robinhood-chain")).toHaveLength(1);
    expect(ranked[1]?.volume24hUsd).toBe(30);
  });

  it("puts Robinhood first when its closed snapshot is the larger 24H", () => {
    const listed = [chain({ id: "solana", name: "Solana", volume24hUsd: 10 })];
    const days = parseRobinhoodDeskDays({
      records: [rhDay("2026-10-05", 80, { public: 80, private: null, etf: null })],
    });
    expect(homeChainsWithRobinhood(listed, days).map((row) => row.id)).toEqual(["robinhood-chain", "solana"]);
  });

  it("still lists Robinhood when the snapshot file contributed no days", () => {
    const listed = [chain({ id: "solana", name: "Solana", volume24hUsd: 10 })];
    const ranked = homeChainsWithRobinhood(listed, []);
    expect(ranked.map((row) => [row.id, row.volume24hUsd])).toEqual([
      ["solana", 10],
      ["robinhood-chain", null],
    ]);
  });
});

describe("recorded Solana and Robinhood snapshots", () => {
  const nowT = Date.parse("2026-10-07T12:00:00-04:00") / 1000;
  const solana = closedSnapshotVolumePoints(
    pointsFromDeskVolumeSnapshots(
      parseDeskVolumeSnapshotRecords(JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots/solana.json"), "utf8"))),
    ),
    nowT,
  );
  const robinhood = closedRobinhoodDeskDays(
    parseRobinhoodDeskDays(JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots/robinhood.json"), "utf8"))),
    nowT,
  );

  it("sums both desks on the last 7 closed Eastern days as of noon ET 2026-10-07", () => {
    const merged = mergeHomeDeskSnapshotPoints(solana, robinhood, nowT);
    const seven = filterVolumeRange(merged, "7d");
    expect(seven).toHaveLength(7);
    // Sep 29 is still recorded. It sits outside this window because the
    // 2026-10-06 Solana snapshot is closed at this clock. The Robinhood
    // 2026-10-06 bar is included in that day's combined total.
    expect(seven.map((point) => new Date(point.t * 1000).toISOString().slice(0, 10))).toEqual([
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(sumVolumePoints(seven)).toBeCloseTo(1_542_865_772.42, 1);
    const solanaSeven = sumVolumePoints(filterVolumeRange(solana, "7d"));
    expect(solanaSeven).toBeCloseTo(700_511_148.9, 1);
    expect(sumVolumePoints(seven)).toBeGreaterThan(solanaSeven ?? 0);

    const fourteen = filterVolumeRange(merged, "14d");
    expect(fourteen.map((point) => point.t)).toEqual(merged.map((point) => point.t));
    expect(sumVolumePoints(filterVolumeRange(merged, "30d"))).toBe(sumVolumePoints(merged));

    const row = robinhoodHomeChainVolume(robinhood);
    expect(row.volume24hUsd).toBeCloseTo(71_215_121.17, 1);
    expect(row.privateVolume24hUsd).toBeCloseTo(9_288_962.33, 1);
    expect(row.etfVolume24hUsd).toBeCloseTo(36_707_685.3, 1);
    expect(robinhoodHomeVolumeDetail(robinhood)).toContain("2026-10-06");
  });
});

describe("includeHomeSnapshotChainsInDeskHeadline", () => {
  it("names every closed snapshot chain and does not mention a trailing window", () => {
    const next = includeHomeSnapshotChainsInDeskHeadline(
      { volumeUsd: 100, caption: "24h · public + private + ETF/index", kind: "combined_24h" },
      "24h",
      [
        { label: "Robinhood Chain", latestUsd: 25 },
        { label: "Base", latestUsd: 10 },
        { label: "BNB Chain", latestUsd: 4 },
      ],
    );
    expect(next.volumeUsd).toBe(139);
    expect(next.caption).toBe(home24hSnapshotCaption(["Robinhood Chain", "Base", "BNB Chain"]));
    expect(next.caption).toContain("Robinhood Chain, Base, and BNB Chain");
    expect(next.caption).not.toMatch(/trailing h24/i);

    const range = includeHomeSnapshotChainsInDeskHeadline(
      { volumeUsd: 890, caption: "14D · sum of desk snapshot days · public + private + ETF/index", kind: "range_sum" },
      "14d",
      [
        { label: "Robinhood Chain", latestUsd: 25 },
        { label: "Base", latestUsd: 10 },
        { label: "BNB Chain", latestUsd: 4 },
      ],
    );
    expect(range.volumeUsd).toBe(890);
    expect(range.caption).toBe(
      "14D · sum of desk snapshot days · public + private + ETF/index · Solana + Robinhood Chain + Base + BNB Chain",
    );
  });

  it("keeps the locked Robinhood-only 24H sentence", () => {
    expect(home24hSnapshotCaption(["Robinhood Chain"])).toContain("last closed Robinhood Chain snapshot");
  });
});
