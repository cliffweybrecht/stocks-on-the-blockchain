import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chainCombinedVolume24h } from "../aggregate";
import { BASE_DESK, baseIssuerPresentation } from "../base-desk-volume";
import { formatUsdCompact } from "../format";
import { BNB_DESK, bnbIssuerPresentation } from "../bnb-desk-volume";
import { filterVolumeRange, sumVolumePoints } from "../daily-volume-view";
import {
  homeChainsWithSnapshotDesks,
  mergeAdditionalDeskDays,
  snapshotHomeChainVolume,
  snapshotHomeVolumeDetail,
} from "../home-desk-volume";
import { robinhoodSnapshotChainShell } from "../robinhood-desk-volume";
import {
  closedSnapshotDeskDays,
  parseSnapshotDeskDays,
  snapshotDeskDaysForRange,
  snapshotDeskHeadline,
  snapshotDeskIssuerRows,
  snapshotDeskVolumePoints,
} from "../snapshot-desk-volume";
import type { ChainVolume } from "../types";
import { utcInstantForDayKey } from "../volume-snapshots";

function readDesk(file: string) {
  return JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots", file), "utf8"));
}

describe("Base snapshot file", () => {
  const days = parseSnapshotDeskDays(readDesk("base.json"), BASE_DESK);
  const nowT = Date.parse("2026-10-09T03:00:00Z") / 1000;
  const closed = closedSnapshotDeskDays(days, nowT);

  it("reads the authoritative series from 2026-09-25 through 2026-10-08", () => {
    expect(days.map((day) => day.date)).toEqual([
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(closed.map((day) => day.date)).toEqual(days.map((day) => day.date).filter((date) => date < "2026-10-08"));
  });

  it("keys every bar to America/New_York midnight of the Eastern day", () => {
    for (const day of days) {
      expect(day.t).toBe(utcInstantForDayKey(day.date));
    }
    const sep25 = days.find((day) => day.date === "2026-09-25");
    expect(sep25?.t).toBe(1790308800);
    expect(new Date((sep25?.t ?? 0) * 1000).toISOString()).toBe("2026-09-25T04:00:00.000Z");
  });

  it("keeps the 2026-10-05 lanes and confirmed issuers", () => {
    const day = days.find((row) => row.date === "2026-10-05");
    expect(day?.combined24hUsd).toBeCloseTo(30_645_324.57, 2);
    expect(day?.publicEquity24hUsd).toBeCloseTo(30_314_511.26, 2);
    expect(day?.etfIndex24hUsd).toBeCloseTo(320_689.04, 2);
    expect(day?.private24hUsd).toBeCloseTo(10_124.27, 2);
    const issuers = snapshotDeskIssuerRows(day ? [day] : []);
    const coinbase = issuers.find((row) => row.slug === "coinbase");
    const st0x = issuers.find((row) => row.slug === "st0x");
    const centrifuge = issuers.find((row) => row.slug === "centrifuge");
    const backed = issuers.find((row) => row.slug === "backed");
    const anchored = issuers.find((row) => row.slug === "anchored");
    expect(coinbase).toMatchObject({ official: true, equityUsd: 30_092_732.61, privateUsd: 9_698.36, etfUsd: null });
    expect(st0x?.equityUsd).toBeCloseTo(221_770.85, 2);
    expect(st0x?.etfUsd).toBeCloseTo(4_581.33, 2);
    expect(st0x?.privateUsd).toBeCloseTo(425.91, 2);
    expect(centrifuge?.etfUsd).toBeCloseTo(316_107.71, 2);
    expect(centrifuge?.equityUsd).toBeNull();
    expect(backed?.equityUsd).toBeCloseTo(7.8, 2);
    expect(anchored?.equityUsd).toBeNull();
    expect(issuers.map((row) => row.slug)).toEqual([
      "anchored",
      "backed",
      "centrifuge",
      "coinbase",
      "dinari",
      "st0x",
    ]);
  });

  it("keeps the 2026-10-06 lanes", () => {
    const day = days.find((row) => row.date === "2026-10-06");
    expect(day?.combined24hUsd).toBeCloseTo(28_614_559.48, 2);
    expect(day?.publicEquity24hUsd).toBeCloseTo(28_332_450.44, 2);
    expect(day?.etfIndex24hUsd).toBeCloseTo(277_577.3, 2);
    expect(day?.private24hUsd).toBeCloseTo(4_531.74, 2);
    const issuers = snapshotDeskIssuerRows(day ? [day] : []);
    expect(issuers.find((row) => row.slug === "coinbase")).toMatchObject({
      official: true,
      equityUsd: 28_294_904.51,
      privateUsd: 4_493.84,
      etfUsd: null,
    });
    expect(issuers.find((row) => row.slug === "backed")?.equityUsd).toBeCloseTo(316.34, 2);
    expect(issuers.find((row) => row.slug === "dinari")?.equityUsd).toBeNull();
    expect(issuers.find((row) => row.slug === "st0x")?.privateUsd).toBeCloseTo(37.9, 2);
  });

  it("uses the 2026-10-07 snapshot as the last closed Base day", () => {
    const day = closed.at(-1);
    expect(day?.date).toBe("2026-10-07");
    expect(day?.combined24hUsd).toBeCloseTo(37_535_102.57, 2);
    expect(day?.publicEquity24hUsd).toBeCloseTo(31_092_555.43, 2);
    expect(day?.etfIndex24hUsd).toBeCloseTo(285_474.59, 2);
    expect(day?.private24hUsd).toBeCloseTo(6_157_072.55, 2);
    const issuers = snapshotDeskIssuerRows(snapshotDeskDaysForRange(closed, "24h"));
    expect(issuers.find((row) => row.slug === "coinbase")).toMatchObject({
      official: true,
      equityUsd: 31_072_521.61,
      privateUsd: 6_157_071,
      etfUsd: null,
    });
    expect(issuers.find((row) => row.slug === "backed")?.equityUsd).toBeCloseTo(0.43, 2);
    expect(issuers.find((row) => row.slug === "dinari")?.equityUsd).toBeNull();
    expect(issuers.find((row) => row.slug === "st0x")?.privateUsd).toBeCloseTo(1.55, 2);
    expect(issuers.find((row) => row.slug === "centrifuge")?.etfUsd).toBeCloseTo(280_400.63, 2);
    expect(snapshotDeskHeadline(snapshotDeskDaysForRange(closed, "24h"), "24h", "Base").caption).toBe(
      "24H · 2026-10-07 America/New_York · last closed snapshot",
    );
    expect(snapshotDeskHeadline(closed, "24h", "Base").caption).not.toMatch(/trailing h24/i);
  });

  it("sums the 7D issuer cells through 2026-10-05 from recorded h24", () => {
    const throughOct5 = closedSnapshotDeskDays(days, Date.parse("2026-10-07T03:00:00Z") / 1000);
    const rows = snapshotDeskIssuerRows(snapshotDeskDaysForRange(throughOct5, "7d"));
    const backed = rows.find((row) => row.slug === "backed")?.equityUsd;
    const dinari = rows.find((row) => row.slug === "dinari")?.equityUsd;
    const st0xPrivate = rows.find((row) => row.slug === "st0x")?.privateUsd;
    expect(backed).toBeCloseTo(9.57, 2);
    expect(dinari).toBeCloseTo(0.52, 2);
    expect(st0xPrivate).toBeCloseTo(743.94, 2);
    expect(formatUsdCompact(backed)).toBe("$9.6");
    expect(formatUsdCompact(dinari)).toBe("$0.5");
    expect(formatUsdCompact(st0xPrivate)).toBe("$743.9");
  });

  it("rejects a row from another chain and keeps a reported zero", () => {
    const parsed = parseSnapshotDeskDays(
      {
        records: [
          {
            date: "2026-10-05",
            publicEquity24hUsd: 0,
            private24hUsd: null,
            etfIndex24hUsd: null,
            combined24hUsd: 0,
            sources: { chainId: 8453, chainSlug: "base" },
            issuers: [{ issuer: "coinbase", publicEquity24hUsd: 0, private24hUsd: null, etfIndex24hUsd: null }],
          },
          {
            date: "2026-10-04",
            publicEquity24hUsd: 5,
            private24hUsd: null,
            etfIndex24hUsd: null,
            combined24hUsd: 5,
            sources: { chainId: 56, chainSlug: "bsc" },
          },
        ],
      },
      BASE_DESK,
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.publicEquity24hUsd).toBe(0);
    expect(snapshotDeskIssuerRows(parsed)[0]?.equityUsd).toBe(0);
    expect(baseIssuerPresentation("ondo")).toEqual({ label: "ondo", official: false });
  });
});

describe("BNB snapshot file", () => {
  const days = parseSnapshotDeskDays(readDesk("bnb.json"), BNB_DESK);
  const nowT = Date.parse("2026-10-06T23:00:00-04:00") / 1000;
  const closed = closedSnapshotDeskDays(days, nowT);

  it("reads 2026-09-23 through 2026-10-05 and keys each bar to New York midnight", () => {
    const dates = days.map((day) => day.date);
    expect(dates.slice(0, 13)).toEqual([
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(new Set(dates).size).toBe(dates.length);
    for (const date of dates.slice(13)) expect(date > "2026-10-05").toBe(true);
    expect(days[0]?.t).toBe(utcInstantForDayKey("2026-09-23"));
    expect(days[1]?.t).toBe(utcInstantForDayKey("2026-09-24"));
    expect(days[1]?.t).toBe(1790222400);
    expect(closed.map((day) => day.date)).toEqual(dates.filter((date) => date <= "2026-10-05"));
  });

  it("keeps the 2026-10-05 lanes and drops the in-progress Eastern day", () => {
    const day = closed[closed.length - 1];
    expect(day?.date).toBe("2026-10-05");
    expect(day?.combined24hUsd).toBeCloseTo(123_467_117.75, 2);
    expect(day?.publicEquity24hUsd).toBeCloseTo(43_084_645.96, 2);
    expect(day?.etfIndex24hUsd).toBeCloseTo(27_920_882.63, 2);
    expect(day?.private24hUsd).toBeCloseTo(52_461_589.16, 2);
    const duringOct5 = Date.parse("2026-10-05T12:00:00-04:00") / 1000;
    expect(closedSnapshotDeskDays(days, duringOct5).at(-1)?.date).toBe("2026-10-04");
  });

  it("reads the Gecko issuer split, including days that previously had totals only", () => {
    const early = snapshotDeskIssuerRows(days.filter((day) => day.date === "2026-09-26"));
    expect(early.find((row) => row.slug === "bstocks")?.equityUsd).toBeGreaterThan(0);
    const rows = snapshotDeskIssuerRows(snapshotDeskDaysForRange(closed, "24h"));
    expect(rows.find((row) => row.slug === "bstocks")?.equityUsd).toBeCloseTo(41_259_109.75, 2);
    expect(rows.find((row) => row.slug === "ondo")).toMatchObject({
      official: true,
      equityUsd: expect.closeTo(1_168_307.08, 2),
      etfUsd: expect.closeTo(10_460_641.24, 2),
      privateUsd: expect.closeTo(4_880.39, 2),
    });
    expect(rows.find((row) => row.slug === "xstocks")?.equityUsd).toBeCloseTo(64.97, 2);
    expect(rows.find((row) => row.slug === "paimon")?.privateUsd).toBeCloseTo(52_456_640.03, 2);
    expect(bnbIssuerPresentation("ondo").official).toBe(true);
    expect(bnbIssuerPresentation("fourmeme")).toEqual({ label: "Four.meme 4Stock", official: true });
    expect(snapshotDeskHeadline(snapshotDeskDaysForRange(closed, "14d"), "14d", "BNB Chain").caption).not.toMatch(
      /trailing h24/i,
    );
  });
});

describe("home snapshot desks", () => {
  function chain(partial: Partial<ChainVolume> & Pick<ChainVolume, "id" | "name" | "volume24hUsd">): ChainVolume {
    return {
      ...robinhoodSnapshotChainShell(),
      privateVolume24hUsd: null,
      etfVolume24hUsd: null,
      ...partial,
    };
  }

  it("sums a Base day onto Solana and leaves a Base-only gap out", () => {
    const solanaT = utcInstantForDayKey("2026-10-05");
    const merged = mergeAdditionalDeskDays(
      [{ t: solanaT, volumeUsd: 100, kind: "calendar_day" }],
      parseSnapshotDeskDays(
        {
          records: [
            {
              date: "2026-10-04",
              publicEquity24hUsd: 7,
              private24hUsd: null,
              etfIndex24hUsd: null,
              combined24hUsd: 7,
              sources: { chainId: 8453, chainSlug: "base" },
            },
            {
              date: "2026-10-05",
              publicEquity24hUsd: 3,
              private24hUsd: null,
              etfIndex24hUsd: null,
              combined24hUsd: 3,
              sources: { chainId: 8453, chainSlug: "base" },
            },
          ],
        },
        BASE_DESK,
      ),
    );
    expect(merged.map((point) => [point.t, point.volumeUsd])).toEqual([
      [utcInstantForDayKey("2026-10-04"), 7],
      [solanaT, 103],
    ]);
  });

  it("ranks Solana, Robinhood, Base, and BNB by combined 24H", () => {
    const nowT = Date.parse("2026-10-09T03:00:00Z") / 1000;
    const base = snapshotHomeChainVolume(BASE_DESK, closedSnapshotDeskDays(parseSnapshotDeskDays(readDesk("base.json"), BASE_DESK), nowT));
    const bnbClosed = closedSnapshotDeskDays(parseSnapshotDeskDays(readDesk("bnb.json"), BNB_DESK), nowT);
    const bnb = snapshotHomeChainVolume(BNB_DESK, bnbClosed);
    const lastBnb = bnbClosed.at(-1);
    expect(chainCombinedVolume24h(base)).toBeCloseTo(37_535_102.57, 1);
    expect(chainCombinedVolume24h(bnb)).toBeCloseTo(
      (lastBnb?.publicEquity24hUsd ?? 0) + (lastBnb?.private24hUsd ?? 0) + (lastBnb?.etfIndex24hUsd ?? 0),
      1,
    );
    expect(snapshotHomeVolumeDetail(closedSnapshotDeskDays(parseSnapshotDeskDays(readDesk("base.json"), BASE_DESK), nowT), "Base")).toBe(
      "2026-10-07 America/New_York · last closed snapshot.",
    );
    expect(snapshotHomeVolumeDetail([], "BNB Chain")).toMatch(/not reported as zero/i);
    const ranked = homeChainsWithSnapshotDesks(
      [
        chain({ id: "solana", name: "Solana", volume24hUsd: 80_000_000 }),
        chain({ id: "base", name: "Stale Base", volume24hUsd: 1 }),
      ],
      [
        chain({ id: "robinhood-chain", name: "Robinhood Chain", volume24hUsd: 48_000_000 }),
        base,
        bnb,
      ],
    );
    expect(ranked.map((row) => row.id)).toEqual(["bnb", "solana", "robinhood-chain", "base"]);
    expect(ranked.filter((row) => row.id === "base")).toHaveLength(1);
    expect(ranked.find((row) => row.id === "base")?.name).toBe("Base");
  });

  it("does not invent a 7D bar before Base snapshots begin", () => {
    const nowT = Date.parse("2026-10-07T03:00:00Z") / 1000;
    const basePoints = snapshotDeskVolumePoints(
      closedSnapshotDeskDays(parseSnapshotDeskDays(readDesk("base.json"), BASE_DESK), nowT),
    );
    const seven = filterVolumeRange(basePoints, "7d");
    expect(seven).toHaveLength(7);
    expect(sumVolumePoints(seven)).toBeGreaterThan(0);
    expect(basePoints.some((point) => point.t === utcInstantForDayKey("2026-09-23"))).toBe(false);
    expect(basePoints.some((point) => point.t === utcInstantForDayKey("2026-09-24"))).toBe(false);
  });
});
