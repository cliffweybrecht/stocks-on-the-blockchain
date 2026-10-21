import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOLANA_CHAIN_ID } from "../types";
import { loadEquityCardRangeMetrics, resetEquityCardRangeVolumeCache } from "../equity-card-range-volume-file";
import { equityCardPriceForRange, equityCardPriceHistoryFromPayloads } from "../equity-card-range-price";
import { equityCardVolumeHistoryFromSnapshot, equityCardVolumeSeriesForRange } from "../equity-card-range-volume";
import type { HolderSnapshotFile } from "../holder-snapshots";

const NOW = Date.parse("2026-10-21T15:00:00Z") / 1000;
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const CRCL = "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1";
const TSLA = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";

function holderFile(records: HolderSnapshotFile["records"]): HolderSnapshotFile {
  return { version: 1, chainId: "solana", records };
}

function day(date: string, assets: unknown[]) {
  return { date, t: 1, combined24hUsd: 1, generatedAt: `${date}T16:00:00.000Z`, assets };
}

describe("equityCardPriceHistoryFromPayloads", () => {
  it("does not invent a close from supply, a gap, or a non-adjacent day", () => {
    const volume = {
      records: [
        day("2026-10-08", [{ address: "mint", volume24hUsd: 5 }]),
        day("2026-10-18", [{ address: "other", volume24hUsd: 1 }]),
        day("2026-10-19", [
          { address: "mint", volume24hUsd: 8 },
          { address: "flat", volume24hUsd: 0 },
        ]),
      ],
    };
    const holders = holderFile([
      {
        date: "2026-10-08",
        t: 1_760_000_000,
        capturedAt: "2026-10-08T04:00:00.000Z",
        holderCount: null,
        supplyUsd: 100,
        publicMarketValueUsd: null,
        privateMarketValueUsd: null,
        etfMarketValueUsd: null,
        assetCount: 1,
        assetsWithHolders: 0,
        assetsWithSupplyUsd: 1,
        limits: [],
        assets: [
          {
            address: "mint",
            symbol: "CRCLx",
            issuer: null,
            instrumentKind: "equity",
            totalSupplyRaw: null,
            totalSupplyDecimals: null,
            totalSupply: null,
            circulatingSupply: null,
            priceUsd: null,
            supplyUsd: 66_000_000,
            holderCount: null,
            sources: { totalSupply: null, supplyUsd: null, holderCount: null, price: null },
            notes: [],
            capturedAt: "2026-10-08T04:00:00.000Z",
          },
        ],
      },
      {
        date: "2026-10-19",
        t: 1_761_000_000,
        capturedAt: "2026-10-19T04:00:00.000Z",
        holderCount: null,
        supplyUsd: 10,
        publicMarketValueUsd: null,
        privateMarketValueUsd: null,
        etfMarketValueUsd: null,
        assetCount: 1,
        assetsWithHolders: 0,
        assetsWithSupplyUsd: 1,
        limits: [],
        assets: [
          {
            address: "mint",
            symbol: "CRCLx",
            issuer: null,
            instrumentKind: "equity",
            totalSupplyRaw: null,
            totalSupplyDecimals: null,
            totalSupply: 1_000,
            circulatingSupply: 1_000,
            priceUsd: 86.085,
            supplyUsd: 86_085,
            holderCount: null,
            sources: { totalSupply: null, supplyUsd: null, holderCount: null, price: "dex" },
            notes: [],
            capturedAt: "2026-10-19T04:00:00.000Z",
          },
        ],
      },
    ]);
    const prices = equityCardPriceHistoryFromPayloads(volume, holders, NOW);
    const month = equityCardPriceForRange(prices, "mint", "30d");
    expect(month?.priceUsd).toBe(86.085);
    expect(month?.changePct).toBeNull();
    expect(month?.series.map((point) => point.date)).toEqual(["2026-10-19"]);
    expect(month?.series.some((point) => point.priceUsd === 0)).toBe(false);

    const dayPrice = equityCardPriceForRange(prices, "mint", "24h");
    expect(dayPrice?.priceUsd).toBe(86.085);
    expect(dayPrice?.changePct).toBeNull();
    expect(dayPrice?.series).toHaveLength(1);

    const series = equityCardVolumeSeriesForRange(equityCardVolumeHistoryFromSnapshot(volume, NOW), "mint", "30d");
    expect(series.map((point) => point.volumeUsd)).toEqual([5, 8]);
    const flat = equityCardVolumeSeriesForRange(equityCardVolumeHistoryFromSnapshot(volume, NOW), "flat", "30d");
    expect(flat.map((point) => point.volumeUsd)).toEqual([0]);
  });
});

describe("Solana card closes on 2026-10-21", () => {
  it("joins NVDAx, CRCLx, and TSLAx 30D prices from the holder file and does not write it", async () => {
    resetEquityCardRangeVolumeCache();
    const holderPath = join(process.cwd(), "data/holder-snapshots/solana.json");
    const volumePath = join(process.cwd(), "data/volume-snapshots/solana.json");
    const before = {
      holder: statSync(holderPath).mtimeMs,
      volume: statSync(volumePath).mtimeMs,
    };
    const metrics = await loadEquityCardRangeMetrics(SOLANA_CHAIN_ID, NOW);
    expect(statSync(holderPath).mtimeMs).toBe(before.holder);
    expect(statSync(volumePath).mtimeMs).toBe(before.volume);

    const nvda = equityCardPriceForRange(metrics.prices, NVDA, "30d");
    expect(nvda?.series.map((point) => point.priceUsd)).toEqual([231.465, 217.95]);
    expect(nvda?.priceUsd).toBe(217.95);
    expect(nvda?.direction).toBe("down");
    expect(nvda?.changePct).toBeCloseTo(((217.95 - 231.465) / 231.465) * 100, 8);

    const crcl = equityCardPriceForRange(metrics.prices, CRCL, "30d");
    expect(crcl?.priceUsd).toBe(86.085);
    expect(crcl?.changePct).toBeNull();
    expect(crcl?.series).toHaveLength(1);

    const tsla = equityCardPriceForRange(metrics.prices, TSLA, "30d");
    expect(tsla?.priceUsd).toBe(374.29);
    expect(tsla?.changePct).toBeNull();
    expect(tsla?.direction).toBeNull();

    expect(equityCardVolumeSeriesForRange(metrics.volumeSeries, NVDA, "30d").length).toBeGreaterThan(1);
    expect(equityCardVolumeSeriesForRange(metrics.volumeSeries, CRCL, "30d").length).toBeGreaterThan(1);
    expect(equityCardVolumeSeriesForRange(metrics.volumeSeries, TSLA, "30d").length).toBeGreaterThan(1);
    expect(equityCardPriceForRange(metrics.prices, "missing-mint", "30d")).toBeNull();
  });
});
