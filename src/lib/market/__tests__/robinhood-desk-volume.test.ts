import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadClosedRobinhoodDeskDays, loadRobinhoodDeskDays } from "../robinhood-desk-volume-file";
import {
  closedRobinhoodDeskDays,
  parseRobinhoodDeskDays,
  robinhoodDaysForRange,
  robinhoodDeskHeadline,
  robinhoodDisplayedLiquidity,
  robinhoodIssuerPresentation,
  robinhoodIssuerRows,
  robinhoodSnapshotChainShell,
} from "../robinhood-desk-volume";

const snapshotPath = join(process.cwd(), "data/volume-snapshots/robinhood.json");

function day(partial: Record<string, unknown>) {
  return {
    date: "2026-10-05",
    t: 1,
    publicEquity24hUsd: 10,
    private24hUsd: 2,
    etfIndex24hUsd: 3,
    combined24hUsd: 15,
    generatedAt: "2026-10-06T04:00:00.000Z",
    sources: { chainId: 4663, chainSlug: "robinhood" },
    ...partial,
  };
}

describe("robinhood snapshot file", () => {
  const days = parseRobinhoodDeskDays(JSON.parse(readFileSync(snapshotPath, "utf8")));

  it("keeps the committed bars through 2026-10-05 when a later day is appended", () => {
    const dates = days.map((row) => row.date);
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
    const oct5 = days.find((row) => row.date === "2026-10-05");
    expect(oct5?.combined24hUsd).toBeCloseTo(115_558_513.6);
    expect(oct5?.t).toBe(Date.parse("2026-10-05T04:00:00.000Z") / 1000);
    const oct7 = days.find((row) => row.date === "2026-10-07");
    expect(oct7?.combined24hUsd).toBeCloseTo(171_520_982.29);
    expect(oct7?.displayedLiquidityUsd).toBeGreaterThan(0);
    const oct7Issuers = robinhoodIssuerRows(oct7 ? [oct7] : []);
    expect(oct7Issuers.map((row) => row.slug)).toEqual(["rhj"]);
  });

  it("keeps the 2026-10-05 bar when displayed liquidity is present and labels Ondo as unverified", () => {
    const last = days.find((row) => row.date === "2026-10-05");
    expect(last?.displayedLiquidityUsd).toBeGreaterThan(0);
    const issuers = robinhoodIssuerRows(last ? [last] : []);
    expect(issuers.map((row) => row.label)).toEqual(["RHJ"]);
    expect(robinhoodIssuerPresentation("ondo")).toMatchObject({ official: false });
    expect(issuers.find((row) => row.slug === "rhj")).toMatchObject({
      official: true,
      equityUsd: expect.closeTo(75_037_565.64, 2),
      etfUsd: expect.closeTo(33_139_374.65, 2),
      privateUsd: expect.closeTo(7_381_573.29, 2),
    });
  });
});

describe("parseRobinhoodDeskDays", () => {
  it("drops another chain id and a day with no reported volume", () => {
    const parsed = parseRobinhoodDeskDays({
      version: 1,
      records: [
        day({ date: "2026-10-04" }),
        day({ date: "2026-10-03", sources: { chainId: 8453 } }),
        day({
          date: "2026-10-02",
          publicEquity24hUsd: null,
          private24hUsd: null,
          etfIndex24hUsd: null,
          combined24hUsd: null,
        }),
      ],
    });
    expect(parsed.map((row) => row.date)).toEqual(["2026-10-04"]);
  });

  it("keeps a day when liquidity is missing and does not turn a null lane into $0", () => {
    const parsed = parseRobinhoodDeskDays({
      records: [
        day({
          displayedLiquidityUsd: null,
          etfIndex24hUsd: null,
          combined24hUsd: 12,
          issuersByLane: {
            equity: { rhj: { usd: 10, liquidityUsd: null } },
            etf: { ondo: { usd: null, liquidityUsd: null } },
            private: { rhj: { usd: 2, liquidityUsd: 5 } },
          },
        }),
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.displayedLiquidityUsd).toBeNull();
    expect(parsed[0]?.etfIndex24hUsd).toBeNull();
    expect(parsed[0]?.etf[0]).toMatchObject({ slug: "ondo", usd: null, label: "Ondo-named (unverified)" });
    expect(robinhoodDisplayedLiquidity(parsed)).toBeNull();
  });

  it("does not call Ondo official", () => {
    expect(robinhoodIssuerPresentation("ondo")).toEqual({
      label: "Ondo-named (unverified)",
      official: false,
    });
    expect(robinhoodIssuerPresentation("Ondo").label).not.toBe("Ondo");
  });
});

describe("closed Robinhood ranges", () => {
  const parsed = parseRobinhoodDeskDays({
    records: ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"].map((date, index) =>
      day({ date, combined24hUsd: (index + 1) * 100, publicEquity24hUsd: (index + 1) * 100, private24hUsd: null, etfIndex24hUsd: null }),
    ),
  });

  it("omits the in-progress Eastern day and any later day", () => {
    const duringOct5 = Date.parse("2026-10-05T15:00:00-04:00") / 1000;
    expect(closedRobinhoodDeskDays(parsed, duringOct5).map((row) => row.date)).toEqual([
      "2026-10-03",
      "2026-10-04",
    ]);
    const afterClose = Date.parse("2026-10-06T00:00:00-04:00") / 1000;
    expect(closedRobinhoodDeskDays(parsed, afterClose).map((row) => row.date)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
  });

  it("uses the newest closed day as the 24H KPI and the newest N days for charts", () => {
    const closed = closedRobinhoodDeskDays(parsed, Date.parse("2026-10-07T12:00:00-04:00") / 1000);
    const kpi = robinhoodDaysForRange(closed, "24h");
    expect(kpi.map((row) => row.date)).toEqual(["2026-10-06"]);
    expect(robinhoodDeskHeadline(kpi, "24h").volumeUsd).toBe(400);
    expect(robinhoodDeskHeadline(kpi, "24h").caption).toBe(
      "24H · 2026-10-06 America/New_York · last closed snapshot",
    );
    expect(robinhoodDeskHeadline(kpi, "24h").caption).not.toMatch(/trailing h24/i);
    expect(robinhoodDaysForRange(closed, "7d").map((row) => row.date)).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(robinhoodDeskHeadline(robinhoodDaysForRange(closed, "7d"), "7d").volumeUsd).toBe(1000);
  });
});

describe("loadRobinhoodDeskDays", () => {
  it("returns no days when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-desk-"));
    expect(await loadRobinhoodDeskDays(dir)).toEqual([]);
  });

  it("drops the in-progress Eastern day when the clock is inside that date", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-desk-"));
    await writeFile(
      join(dir, "robinhood.json"),
      JSON.stringify({
        version: 1,
        records: [day({ date: "2026-10-05" }), day({ date: "2026-10-06", combined24hUsd: 9 })],
      }),
    );
    const during = Date.parse("2026-10-06T18:00:00-04:00") / 1000;
    const loaded = await loadClosedRobinhoodDeskDays(dir, during);
    expect(loaded.map((row) => row.date)).toEqual(["2026-10-05"]);
  });

  it("reads a directory that contains robinhood.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rh-desk-"));
    await writeFile(join(dir, "robinhood.json"), JSON.stringify({ version: 1, records: [day({ date: "2026-09-30" })] }));
    const loaded = await loadRobinhoodDeskDays(dir);
    expect(loaded.map((row) => row.date)).toEqual(["2026-09-30"]);
  });
});

describe("robinhoodSnapshotChainShell", () => {
  it("does not invent a live 24h total", () => {
    const chain = robinhoodSnapshotChainShell();
    expect(chain.id).toBe("robinhood-chain");
    expect(chain.nativeChainId).toBe("4663");
    expect(chain.volume24hUsd).toBeNull();
    expect(chain.privateVolume24hUsd).toBeNull();
    expect(chain.etfVolume24hUsd).toBeNull();
  });
});
