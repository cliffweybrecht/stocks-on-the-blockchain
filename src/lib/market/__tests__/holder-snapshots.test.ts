import { describe, expect, it } from "vitest";
import {
  buildHolderSnapshotAsset,
  combineHolderDeskPoints,
  holderSnapshotTotals,
  marketValuePrice,
  marketValueLanes,
  consecutiveChange,
  decimalAdjustedSupply,
  holderAssetRangeView,
  holderDaySlots,
  parseHolderSnapshotFile,
  parseStoredHolderSnapshotFile,
  upsertHolderSnapshotDay,
  type HolderSnapshotAsset,
  type HolderSnapshotDay,
} from "../holder-snapshots";
import {
  classifyGeckoHolderResponse,
  countNonZeroSplAmounts,
  parseEvmDecimalsCall,
  parseGeckoHolderCount,
  parseSolanaMintSupply,
} from "../holder-snapshot-fetch";

const asset = {
  address: "Mint111",
  symbol: "AAPLx",
  issuer: "xStocks",
  instrumentKind: "equity" as const,
  priceUsd: 200,
};

function day(date: string, holderCount: number | null, supplyUsd: number | null): HolderSnapshotDay {
  const row = buildHolderSnapshotAsset({
    asset,
    totalSupplyRaw: "100000000",
    totalSupplyDecimals: 8,
    totalSupply: holderCount === null ? null : 1,
    priceUsd: supplyUsd,
    holderCount,
    supplySource: "solana-rpc:getTokenSupply",
    holderSource: "solana-rpc:getProgramAccounts:token-2022",
    priceSource: "dexscreener:dexMedianPriceUsd",
    notes: holderCount === null ? ["missing"] : [],
    capturedAt: `${date}T03:59:00.000Z`,
  });
  const lanes = marketValueLanes([row]);
  return {
    date,
    t: Date.parse(`${date}T00:00:00.000Z`) / 1000,
    capturedAt: row.capturedAt,
    holderCount,
    supplyUsd: row.supplyUsd,
    ...lanes,
    assetCount: 1,
    assetsWithHolders: holderCount === null ? 0 : 1,
    assetsWithSupplyUsd: row.supplyUsd === null ? 0 : 1,
    limits: [],
    assets: [row],
  };
}

describe("decimalAdjustedSupply", () => {
  it("scales an ERC-20 integer by decimals", () => {
    expect(decimalAdjustedSupply(BigInt("15376223592754"), 8)).toBeCloseTo(153762.23592754);
    expect(decimalAdjustedSupply(BigInt(0), 18)).toBe(0);
  });

  it("does not invent a number from a negative or an absurd decimals value", () => {
    expect(decimalAdjustedSupply(BigInt(-1), 8)).toBeNull();
    expect(decimalAdjustedSupply(BigInt(10), 37)).toBeNull();
  });
});

describe("on-chain parsers", () => {
  it("reads Solana uiAmountString and keeps the raw integer", () => {
    const parsed = parseSolanaMintSupply({
      result: {
        value: {
          amount: "15376223592754",
          decimals: 8,
          uiAmountString: "154264.88660493",
        },
      },
    });
    expect(parsed?.raw).toBe("15376223592754");
    expect(parsed?.adjusted).toBe(154264.88660493);
    expect(parsed?.adjusted).not.toBeCloseTo(153762.23592754, 2);
  });

  it("counts only non-zero sliced amounts and treats an RPC error as unknown", () => {
    const zero = Buffer.alloc(8);
    const two = Buffer.alloc(8);
    two.writeBigUInt64LE(BigInt(2));
    expect(
      countNonZeroSplAmounts({
        result: [
          { account: { data: [zero.toString("base64"), "base64"] } },
          { account: { data: [two.toString("base64"), "base64"] } },
        ],
      }),
    ).toBe(1);
    expect(countNonZeroSplAmounts({ result: [] })).toBe(0);
    expect(countNonZeroSplAmounts({ error: { code: -32000, message: "blocked" } })).toBeNull();
  });

  it("reads a Gecko holder integer and ignores a float", () => {
    expect(parseGeckoHolderCount({ data: { attributes: { holders: { count: 10630 } } } })).toBe(10630);
    expect(parseGeckoHolderCount({ data: { attributes: { holders: { count: 1.5 } } } })).toBeNull();
    expect(parseEvmDecimalsCall({ result: "0x12" })).toBe(18);
    expect(classifyGeckoHolderResponse(200, { data: { attributes: { holders: { count: 3 } } } })).toMatchObject({
      holderCount: 3,
      settled: true,
      note: null,
    });
    expect(classifyGeckoHolderResponse(200, { data: { attributes: { holders: { count: null } } } }).settled).toBe(true);
    expect(classifyGeckoHolderResponse(404, { errors: [] })).toMatchObject({ holderCount: null, settled: true });
    expect(classifyGeckoHolderResponse(429, null)).toMatchObject({ holderCount: null, settled: false });
  });
});

describe("holder snapshot days", () => {
  it("prices supply only when both sides exist and replaces the same Eastern day", () => {
    const row = buildHolderSnapshotAsset({
      asset,
      totalSupplyRaw: "100000000",
      totalSupplyDecimals: 8,
      totalSupply: 1,
      priceUsd: null,
      holderCount: 4,
      supplySource: "solana-rpc:getTokenSupply",
      holderSource: "solana-rpc:getProgramAccounts:spl-token",
      priceSource: "dexscreener:dexMedianPriceUsd",
      notes: [],
      capturedAt: "2026-10-08T21:00:00.000Z",
    });
    expect(row.supplyUsd).toBeNull();
    expect(row.sources.supplyUsd).toBeNull();
    expect(row.holderCount).toBe(4);
    const first = day("2026-10-08", 4, 10);
    const replaced = upsertHolderSnapshotDay([first], day("2026-10-08", 9, 12));
    expect(replaced).toHaveLength(1);
    expect(replaced[0]?.holderCount).toBe(9);
    const file = parseHolderSnapshotFile({ version: 1, chainId: "solana", records: replaced }, "solana");
    expect(file.records[0]?.date).toBe("2026-10-08");
  });

  it("reads a historical day back without adding fields the capture did not store", () => {
    const asset = {
      address: "mint-a",
      symbol: "A",
      issuer: null,
      instrumentKind: "equity" as const,
      totalSupplyRaw: "100",
      totalSupplyDecimals: 0,
      totalSupply: 100,
      supplyUsd: 10,
      holderCount: 2,
      sources: { totalSupply: "solana-rpc:getTokenSupply", supplyUsd: "x", holderCount: "y", price: "z" },
      notes: [],
      capturedAt: "2026-10-08T21:00:00.000Z",
    };
    const record = {
      date: "2026-10-08",
      t: 1,
      capturedAt: "2026-10-08T21:00:00.000Z",
      holderCount: 2,
      supplyUsd: 10,
      assetCount: 1,
      assetsWithHolders: 1,
      assetsWithSupplyUsd: 1,
      limits: [],
      assets: [asset],
    };
    const stored = parseStoredHolderSnapshotFile({ version: 1, chainId: "solana", records: [record] }, "solana");
    expect(stored.records[0]).toEqual(record);
    expect("circulatingSupply" in stored.records[0]!.assets[0]!).toBe(false);
    expect("publicMarketValueUsd" in stored.records[0]!).toBe(false);
    const read = parseHolderSnapshotFile({ version: 1, chainId: "solana", records: [record] }, "solana");
    expect(read.records[0]?.publicMarketValueUsd).toBe(10);
    expect(read.records[0]?.assets[0]?.supplyUsd).toBe(10);
  });

  it("leaves a missing day empty and changes only consecutive real snapshots", () => {
    const points = [
      { date: "2026-10-06", t: 1, holderCount: 10, totalSupply: 100, supplyUsd: 1000 },
      { date: "2026-10-08", t: 3, holderCount: 14, totalSupply: 110, supplyUsd: 1200 },
    ];
    const slots = holderDaySlots(points, "7d", (row) => row.holderCount);
    const empty = slots.filter((slot) => slot.empty).map((slot) => slot.date);
    expect(empty).toContain("2026-10-07");
    expect(empty).toContain("2026-10-02");
    expect(consecutiveChange(slots)).toBeNull();
    const consecutive = holderDaySlots(
      [
        { date: "2026-10-07", t: 2, holderCount: 10 },
        { date: "2026-10-08", t: 3, holderCount: 14 },
      ],
      "7d",
      (row) => row.holderCount,
    );
    expect(consecutiveChange(consecutive)).toBe(4);
    const view = holderAssetRangeView(points, "7d");
    expect(view.holderCount).toBe(14);
    expect(view.holderChange).toBeNull();
    expect(view.supplyUsd).toBe(1200);
  });

  it("sums per-token holders across chains and skips a chain that missed the day", () => {
    const combined = combineHolderDeskPoints([
      [{ date: "2026-10-08", t: 1, holderCount: 10, supplyUsd: 100, assetCount: 2, assetsWithHolders: 2, assetsWithSupplyUsd: 1 }],
      [{ date: "2026-10-08", t: 1, holderCount: null, supplyUsd: 50, assetCount: 1, assetsWithHolders: 0, assetsWithSupplyUsd: 1 }],
    ]);
    expect(combined[0]?.holderCount).toBe(10);
    expect(combined[0]?.supplyUsd).toBe(150);
  });
});

describe("market value lanes", () => {
  it("sums supply × price by lane and leaves a missing price out of every total", () => {
    const priced = (kind: "equity" | "private" | "etf", supply: number, price: number | null) =>
      buildHolderSnapshotAsset({
        asset: { ...asset, instrumentKind: kind, priceUsd: price },
        totalSupplyRaw: String(supply),
        totalSupplyDecimals: 0,
        totalSupply: supply,
        priceUsd: price,
        holderCount: 1,
        supplySource: "solana-rpc:getTokenSupply",
        holderSource: "solana-rpc:getProgramAccounts:spl-token",
        priceSource: "dexscreener:dexMedianPriceUsd",
        notes: [],
        capturedAt: "2026-10-08T03:59:00.000Z",
      });
    const equity = priced("equity", 2, 10);
    const privateAsset = priced("private", 4, 5);
    const etf = priced("etf", 3, 8);
    const missing = priced("equity", 9, null);
    expect(equity.priceUsd).toBe(10);
    expect(equity.circulatingSupply).toBe(2);
    expect(equity.supplyUsd).toBe(20);
    expect(missing.priceUsd).toBeNull();
    expect(missing.supplyUsd).toBeNull();
    const totals = holderSnapshotTotals([equity, privateAsset, etf, missing]);
    expect(totals.publicMarketValueUsd).toBe(20);
    expect(totals.privateMarketValueUsd).toBe(20);
    expect(totals.etfMarketValueUsd).toBe(24);
    expect(totals.supplyUsd).toBe(64);
    expect(totals.assetsWithSupplyUsd).toBe(3);
  });
});

describe("circulating market value", () => {
  it("prices Solana amount/10^decimals and not the Token-2022 UI amount", () => {
    const row = buildHolderSnapshotAsset({
      asset,
      totalSupplyRaw: "15505684087196",
      totalSupplyDecimals: 8,
      totalSupply: 1_550_568.4087196,
      priceUsd: 707.01,
      holderCount: 3454,
      supplySource: "solana-rpc:getTokenSupply",
      holderSource: "solana-rpc:getProgramAccounts:token-2022",
      priceSource: "dexscreener:dexMedianPriceUsd",
      notes: [],
      capturedAt: "2026-10-08T21:48:28.198Z",
    });
    expect(row.circulatingSupply).toBeCloseTo(155_056.84087196, 4);
    expect(row.supplyUsd).toBeCloseTo(155_056.84087196 * 707.01, 2);
    expect(row.supplyUsd).not.toBeCloseTo(1_550_568.4087196 * 707.01, -3);
  });

  it("leaves supplyUsd null when the displayed pool reserve is under $1", () => {
    const row = buildHolderSnapshotAsset({
      asset: { ...asset, displayedLiquidityUsd: 0.0006 },
      totalSupplyRaw: "780290321452628",
      totalSupplyDecimals: 6,
      totalSupply: 780_290_321.452628,
      priceUsd: 1.44,
      holderCount: 16,
      supplySource: "solana-rpc:getTokenSupply",
      holderSource: "solana-rpc:getProgramAccounts:token-2022",
      priceSource: "dexscreener:dexMedianPriceUsd",
      notes: [],
      capturedAt: "2026-10-08T21:48:33.619Z",
    });
    expect(row.circulatingSupply).toBeCloseTo(780_290_321.452628, 2);
    expect(row.priceUsd).toBeNull();
    expect(row.supplyUsd).toBeNull();
    expect(row.notes.some((note) => note.includes("under 1 USD"))).toBe(true);
  });

  it("prices the deepest pool and does not average a thin outlier", () => {
    const quote = marketValuePrice({
      ...asset,
      address: "CSCOxMint",
      priceUsd: 19_162.6625,
      displayedLiquidityUsd: 498,
      pools: [
        { priceUsd: 38_210.31, liquidityUsd: 57.29, baseAddress: "CSCOxMint" },
        { priceUsd: 115.015, liquidityUsd: 441.08, baseAddress: "CSCOxMint" },
        { priceUsd: 9_999, liquidityUsd: 5_000, baseAddress: "some-other-base" },
      ],
    });
    expect(quote.priceUsd).toBe(115.015);
    expect(quote.displayedLiquidityUsd).toBe(441.08);
  });

  it("does not treat a missing reserve as dust", () => {
    const row = buildHolderSnapshotAsset({
      asset,
      totalSupplyRaw: "100",
      totalSupplyDecimals: 0,
      totalSupply: 100,
      priceUsd: 2,
      holderCount: 3,
      supplySource: "evm-rpc:eth_call:totalSupply+decimals",
      holderSource: "geckoterminal:holders.count",
      priceSource: "dexscreener:dexMedianPriceUsd",
      notes: [],
      capturedAt: "2026-10-19T03:59:00.000Z",
    });
    expect(row.supplyUsd).toBe(200);
  });
});

describe("snapshot asset shape", () => {
  it("keeps issuer and kind and does not turn a failed holder read into zero", () => {
    const row: HolderSnapshotAsset = buildHolderSnapshotAsset({
      asset: { ...asset, issuer: "  " },
      totalSupplyRaw: "nope",
      totalSupplyDecimals: 8,
      totalSupply: null,
      priceUsd: 10,
      holderCount: null,
      supplySource: "evm-rpc:eth_call:totalSupply+decimals",
      holderSource: "geckoterminal:holders.count",
      priceSource: "dexscreener:dexMedianPriceUsd",
      notes: ["missing"],
      capturedAt: "2026-10-08T21:00:00.000Z",
    });
    expect(row.issuer).toBeNull();
    expect(row.totalSupplyRaw).toBeNull();
    expect(row.holderCount).toBeNull();
    expect(row.supplyUsd).toBeNull();
    expect(row.instrumentKind).toBe("equity");
  });
});
