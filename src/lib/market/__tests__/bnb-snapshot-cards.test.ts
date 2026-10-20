import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { equityCardRangeVolumesFromSnapshot } from "../equity-card-range-volume";
import { snapshotDeskDaysForRange } from "../snapshot-desk-volume";
import type { AssetDetail } from "../types";
import {
  bnbBackfillWithoutNightlyDates,
  bnbDeskRangeViews,
  bnbSnapshotChartDays,
  buildBnbSnapshotCardCatalog,
  findBnbSnapshotDetail,
  overlayBnbSnapshotIdentity,
  sumBnbSnapshotCardLanes,
  sumBnbSnapshotChartLanes,
} from "../bnb-snapshot-cards";

const snapPath = join(process.cwd(), "data/volume-snapshots/bnb.json");
const backfillPath = join(process.cwd(), "data/volume-snapshots/bnb-asset-daily.json");
const payload = JSON.parse(readFileSync(snapPath, "utf8"));
const backfill = JSON.parse(readFileSync(backfillPath, "utf8"));
const filteredBackfill = bnbBackfillWithoutNightlyDates(payload, backfill);
const nowT = Date.now() / 1000;
const catalog = buildBnbSnapshotCardCatalog(payload, nowT, backfill);
const volumes = equityCardRangeVolumesFromSnapshot(payload, nowT, filteredBackfill);
const chartDays = bnbSnapshotChartDays(payload, nowT, backfill);

function expectLane(actual: number | null, expected: number | null) {
  if (actual === null || expected === null) {
    expect(actual).toBe(expected);
    return;
  }
  expect(Math.abs(actual - expected)).toBeLessThan(0.05);
}

describe("BNB snapshot cards", () => {
  it("sums each lane of cards to the chart lane total on the latest closed windows", () => {
    expect(chartDays.length).toBeGreaterThan(0);
    for (const range of ["24h", "7d", "14d", "30d"] as const) {
      const window = snapshotDeskDaysForRange(chartDays, range);
      const cards = sumBnbSnapshotCardLanes(catalog.ranges[range], volumes, range);
      const chart = sumBnbSnapshotChartLanes(window);
      expectLane(cards.equity, chart.equity);
      expectLane(cards.etf, chart.etf);
      expectLane(cards.private, chart.private);
      expect(window.length).toBeGreaterThan(0);
    }
  });

  it("lists snapshot issuers in the stored lane, including bStocks, Four.meme, and Paimon", () => {
    const equity = catalog.ranges["14d"].assets;
    const etf = catalog.ranges["14d"].etfAssets;
    const priv = catalog.ranges["14d"].privateAssets;
    expect(equity.length).toBeGreaterThan(35);
    expect(equity.some((card) => card.symbol === "NVDAB" && card.issuer === "bStocks" && card.instrumentKind === "equity")).toBe(
      true,
    );
    expect(equity.some((card) => card.symbol === "BNC4" && card.issuer === "Four.meme 4Stock")).toBe(true);
    expect(equity.some((card) => card.symbol === "SPCXon" && card.instrumentKind === "equity")).toBe(true);
    expect(equity.some((card) => card.symbol === "SPCXx" && card.issuer === "xStocks" && card.instrumentKind === "equity")).toBe(
      true,
    );
    expect(equity.some((card) => card.symbol === "SPCXB" && card.instrumentKind === "equity")).toBe(true);
    expect(etf.some((card) => card.symbol === "QQQB" && card.issuer === "bStocks" && card.instrumentKind === "etf")).toBe(true);
    expect(priv.some((card) => card.symbol === "xOPAI" && card.issuer === "Paimon")).toBe(true);
    expect(priv.some((card) => card.symbol === "pPOLY" && card.issuer === "Paimon")).toBe(true);
    expect(priv.some((card) => card.symbol === "SPCXon" || card.symbol === "SPCXx")).toBe(false);

    const views = bnbDeskRangeViews(catalog, "equity", "all", "all");
    const labels = views["14d"].issuerFacets.map((facet) => facet.label);
    expect(labels).toEqual(expect.arrayContaining(["bStocks", "Four.meme 4Stock", "Ondo", "xStocks"]));
    expect(views["14d"].equityCount).toBe(equity.length);
    expect(views["14d"].privateCount).toBe(priv.length);
    expect(views["24h"].addresses.length).toBeGreaterThan(0);
    expect(views["24h"].addresses.length).toBeLessThanOrEqual(views["14d"].addresses.length);
  });

  it("keeps a null snapshot volume null and uses the symbol when no name was stored", () => {
    const detail = findBnbSnapshotDetail(catalog.details, "NVDAB");
    expect(detail?.name).toBe("NVDAB");
    expect(detail?.logoUrl).toBeNull();
    expect(detail?.instrumentKind).toBe("equity");
    expect(detail?.pools.length).toBeGreaterThan(0);

    const synthetic = buildBnbSnapshotCardCatalog(
      {
        records: [
          {
            date: "2026-10-19",
            publicEquity24hUsd: null,
            private24hUsd: null,
            etfIndex24hUsd: null,
            combined24hUsd: 0,
            assets: [
              {
                address: "0x00000000000000000000000000000000000000ab",
                symbol: "NVDAB",
                name: "NVIDIA Corp",
                issuer: "bstocks",
                instrumentKind: "equity",
                volume24hUsd: null,
                pools: [],
              },
            ],
            sources: { chainId: 56, chainSlug: "bsc" },
          },
        ],
      },
      Date.parse("2026-10-20T16:00:00Z") / 1000,
    );
    const card = synthetic.ranges["24h"].assets[0];
    expect(card?.name).toBe("NVIDIA Corp");
    expect(card?.issuer).toBe("bStocks");
    expect(card?.volume24hUsd).toBeNull();
    expect(sumBnbSnapshotCardLanes(synthetic.ranges["24h"], {}, "24h").equity).toBeNull();
  });

  it("keeps the snapshot lane when a live registry calls SPCX private", () => {
    const stored = findBnbSnapshotDetail(catalog.details, "SPCXon");
    expect(stored?.instrumentKind).toBe("equity");
    const live = {
      ...(stored as AssetDetail),
      instrumentKind: "private" as const,
      issuer: "Ondo",
      name: "SpaceX",
      logoUrl: "https://example.com/spcx.png",
      volume24hUsd: 12,
      pools: stored?.pools ?? [],
    };
    const merged = overlayBnbSnapshotIdentity(stored as AssetDetail, live);
    expect(merged.instrumentKind).toBe("equity");
    expect(merged.issuer).toBe("Ondo");
    expect(merged.name).toBe("SpaceX");
    expect(merged.logoUrl).toBe("https://example.com/spcx.png");
    expect(merged.volume24hUsd).toBe(12);
  });

  it("drops backfill rows on dates bnb.json already recorded", () => {
    const file = filteredBackfill as { records?: { date?: string }[] };
    const nightly = new Set(chartDays.filter((day) => day.source !== "asset-backfill").map((day) => day.date));
    expect(nightly.size).toBeGreaterThan(0);
    expect(file.records?.some((row) => row.date && nightly.has(row.date))).toBe(false);
    expect(file.records?.some((row) => row.date && !nightly.has(row.date))).toBe(true);
  });
});
