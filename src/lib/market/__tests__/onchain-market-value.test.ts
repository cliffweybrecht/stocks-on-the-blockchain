import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHolderSnapshotAsset, type HolderSnapshotFile } from "../holder-snapshots";
import {
  combineOnchainMarketValueHistories,
  compareByEquityCardMarketValue,
  equityCardMarketValueForRange,
  equityCardMarketValueSortUsd,
  lastClosedEasternDay,
  liveAssetMarketValueUsd,
  marketValueCaption,
  marketValueRangeView,
  onchainMarketValueHistoryFromPayloads,
} from "../onchain-market-value";
import { loadOnchainMarketValueHistory, resetOnchainMarketValueCache } from "../onchain-market-value-file";

/** 23:00 America/New_York on 2026-10-07. Oct 7 is still open. Oct 6 is the last closed day. */
const NOW = Date.parse("2026-10-08T03:00:00Z") / 1000;

function volumeDay(date: string, assets: unknown[] = []) {
  return { date, combined24hUsd: 1, assets };
}

function holderAsset(
  address: string,
  kind: "equity" | "private" | "etf",
  supply: number | null,
  price: number | null,
) {
  return buildHolderSnapshotAsset({
    asset: { address, symbol: address, issuer: null, instrumentKind: kind, priceUsd: price },
    totalSupplyRaw: supply === null ? null : String(supply),
    totalSupplyDecimals: 0,
    totalSupply: supply,
    priceUsd: price,
    holderCount: 1,
    supplySource: "solana-rpc:getTokenSupply",
    holderSource: "solana-rpc:getProgramAccounts:spl-token",
    priceSource: "dexscreener:dexMedianPriceUsd",
    notes: [],
    capturedAt: "2026-10-07T03:59:00.000Z",
  });
}

function holderFile(records: HolderSnapshotFile["records"]): HolderSnapshotFile {
  return { version: 1, chainId: "solana", records };
}

describe("lastClosedEasternDay", () => {
  it("is the previous America/New_York date", () => {
    expect(lastClosedEasternDay(NOW)).toBe("2026-10-06");
    expect(lastClosedEasternDay(0)).toBe("");
  });
});

describe("onchain market value ranges", () => {
  const payload = {
    records: [
      volumeDay("2026-10-04"),
      volumeDay("2026-10-05"),
      volumeDay("2026-10-06"),
      volumeDay("2026-10-07"),
    ],
  };
  const file = holderFile([
    {
      date: "2026-10-04",
      t: 1,
      capturedAt: "2026-10-05T03:59:00.000Z",
      holderCount: 2,
      supplyUsd: 30,
      publicMarketValueUsd: 10,
      privateMarketValueUsd: null,
      etfMarketValueUsd: 20,
      assetCount: 2,
      assetsWithHolders: 2,
      assetsWithSupplyUsd: 2,
      limits: [],
      assets: [holderAsset("mint-a", "equity", 1, 10), holderAsset("mint-b", "etf", 2, 10)],
    },
    {
      date: "2026-10-06",
      t: 3,
      capturedAt: "2026-10-07T03:59:00.000Z",
      holderCount: 2,
      supplyUsd: 70,
      publicMarketValueUsd: 40,
      privateMarketValueUsd: 30,
      etfMarketValueUsd: null,
      assetCount: 2,
      assetsWithHolders: 2,
      assetsWithSupplyUsd: 2,
      limits: [],
      assets: [holderAsset("mint-a", "equity", 4, 10), holderAsset("mint-c", "private", 3, 10)],
    },
    {
      date: "2026-10-07",
      t: 4,
      capturedAt: "2026-10-08T03:59:00.000Z",
      holderCount: 1,
      supplyUsd: 999,
      publicMarketValueUsd: 999,
      privateMarketValueUsd: null,
      etfMarketValueUsd: null,
      assetCount: 1,
      assetsWithHolders: 1,
      assetsWithSupplyUsd: 1,
      limits: [],
      assets: [holderAsset("mint-a", "equity", 99, 10)],
    },
  ]);

  it("uses the last closed day for 24H and averages recorded closes for 7D", () => {
    const history = onchainMarketValueHistoryFromPayloads(payload, file, NOW);
    expect(history.snapshotDays).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(history.chainDays.map((day) => day.date)).toEqual(["2026-10-04", "2026-10-06"]);

    const day = marketValueRangeView(history, "24h");
    expect(day.basis).toBe("close");
    expect(day.totalUsd).toBe(70);
    expect(day.publicUsd).toBe(40);
    expect(day.privateUsd).toBe(30);
    expect(day.etfUsd).toBeNull();
    expect(day.hint).toBe("24H");
    expect(day.series).toHaveLength(1);

    const week = marketValueRangeView(history, "7d");
    expect(week.basis).toBe("average");
    expect(week.totalUsd).toBe(50);
    expect(week.days).toBe(2);
    expect(week.hint).toBe("avg 7D · 2 of 7 days");
    expect(week.publicUsd).toBe(25);
    expect(week.privateUsd).toBe(30);
    expect(week.etfUsd).toBe(20);
    expect(week.series.map((point) => point.marketValueUsd)).toEqual([30, 70]);
    expect(marketValueCaption(week)).toContain("avg 7D · 2 of 7 days");
  });

  it("does not treat a missing close or a missing price as zero", () => {
    const history = onchainMarketValueHistoryFromPayloads(payload, file, NOW);
    const mintA = equityCardMarketValueForRange(history, "mint-a", "7d");
    expect(mintA).toEqual({
      marketValueUsd: 25,
      days: 2,
      series: [
        { date: "2026-10-04", t: 1, marketValueUsd: 10 },
        { date: "2026-10-06", t: 3, marketValueUsd: 40 },
      ],
    });
    expect(equityCardMarketValueForRange(history, "mint-a", "24h")?.marketValueUsd).toBe(40);
    expect(equityCardMarketValueForRange(history, "mint-missing", "7d")).toBeNull();
    expect(equityCardMarketValueForRange(history, "mint-b", "24h")).toBeNull();

    const empty = marketValueRangeView(
      onchainMarketValueHistoryFromPayloads(payload, holderFile([]), NOW),
      "7d",
    );
    expect(empty.recorded).toBe(false);
    expect(empty.totalUsd).toBeNull();
    expect(empty.hint).toBe("");
    expect(marketValueCaption(empty)).toContain("No captured supply");
  });

  it("sorts by the selected close and does not fill a missing snapshot from a live price", () => {
    const history = onchainMarketValueHistoryFromPayloads(payload, file, NOW);
    const a = {
      contractAddress: "mint-a",
      symbol: "A",
      volume24hUsd: 1,
      displayedLiquidityUsd: 1,
      marketCapUsd: null,
      dexMedianPriceUsd: 10,
      circulatingSupply: null,
      totalSupply: null,
    };
    const liveOnly = {
      contractAddress: "mint-z",
      symbol: "Z",
      volume24hUsd: 9,
      displayedLiquidityUsd: 9,
      marketCapUsd: null,
      dexMedianPriceUsd: 5,
      circulatingSupply: 4,
      totalSupply: 100,
    };
    expect(liveAssetMarketValueUsd(liveOnly)).toBe(20);
    expect(liveAssetMarketValueUsd({ dexMedianPriceUsd: 5, circulatingSupply: null, totalSupply: 3 })).toBe(15);
    expect(liveAssetMarketValueUsd({ dexMedianPriceUsd: null, totalSupply: 3 })).toBeNull();
    expect(equityCardMarketValueSortUsd(liveOnly, history, "24h")).toBeNull();
    expect(equityCardMarketValueSortUsd(liveOnly, history, "30d")).toBeNull();
    expect(compareByEquityCardMarketValue(a, liveOnly, history, "24h")).toBeLessThan(0);
    expect(compareByEquityCardMarketValue(liveOnly, a, history, "30d")).toBeGreaterThan(0);
  });

  it("sums chains and omits a chain that missed the day", () => {
    const left = onchainMarketValueHistoryFromPayloads(payload, file, NOW);
    const right = onchainMarketValueHistoryFromPayloads(
      payload,
      holderFile([
        {
          date: "2026-10-06",
          t: 3,
          capturedAt: "2026-10-07T03:59:00.000Z",
          holderCount: 1,
          supplyUsd: 5,
          publicMarketValueUsd: 5,
          privateMarketValueUsd: null,
          etfMarketValueUsd: null,
          assetCount: 1,
          assetsWithHolders: 1,
          assetsWithSupplyUsd: 1,
          limits: [],
          assets: [holderAsset("0xAbC", "equity", 1, 5)],
        },
      ]),
      NOW,
    );
    const combined = combineOnchainMarketValueHistories([left, right]);
    const week = marketValueRangeView(combined, "7d");
    expect(week.series.map((point) => point.marketValueUsd)).toEqual([30, 75]);
    expect(equityCardMarketValueForRange(combined, "0xabc", "24h")?.marketValueUsd).toBe(5);
  });
});

describe("loadOnchainMarketValueHistory", () => {
  it("reads local files and does not invent a close when the holder file is missing", async () => {
    const root = join(tmpdir(), `market-value-${Date.now()}`);
    const volumeDir = join(root, "volume");
    const holderDir = join(root, "holders");
    await mkdir(volumeDir, { recursive: true });
    await writeFile(
      join(volumeDir, "base.json"),
      JSON.stringify({ records: [volumeDay("2026-10-06")] }),
    );
    resetOnchainMarketValueCache();
    const history = await loadOnchainMarketValueHistory("base", NOW, volumeDir, holderDir);
    expect(history.snapshotDays).toEqual(["2026-10-06"]);
    expect(history.chainDays).toEqual([]);
    expect(marketValueRangeView(history, "24h").totalUsd).toBeNull();
  });
});
