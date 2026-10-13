import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEquityAddressBook, equityChainIdFromNetwork } from "../lending-addresses";
import {
  parseAaveEquitiesHub,
  parseJupiterLend,
  parseKaminoReserveMetrics,
  parseListaBStock,
  parseListaBook,
  morphoEquityBorrowMarketIds,
  parseMorphoMarkets,
  parseVenusMarkets,
  withListaApy,
} from "../lending-parse";
import {
  aggregateLendingTotals,
  buildLendingDeskModel,
  formatLendingApy,
  formatLendingCapturedAt,
  formatLendingEstimateUsd,
  formatLendingFractionPct,
  formatStockBorrowedNote,
  groupLendingRows,
  lendingDayFromCapture,
  lendingHeadline,
  lendingHistoryFromDays,
  lendingHistorySeries,
  lendingLtvExplainer,
  lendingUtilization,
  parseLendingSnapshot,
  serializeLendingSnapshot,
} from "../lending-snapshot";
import { existsSync } from "node:fs";
import { lendingChainLogo, lendingStockLogo, lendingVenueLogo } from "../lending-logos";
import { classifyLendingSymbol, isSmallLendingBook, lendingActionChips, lendingActionLines, lendingBoardRows, lendingChainShareParts, lendingStockGroups } from "../lending-stocks";
import { lendingGlossary } from "../lending-glossary";
import { tokenCountFromRaw } from "../numbers";
import {
  attributeVenusBorrow,
  chooseVenusEstimate,
  collectHolderAddresses,
  missingVenusLogRanges,
  parseVenusHolderCache,
  venusCacheMatches,
  venusCoveredThrough,
  VENUS_CHECKED_ESTIMATE,
  type VenusHolderCache,
} from "../lending-venus-estimate";
import { saveLendingDay, loadLatestLendingSnapshot } from "../lending-snapshot-file";
import { lendingSnapshotDateOverride, parseLendingSnapshotDate, runLendingSnapshotCli } from "../lending-snapshot-job";
import { easternDayKey } from "../volume-snapshots";

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const NVDA = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CBBTC = "cbbtcmint111111111111111111111111111111111";
const FAKE_NVDA = "0x00000000000000000000000000000000000000aa";
const REAL_NVDA = "0x1111111111111111111111111111111111111111";
const USDG = "0x2222222222222222222222222222222222222222";

describe("lending address book", () => {
  it("maps registry networks and keeps wrappers, not nested stablecoins", () => {
    expect(equityChainIdFromNetwork("HyperEVM")).toBe(999);
    expect(equityChainIdFromNetwork("robinhood-chain")).toBe(4663);
    expect(equityChainIdFromNetwork("BinanceSmartChain")).toBe(56);
    expect(equityChainIdFromNetwork("Monad")).toBeNull();
    const book = buildEquityAddressBook({
      xstocksPages: [
        {
          nodes: [
            {
              symbol: "NVDAx",
              deployments: [
                {
                  network: "Solana",
                  address: NVDA,
                  stablecoins: [{ symbol: "USDC", address: USDC }],
                },
                {
                  network: "Ethereum",
                  address: REAL_NVDA,
                  wrapperAddressV2: "0x3333333333333333333333333333333333333333",
                },
                { network: "HyperEVM", address: "0x4444444444444444444444444444444444444444" },
              ],
            },
          ],
          page: { hasNextPage: false },
        },
      ],
      stocksonchain: {
        stocks: [
          {
            listings: [
              { chain: "ethereum", address: REAL_NVDA, issuer: "ondo" },
              { chain: "ethereum", address: FAKE_NVDA, issuer: "noise" },
            ],
          },
        ],
      },
      rhj: {
        assets: [
          {
            tokenSymbol: "NVDA",
            tokenName: "NVIDIA • Robinhood Token",
            deployments: [{ chainId: 4663, contractAddress: "0x5555555555555555555555555555555555555555" }],
          },
        ],
      },
    });
    expect(book.solana.has(NVDA)).toBe(true);
    expect(book.solana.has(USDC)).toBe(false);
    expect(book.evm.get(1)?.has(REAL_NVDA)).toBe(true);
    expect(book.evm.get(1)?.has("0x3333333333333333333333333333333333333333")).toBe(true);
    expect(book.evm.get(999)?.size).toBe(1);
    expect(book.evm.get(4663)?.has("0x5555555555555555555555555555555555555555")).toBe(true);
  });
});

describe("lending parsers", () => {
  it("splits Kamino stock collateral from the stable lend pool and ignores cbBTC", () => {
    const row = parseKaminoReserveMetrics(
      [
        { liquidityToken: "NVDAx", liquidityTokenMint: NVDA, totalSupply: "12.5", totalSupplyUsd: "20000000", totalBorrowUsd: "100000", borrowApy: "0.05" },
        { liquidityToken: "cbBTC", liquidityTokenMint: CBBTC, totalSupplyUsd: "600000", totalBorrowUsd: "0", borrowApy: "0.01" },
        { liquidityToken: "USDC", liquidityTokenMint: USDC, totalSupplyUsd: "5700000", totalBorrowUsd: "5100000", borrowApy: "0.055" },
        { liquidityToken: "USDG", liquidityTokenMint: "usdgmint", totalSupplyUsd: "10000", totalBorrowUsd: "1000", borrowApy: "0.07" },
      ],
      { id: "kamino-xstocks", venue: "Kamino xStocks", equityMints: new Set([NVDA]), source: "kamino" },
    );
    expect(row.collateralUsd).toBe(20_000_000);
    expect(row.stableBorrowedUsd).toBe(5_101_000);
    expect(row.lendSupplyUsd).toBe(5_710_000);
    expect(row.utilization).toBeCloseTo(5_101_000 / 5_710_000, 6);
    expect(row.stockBorrowedUsd).toBe(100_000);
    expect(row.assets?.find((asset) => asset.symbol === "NVDAx")?.collateralTokens).toBe(12.5);
    expect(row.borrowApy).toBeCloseTo(0.055, 3);
    expect(row.chainId).toBe("solana");
  });

  it("keeps a missing Kamino amount missing instead of zero", () => {
    const row = parseKaminoReserveMetrics(
      [
        { liquidityToken: "NVDAx", liquidityTokenMint: NVDA, totalSupplyUsd: null, totalBorrowUsd: "0", borrowApy: "0.05" },
        { liquidityToken: "USDC", liquidityTokenMint: USDC, totalSupplyUsd: "100", totalBorrowUsd: null, borrowApy: "0.05" },
      ],
      { id: "kamino-xstocks", venue: "Kamino xStocks", equityMints: new Set([NVDA]), source: "kamino" },
    );
    expect(row.collateralUsd).toBeNull();
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.stockBorrowedUsd).toBe(0);
    expect(formatStockBorrowedNote(row.stockBorrowedUsd)).toBeNull();
  });

  it("sums Jupiter xStock vaults by mint and uses the shared lend-pool utilization", () => {
    const token = (address: string, symbol: string, decimals: number, price: string) => ({
      address,
      symbol,
      decimals,
      price,
    });
    const row = parseJupiterLend({
      equityMints: new Set([SPY, NVDA]),
      source: "jup",
      vaults: [
        {
          supplyToken: token(SPY, "SPYx", 8, "100"),
          borrowToken: token(USDC, "USDC", 6, "1"),
          totalSupply: String(2 * 1e8),
          totalBorrow: String(50 * 1e6),
          borrowRate: "477",
        },
        {
          supplyToken: token(NVDA, "NVDAx", 8, "200"),
          borrowToken: token("JUPUSD", "JupUSD", 6, "1"),
          totalSupply: String(1 * 1e8),
          totalBorrow: String(40 * 1e6),
          borrowRate: "534",
        },
        {
          supplyToken: token("So11111111111111111111111111111111111111112", "WSOL", 9, "100"),
          borrowToken: token(USDC, "USDC", 6, "1"),
          totalSupply: String(10 * 1e9),
          totalBorrow: String(150 * 1e6),
          borrowRate: "477",
        },
        {
          supplyToken: token("fakexstockmint111111111111111111111111111", "NVDAx", 8, "200"),
          borrowToken: token(USDC, "USDC", 6, "1"),
          totalSupply: String(9 * 1e8),
          totalBorrow: String(9 * 1e6),
          borrowRate: "900",
        },
      ],
      liquidityTokens: [
        {
          asset: token(USDC, "USDC", 6, "1"),
          liquiditySupplyData: { supply: String(250 * 1e6) },
        },
        {
          asset: token("JUPUSD", "JupUSD", 6, "1"),
          liquiditySupplyData: { supply: String(50 * 1e6) },
        },
      ],
    });
    expect(row.collateralUsd).toBe(400);
    expect(row.assets?.find((asset) => asset.symbol === "SPYx")?.collateralTokens).toBe(2);
    expect(row.assets?.find((asset) => asset.symbol === "NVDAx")?.collateralTokens).toBe(1);
    expect(row.stableBorrowedUsd).toBe(90);
    expect(row.lendSupplyUsd).toBeNull();
    // Shared USDC pool includes the SOL vault and the fake mint. JupUSD is 40/50.
    const usdcUtil = 209 / 250;
    expect(row.utilization).toBeCloseTo((usdcUtil * 50 + 0.8 * 40) / 90, 6);
    expect(formatLendingApy(row)).toBe("4.8–5.3%");
  });

  it("matches Morpho collateral by address and drops a same-symbol fake", () => {
    const book = buildEquityAddressBook({});
    book.evm.set(4663, new Set([REAL_NVDA]));
    const row = parseMorphoMarkets(
      [
        market(REAL_NVDA, "NVDA", USDG, "USDG", 1_000_000, 400_000, 400_000, 0.29),
        market(FAKE_NVDA, "NVDA", USDG, "USDG", 9_000_000, 8_000_000, 8_000_000, 0.01),
        market(REAL_NVDA, "NVDA", USDG, "USDG", 100, 10, 10_000, 0.001),
        market(USDG, "USDG", REAL_NVDA, "NVDA", 50, 20, 20, 0.1),
      ],
      { chainId: 4663, book, source: "morpho" },
    );
    expect(row.chainId).toBe("robinhood-chain");
    expect(row.collateralUsd).toBe(1_000_100);
    expect(row.stableBorrowedUsd).toBe(400_010);
    expect(row.lendSupplyUsd).toBe(410_000);
    expect(row.utilization).toBeCloseTo(400_010 / 410_000, 6);
    expect(row.stockBorrowedUsd).toBe(20);
    expect(formatLendingApy(row)).toBe("29.0%");
  });

  it("reads Morpho collateral token counts from raw base units", () => {
    const book = buildEquityAddressBook({});
    book.evm.set(1, new Set([REAL_NVDA]));
    const row = parseMorphoMarkets(
      [
        {
          ...market(REAL_NVDA, "NVDA", USDG, "USDG", 533_001.71, 10, 10, 0.05),
          collateralAsset: { address: REAL_NVDA, symbol: "NVDA", decimals: 18 },
          state: {
            collateralAssets: "679725875423757769262",
            collateralAssetsUsd: 533_001.71,
            borrowAssetsUsd: 10,
            supplyAssetsUsd: 10,
            borrowApy: 0.05,
          },
        },
      ],
      { chainId: 1, book, source: "morpho" },
    );
    expect(row.assets?.[0]?.collateralTokens).toBeCloseTo(679.72587542, 6);
    expect(tokenCountFromRaw("12.5", 18)).toBeNull();
  });

  it("refuses Morpho symbol matching when the verified list is empty", () => {
    const row = parseMorphoMarkets(
      [market(REAL_NVDA, "NVDA", USDG, "USDG", 100, 40, 40, 0.2)],
      { chainId: 1, book: buildEquityAddressBook({}), source: "morpho" },
    );
    expect(row.collateralUsd).toBeNull();
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.error).toMatch(/not matched by symbol/);
  });

  it("reads the Aave equities hub as stock collateral versus USDC borrowed", () => {
    const row = parseAaveEquitiesHub(
      [
        asset("0xb20000000000000000000078ee7ce2fe4908108c", "NVDAc", "1170000", "0", "0", "0", "1827.10293105"),
        asset("0xb200000000000000000000c2e324d24d7eecd1fb", "AAPLc", "500000", "0"),
        asset("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC", "5280000", "1510000", "0.0128", "0.287"),
        asset(FAKE_NVDA, "NVDAc", "9000000", "0"),
      ],
      { equityAddresses: new Set(["0xb20000000000000000000078ee7ce2fe4908108c", "0xb200000000000000000000c2e324d24d7eecd1fb"]), source: "aave" },
    );
    expect(row.collateralUsd).toBe(1_670_000);
    expect(row.stableBorrowedUsd).toBe(1_510_000);
    expect(row.utilization).toBeCloseTo(1_510_000 / 5_280_000, 6);
    expect(row.borrowApy).toBeCloseTo(0.0128, 6);
    expect(row.stockBorrowedUsd).toBe(0);
    expect(formatStockBorrowedNote(0)).toBeNull();
    expect(row.assets?.find((item) => item.symbol === "NVDAc")?.collateralTokens).toBeCloseTo(1827.10293105, 6);
    expect(row.assets?.find((item) => item.symbol === "AAPLc")?.collateralTokens).toBeNull();
    expect(row.assets?.find((item) => item.symbol === "NVDAc")?.maxLtv).toBeNull();
  });

  it("reads Aave collateral factor as the borrowing limit", () => {
    const priced = asset("0xb20000000000000000000078ee7ce2fe4908108c", "NVDAc", "100", "0");
    const row = parseAaveEquitiesHub(
      [{ ...priced, collateralFactor: { value: "0.7000", normalized: "70.0000" } }],
      { equityAddresses: new Set(["0xb20000000000000000000078ee7ce2fe4908108c"]), source: "aave" },
    );
    expect(row.assets?.[0]?.maxLtv).toBeCloseTo(0.7, 6);
    const equityBook = buildEquityAddressBook({
      xstocksPages: [{ nodes: [{ symbol: "NVDAx", deployments: [{ network: "Ethereum", address: REAL_NVDA }] }] }],
    });
    const listed = morphoEquityBorrowMarketIds(
      [{ ...market(REAL_NVDA, "NVDA", USDG, "USDG", 100, 40, 40, 0.2), marketId: "0xabc" }],
      { chainId: 1, book: equityBook },
    );
    expect(listed?.ids).toEqual(["0xabc"]);
    expect(listed?.incomplete).toBe(false);
    const missing = morphoEquityBorrowMarketIds(
      [market(REAL_NVDA, "NVDA", USDG, "USDG", 100, 40, 40, 0.2)],
      { chainId: 1, book: equityBook },
    );
    expect(missing?.incomplete).toBe(true);
  });

  it("reads Venus bStocks in cents and does not invent stable borrows", () => {
    const row = parseVenusMarkets(
      {
        result: [
          { category: "bstocks", underlyingSymbol: "NVDAB", totalSupplyUnderlyingCents: "34367200", totalBorrowCents: "0" },
          { category: "bstocks", underlyingSymbol: "TSLAB", totalSupplyUnderlyingCents: "3115000", totalBorrowCents: null },
          { category: "stablecoins", underlyingSymbol: "USDT", totalSupplyUnderlyingCents: "10000000000", totalBorrowCents: "8000000000" },
        ],
      },
      "venus",
    );
    expect(row.collateralUsd).toBeCloseTo(374_822, 6);
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.borrowApy).toBeNull();
    expect(row.stockBorrowedUsd).toBe(0);
  });

  it("reads Lista bStock totals and a borrow-weighted APY", () => {
    const row = withListaApy(
      parseListaBStock(
        { data: { bStock: { totalCollateral: "78010.83", totalBorrowed: "38960.44", totalAvailable: "14341.75" } } },
        "lista",
      ),
      [
        { loan: "USDT", rate: "0.02", totalBorrowAsset: "30" },
        { loan: "USDC", rate: "0.04", totalBorrowAsset: "10" },
        { loan: "WBNB", rate: "0.5", totalBorrowAsset: "100" },
      ],
    );
    expect(row.collateralUsd).toBeCloseTo(78010.83, 2);
    expect(row.stableBorrowedUsd).toBeCloseTo(38960.44, 2);
    expect(row.utilization).toBeCloseTo(38960.44 / (38960.44 + 14341.75), 6);
    expect(row.borrowApy).toBeCloseTo(0.025, 6);
  });

  it("keeps Lista zone-5 collateral and treats a bStock loan as shorting, not collateral", () => {
    const stock = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
    const usdt = "0x55d398326f99059ff775485246999027b3197955";
    const spy = "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8";
    const row = parseListaBook({
      source: "lista",
      overall: {
        data: {
          bStock: {
            totalCollateral: "7801097",
            totalBorrowed: "3899635",
            totalAvailable: "1435054",
            topCollateralTokens: [
              { tokenAddress: spy, tokenSymbol: "SPYB", collateralUsd: "1794472" },
              { tokenAddress: stock, tokenSymbol: "NVDAB", collateralUsd: "707185" },
            ],
          },
        },
      },
      markets: [
        {
          id: "0xaaa",
          zone: 5,
          chain: "bsc",
          collateralToken: spy,
          loanToken: usdt,
          lltv: "850000000000000000",
          totalBorrowAssets: "100",
        },
        {
          id: "0xbbb",
          zone: 5,
          chain: "bsc",
          collateralToken: stock,
          loanToken: usdt,
          lltv: "750000000000000000",
          totalBorrowAssets: "50",
        },
        {
          id: "0x717ccd0f7a90a358cb18183e05a161fdc6e58416eeb8f663345aaedbe9ef4ac5",
          zone: 0,
          chain: "bsc",
          collateralToken: usdt,
          loanToken: stock,
          lltv: "700000000000000000",
          totalBorrowAssets: "338571520375712366231",
        },
        {
          id: "0xother",
          zone: 0,
          chain: "bsc",
          collateralToken: usdt,
          loanToken: "0x1111111111111111111111111111111111111111",
          lltv: "800000000000000000",
          totalBorrowAssets: "999000000000000000000",
        },
      ],
      loanPrices: new Map([["0x717ccd0f7a90a358cb18183e05a161fdc6e58416eeb8f663345aaedbe9ef4ac5", 232.39589378]]),
      rates: [
        { apy: 0.02, weight: 100 },
        { apy: 0.04, weight: 50 },
      ],
    });
    expect(row.collateralUsd).toBeCloseTo(7_801_097, 0);
    expect(row.stableBorrowedUsd).toBeCloseTo(3_899_635, 0);
    expect(row.utilization).toBeCloseTo(3_899_635 / (3_899_635 + 1_435_054), 4);
    expect(row.stockBorrowedUsd).toBeCloseTo(338.571520375712366231 * 232.39589378, 0);
    expect(row.assets?.map((asset) => asset.symbol)).toEqual(["SPYB", "NVDAB"]);
    expect(row.assets?.[0]?.maxLtv).toBeCloseTo(0.85, 6);
    expect(row.assets?.[1]?.collateralUsd).toBeCloseTo(707_185, 0);
    expect(row.borrowApy).toBeCloseTo((0.02 * 100 + 0.04 * 50) / 150, 6);
    expect(row.note).toBeNull();
  });

  it("blanks Lista totals when a zone-5 token is not on the bStock beacon", () => {
    const stock = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
    const stranger = "0x9999999999999999999999999999999999999999";
    const row = parseListaBook({
      source: "lista",
      overall: { data: { bStock: { totalCollateral: "7801097", totalBorrowed: "3899635", totalAvailable: "1" } } },
      markets: [
        { id: "0x1", zone: 5, chain: "bsc", collateralToken: stock, loanToken: "0x55d398326f99059ff775485246999027b3197955", lltv: "0.75", totalBorrowAssets: "1" },
        { id: "0x2", zone: 5, chain: "bsc", collateralToken: stranger, loanToken: "0x55d398326f99059ff775485246999027b3197955", lltv: "0.5", totalBorrowAssets: "1" },
      ],
      rejectedCollateral: new Set([stranger]),
    });
    expect(row.collateralUsd).toBeNull();
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.assets?.map((asset) => asset.address)).toEqual([stock]);
    expect(row.note).toMatch(/not on the bStock beacon/);
  });

  it("reads a Jupiter collateral factor as max LTV in thousandths", () => {
    const row = parseJupiterLend({
      equityMints: new Set([NVDA]),
      source: "jup",
      vaults: [
        {
          supplyToken: { address: NVDA, symbol: "NVDAx", decimals: 8, price: "200" },
          borrowToken: { address: USDC, symbol: "USDC", decimals: 6, price: "1" },
          totalSupply: String(1 * 1e8),
          totalBorrow: String(10 * 1e6),
          borrowRate: "477",
          collateralFactor: "650",
        },
      ],
      liquidityTokens: [],
    });
    expect(row.assets?.[0]?.maxLtv).toBeCloseTo(0.65, 6);
    expect(row.assets?.[0]?.symbol).toBe("NVDAx");
  });

  it("keeps Venus utilization blank and labels the shared-pool borrow as an estimate", () => {
    const nvda = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436";
    const skh = "0x00000000000000000000000000000000000000ab";
    const row = parseVenusMarkets(
      {
        result: [
          { category: "bstocks", underlyingSymbol: "NVDAB", underlyingAddress: nvda, totalSupplyUnderlyingCents: "34400000", totalBorrowCents: "0", collateralFactorMantissa: "600000000000000000" },
          { category: "bstocks", underlyingSymbol: "SKHYB", underlyingAddress: skh, totalSupplyUnderlyingCents: "5800000", totalBorrowCents: "0", collateralFactorMantissa: "500000000000000000" },
          { category: "bstocks", underlyingSymbol: "FAKEB", underlyingAddress: "0x00000000000000000000000000000000000000ff", totalSupplyUnderlyingCents: "900000000", totalBorrowCents: "0", collateralFactorMantissa: "800000000000000000" },
          { category: "stablecoins", underlyingSymbol: "USDT", underlyingAddress: "0x55d398326f99059ff775485246999027b3197955", totalSupplyUnderlyingCents: "100", totalBorrowCents: "80" },
        ],
      },
      "venus",
      {
        equityAddresses: new Set([nvda, skh]),
        estimate: {
          usd: 255_389.46,
          lowerBoundUsd: 195_590.93,
          method: "pro-rata test",
          asOf: "2026-10-09T02:20:00.000Z",
        },
      },
    );
    expect(row.collateralUsd).toBeCloseTo(402_000, 6);
    expect(row.assets?.map((asset) => asset.symbol)).toEqual(["NVDAB", "SKHYB"]);
    expect(row.assets?.[1]?.maxLtv).toBeCloseTo(0.5, 6);
    expect(row.stableBorrowedUsd).toBeCloseTo(255_389.46, 2);
    expect(row.utilization).toBeNull();
    expect(row.borrowApy).toBeNull();
    expect(formatLendingApy(row)).toBe("—");
    expect(formatLendingEstimateUsd(row.stableBorrowedUsd)).toBe("~$0.26M");
    expect(row.borrowEstimate?.lowerBoundUsd).toBeCloseTo(195_590.93, 2);
    expect(row.note).toMatch(/estimate/);
    expect(row.note).toMatch(/\$195\.6K/);
  });

  it("counts Venus underlying tokens from cash, borrows, and reserves", () => {
    const row = parseVenusMarkets(
      {
        result: [
          {
            category: "bstocks",
            underlyingSymbol: "SKHYB",
            underlyingAddress: "0x00000000000000000000000000000000000000ab",
            totalSupplyUnderlyingCents: "5909412",
            totalBorrowCents: "0",
            cashMantissa: "341567365943742812233",
            totalBorrowsMantissa: "1000000000000000000",
            totalReservesMantissa: "0",
            underlyingDecimal: 18,
          },
        ],
      },
      "venus",
    );
    expect(row.assets?.[0]?.collateralTokens).toBeCloseTo(342.56736594, 6);
    expect(row.assets?.[0]?.collateralUsd).toBeCloseTo(59_094.12, 2);
  });

  it("prices Lista long-tail collateral from a quote and keeps the headline total", () => {
    const spy = "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8";
    const apple = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
    const quiet = "0x2222222222222222222222222222222222222222";
    const row = parseListaBook({
      source: "lista",
      overall: {
        data: {
          bStock: {
            totalCollateral: "7801097",
            totalBorrowed: "3899635",
            totalAvailable: "1",
            topCollateralTokens: [{ tokenAddress: spy, tokenSymbol: "SPYB", collateralUsd: "1794472" }],
          },
        },
      },
      markets: [
        { id: "0x1", zone: 5, chain: "bsc", collateralToken: spy, loanToken: "0x55d398326f99059ff775485246999027b3197955", lltv: "0.85", totalBorrowAssets: "1" },
        { id: "0x2", zone: 5, chain: "bsc", collateralToken: apple, loanToken: "0x55d398326f99059ff775485246999027b3197955", lltv: "0.75", totalBorrowAssets: "1" },
        { id: "0x3", zone: 5, chain: "bsc", collateralToken: quiet, loanToken: "0x55d398326f99059ff775485246999027b3197955", lltv: "0.5", totalBorrowAssets: "0" },
      ],
      quotes: new Map([
        [spy, { tokens: 2311.51654, usd: 1_700_000, note: null }],
        [apple, { tokens: 1.16672, usd: 29.48, note: null }],
        [quiet, { tokens: 4, usd: null, note: "Lista did not publish a price for this token." }],
      ]),
    });
    expect(row.collateralUsd).toBe(7_801_097);
    expect(row.assets?.find((asset) => asset.symbol === "SPYB")).toMatchObject({ collateralUsd: 1_794_472, collateralTokens: 2311.51654, priceNote: null });
    expect(row.assets?.find((asset) => asset.symbol === "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a")?.collateralUsd).toBeCloseTo(29.48, 2);
    const unpriced = row.assets?.find((asset) => asset.address === quiet);
    expect(unpriced?.collateralUsd).toBeNull();
    expect(unpriced?.collateralTokens).toBe(4);
    expect(unpriced?.priceNote).toMatch(/did not publish a price/);
  });
});

describe("lending aggregation", () => {
  it("sums reported rows, leaves an all-missing total missing, and keys the Eastern day", () => {
    const capturedAt = Date.parse("2026-10-09T01:20:00.000Z");
    expect(easternDayKey(capturedAt / 1000)).toBe("2026-10-08");
    const kamino = parseKaminoReserveMetrics(
      [
        { liquidityToken: "NVDAx", liquidityTokenMint: NVDA, totalSupplyUsd: "100", totalBorrowUsd: "1", borrowApy: "0.05" },
        { liquidityToken: "USDC", liquidityTokenMint: USDC, totalSupplyUsd: "50", totalBorrowUsd: "45", borrowApy: "0.09" },
      ],
      { id: "kamino-xstocks", venue: "Kamino xStocks", equityMints: new Set([NVDA]), source: "kamino" },
    );
    const missing = parseVenusMarkets(null, "venus");
    const day = lendingDayFromCapture(capturedAt, [kamino, missing], []);
    expect(day.date).toBe("2026-10-08");
    const totals = aggregateLendingTotals(day.rows);
    expect(totals.collateralUsd).toBe(100);
    expect(totals.stableBorrowedUsd).toBe(45);
    expect(totals.utilization).toBeCloseTo(0.9, 6);
    expect(aggregateLendingTotals([missing]).collateralUsd).toBeNull();
    expect(aggregateLendingTotals([missing]).stableBorrowedUsd).toBeNull();
    expect(lendingUtilization(10, null)).toBeNull();
    expect(lendingUtilization(null, 10)).toBeNull();
    const groups = groupLendingRows(day.rows);
    expect(groups.map((group) => group.chainId)).toEqual(["solana", "bnb"]);
    const model = buildLendingDeskModel(parseLendingSnapshot(JSON.parse(serializeLendingSnapshot(day))));
    expect(model.date).toBe("2026-10-08");
    expect(model.totals.collateralUsd).toBe(100);
    expect(formatLendingCapturedAt(day.capturedAt)).toMatch(/Oct 8, 2026/);
    expect(formatLendingCapturedAt(day.capturedAt)).toMatch(/E[DS]T$/);
    expect(formatLendingFractionPct(null)).toBe("—");
    expect(formatLendingApy(missing)).toBe("—");
    const shared = {
      ...kamino,
      id: "jupiter-lend",
      venue: "Jupiter Lend",
      collateralUsd: 80,
      stableBorrowedUsd: 40,
      lendSupplyUsd: null,
      utilization: 0.8,
      borrowApy: 0.05,
      borrowApyMin: 0.05,
      borrowApyMax: 0.05,
    };
    const mixed = aggregateLendingTotals([kamino, shared]);
    expect(mixed.utilization).toBeCloseTo((0.9 * 45 + 0.8 * 40) / 85, 6);
    expect(mixed.collateralUsd).toBe(180);
    const estimateRow = parseVenusMarkets(
      { result: [{ category: "bstocks", underlyingSymbol: "NVDAB", underlyingAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", totalSupplyUnderlyingCents: "10000", totalBorrowCents: "0", collateralFactorMantissa: "600000000000000000" }] },
      "venus",
      { estimate: { usd: 250, lowerBoundUsd: 200, method: "pro-rata", asOf: "2026-10-09T02:20:00.000Z" } },
    );
    const withEstimate = aggregateLendingTotals([kamino, estimateRow]);
    expect(withEstimate.stableBorrowedUsd).toBe(45 + 250);
    expect(withEstimate.utilization).toBeCloseTo(0.9, 6);
    const dust = {
      ...kamino,
      id: "morpho-base",
      stableBorrowedUsd: 1,
      borrowApy: 0.9,
      borrowApyMin: 0.001,
      borrowApyMax: 0.9,
    };
    const desk = aggregateLendingTotals([kamino, dust]);
    expect(desk.borrowApyMin).toBeCloseTo(kamino.borrowApyMin ?? 0, 6);
    expect(desk.borrowApyMax).toBeCloseTo(kamino.borrowApyMax ?? 0, 6);
    expect(lendingHeadline([kamino], desk).costSentence).toMatch(/typical loan costs about/);
    const headline = lendingHeadline([kamino, estimateRow], withEstimate);
    expect(headline.collateralSentence).toMatch(/locked/);
    expect(headline.borrowedSentence).toMatch(/Venus estimate/);
    expect(headline.fullSentence).toMatch(/Venus is left out/);
    expect(lendingLtvExplainer([estimateRow])).toBe("You can borrow up to $60 for every $100 of stock. That limit is called LTV.");
    expect(lendingLtvExplainer([missing])).toMatch(/does not|Each token has a limit/);
    const history = lendingHistoryFromDays([
      lendingDayFromCapture(Date.parse("2026-10-09T01:20:00.000Z"), [kamino], []),
    ]);
    expect(history).toHaveLength(1);
    expect(history[0]?.collateralUsd).toBe(100);
    expect(history[0]?.stableBorrowedUsd).toBe(45);
    expect(lendingHistorySeries(history).kind).toBe("single");
    expect(lendingHistorySeries([]).kind).toBe("empty");
    const second = lendingDayFromCapture(Date.parse("2026-10-10T01:20:00.000Z"), [kamino], []);
    expect(lendingHistorySeries(lendingHistoryFromDays([second, ...history.map(() => second)])).kind).toBe("line");
    const twoDays = lendingHistorySeries([
      history[0] ?? { date: "2026-10-08", capturedAt: "", collateralUsd: 100, stableBorrowedUsd: 45 },
      { date: "2026-10-09", capturedAt: "", collateralUsd: 110, stableBorrowedUsd: 40 },
    ]);
    expect(twoDays.kind).toBe("line");
    const attributed = attributeVenusBorrow([
      { borrowUsd: 100, bstockBorrowPowerUsd: 50, totalBorrowPowerUsd: 100 },
      { borrowUsd: 40, bstockBorrowPowerUsd: 40, totalBorrowPowerUsd: 40 },
    ]);
    expect(attributed?.estimateUsd).toBeCloseTo(90, 6);
    expect(attributed?.lowerBoundUsd).toBeCloseTo(40, 6);
    expect(attributed?.onlyBstockAccounts).toBe(1);
    expect(attributeVenusBorrow([])).toBeNull();
    expect(formatLendingEstimateUsd(null)).toBe("—");
    const roundTrip = parseLendingSnapshot(JSON.parse(serializeLendingSnapshot(lendingDayFromCapture(capturedAt, [estimateRow], []))));
    expect(roundTrip?.rows[0]?.borrowEstimate?.method).toBe("pro-rata");
    expect(roundTrip?.rows[0]?.assets?.[0]?.symbol).toBe("NVDAB");
  });

  it("writes one Eastern-day file and stays quiet when amounts exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lending-"));
    const logs: string[] = [];
    const errors: string[] = [];
    const day = lendingDayFromCapture(
      Date.parse("2026-10-09T01:20:00.000Z"),
      [
        {
          id: "kamino-xstocks",
          venue: "Kamino xStocks",
          chainId: "solana",
          chainLabel: "Solana",
          collateralUsd: 10,
          stableBorrowedUsd: 4,
          lendSupplyUsd: 5,
          utilization: 0.8,
          borrowApy: 0.05,
          borrowApyMin: 0.05,
          borrowApyMax: 0.05,
          stockBorrowedUsd: null,
          source: "test",
          error: null,
        },
      ],
      [],
    );
    const code = await runLendingSnapshotCli({
      capture: async () => day,
      save: async (next) => {
        await saveLendingDay(next, dir);
      },
      error: (message) => errors.push(message),
    });
    expect(code).toBe(0);
    expect(logs).toEqual([]);
    expect(errors).toEqual([]);
    const saved = await loadLatestLendingSnapshot(dir);
    expect(saved.day?.date).toBe("2026-10-08");
    expect(await readFile(join(dir, "2026-10-08.json"), "utf8")).toContain("equity-lending-v1");
    const failed = await runLendingSnapshotCli({
      capture: async () => lendingDayFromCapture(Date.parse("2026-10-09T01:20:00.000Z"), [], [{ source: "Kamino", message: "down" }]),
      save: async () => {
        throw new Error("should not write");
      },
      error: (message) => errors.push(message),
    });
    expect(failed).toBe(1);
    expect(errors[0]).toMatch(/no amounts/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("LENDING_SNAPSHOT_DATE", () => {
  const row = {
    id: "kamino-xstocks",
    venue: "Kamino xStocks",
    chainId: "solana",
    chainLabel: "Solana",
    collateralUsd: 10,
    stableBorrowedUsd: 4,
    lendSupplyUsd: 5,
    utilization: 0.8,
    borrowApy: 0.05,
    borrowApyMin: 0.05,
    borrowApyMax: 0.05,
    stockBorrowedUsd: null,
    source: "test",
    error: null,
  };

  it("accepts a real YYYY-MM-DD, and the lending key wins over SNAPSHOT_DATE", () => {
    expect(parseLendingSnapshotDate(" 2026-10-10 ")).toBe("2026-10-10");
    expect(parseLendingSnapshotDate("2024-02-29")).toBe("2024-02-29");
    expect(lendingSnapshotDateOverride({ LENDING_SNAPSHOT_DATE: "2026-10-10", SNAPSHOT_DATE: "2026-10-09" })).toBe("2026-10-10");
    expect(lendingSnapshotDateOverride({ LENDING_SNAPSHOT_DATE: "  ", SNAPSHOT_DATE: " 2026-10-09 " })).toBe("2026-10-09");
    expect(lendingSnapshotDateOverride({ LENDING_SNAPSHOT_DATE: "", SNAPSHOT_DATE: "" })).toBeNull();
    expect(lendingSnapshotDateOverride({})).toBeNull();
  });

  it("refuses a non-date and an impossible calendar day", () => {
    expect(() => parseLendingSnapshotDate("2026-10-10T00")).toThrow(/YYYY-MM-DD/);
    expect(() => parseLendingSnapshotDate("20261010")).toThrow(/YYYY-MM-DD/);
    expect(() => lendingSnapshotDateOverride({ LENDING_SNAPSHOT_DATE: "nope", SNAPSHOT_DATE: "2026-10-10" })).toThrow(/YYYY-MM-DD/);
    expect(() => lendingSnapshotDateOverride({ LENDING_SNAPSHOT_DATE: "2026-02-31" })).toThrow(/real YYYY-MM-DD/);
    expect(() => lendingSnapshotDateOverride({ SNAPSHOT_DATE: "2026-02-29" })).toThrow(/real YYYY-MM-DD/);
  });

  it("pins the file key and leaves capturedAt on the real instant", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lending-pin-"));
    const capturedAt = "2026-10-11T04:12:00.000Z";
    const day = lendingDayFromCapture(Date.parse(capturedAt), [row], []);
    expect(day.date).toBe("2026-10-11");
    const errors: string[] = [];
    const code = await runLendingSnapshotCli({
      env: { LENDING_SNAPSHOT_DATE: "2026-10-10" },
      capture: async () => day,
      save: async (next) => {
        await saveLendingDay(next, dir);
      },
      error: (message) => errors.push(message),
    });
    expect(code).toBe(0);
    expect(errors).toEqual([]);
    const saved = await loadLatestLendingSnapshot(dir);
    expect(saved.day?.date).toBe("2026-10-10");
    expect(saved.day?.capturedAt).toBe(capturedAt);
    expect(await readFile(join(dir, "2026-10-10.json"), "utf8")).toContain(capturedAt);
    await expect(readFile(join(dir, "2026-10-11.json"), "utf8")).rejects.toThrow();

    let captured = false;
    const refused = await runLendingSnapshotCli({
      env: { LENDING_SNAPSHOT_DATE: "2026-02-31" },
      capture: async () => {
        captured = true;
        return day;
      },
      save: async () => {
        throw new Error("should not write");
      },
      error: (message) => errors.push(message),
    });
    expect(refused).toBe(1);
    expect(captured).toBe(false);
    expect(errors[0]).toMatch(/real YYYY-MM-DD/);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("lending board rows", () => {
  it("keeps each token's dollars and marks only tiny books as small", () => {
    const rows = lendingBoardRows([
      {
        id: "kamino",
        venue: "Kamino",
        chainId: "solana",
        chainLabel: "Solana",
        utilization: 0.8,
        borrowApy: 0.05,
        borrowApyMin: null,
        borrowApyMax: null,
        collateralUsd: 1_000_000,
        stableBorrowedUsd: 400_000,
        stockBorrowedUsd: null,
        source: "https://kamino.com",
        borrowEstimate: null,
        assets: [{ symbol: "NVDAx", address: "nvda", collateralUsd: 250_000, collateralTokens: null, maxLtv: 0.55 }],
      },
      {
        id: "hyper",
        venue: "Morpho",
        chainId: "hyperevm",
        chainLabel: "HyperEVM",
        utilization: null,
        borrowApy: null,
        borrowApyMin: null,
        borrowApyMax: null,
        collateralUsd: 28,
        stableBorrowedUsd: 0,
        stockBorrowedUsd: null,
        source: "https://morpho.org",
        borrowEstimate: null,
        assets: [{ symbol: "NVDAon", address: "nvda-on", collateralUsd: 28, collateralTokens: null, maxLtv: null }],
      },
    ]);

    expect(rows.map((row) => [row.ticker, row.wrapper, row.collateralUsd, row.smallBook])).toEqual([
      ["NVDA", "xStocks", 250_000, false],
      ["NVDA", "Ondo", 28, true],
    ]);
    expect(isSmallLendingBook(null, null)).toBe(false);
    expect(isSmallLendingBook(28, 0)).toBe(true);
    const share = lendingChainShareParts([
      { chainId: "solana", chainLabel: "Solana", collateralUsd: 39_000_000 },
      { chainId: "hyperevm", chainLabel: "HyperEVM", collateralUsd: 27.9 },
    ]);
    expect(share.main.map((chain) => chain.chainLabel)).toEqual(["Solana"]);
    expect(share.smallerUsd).toBe(27.9);
    expect(lendingChainLogo("solana")).toBe("/lending-logos/chains/solana.png");
    expect(lendingChainLogo("robinhood-chain")).toBe("/lending-logos/chains/robinhood.png");
    expect(lendingVenueLogo("kamino-xstocks")).toBe("/lending-logos/venues/kamino.png");
    expect(lendingStockLogo("not-a-mint", "NVDA")).toBe("/lending-logos/tickers/NVDA.png");
    expect(lendingStockLogo("not-a-mint", "SPCX")).toBeNull();
    expect(existsSync("public/lending-logos/chains/solana.png")).toBe(true);
    expect(existsSync("public/lending-logos/chains/robinhood.png")).toBe(true);
    expect(existsSync("public/lending-logos/tickers/NVDA.png")).toBe(true);
  });
});

describe("lending stock view", () => {
  it("groups issuer wrappers under one ticker and leaves unnamed symbols alone", () => {
    expect(classifyLendingSymbol("NVDAx", "solana")).toEqual({ ticker: "NVDA", wrapper: "xStocks" });
    expect(classifyLendingSymbol("wNVDAx", "ethereum")).toEqual({ ticker: "NVDA", wrapper: "xStocks" });
    expect(classifyLendingSymbol("NVDAc", "base")).toEqual({ ticker: "NVDA", wrapper: "Coinbase" });
    expect(classifyLendingSymbol("NVDAB", "bnb")).toEqual({ ticker: "NVDA", wrapper: "bStocks" });
    expect(classifyLendingSymbol("TSLAon", "ethereum")).toEqual({ ticker: "TSLA", wrapper: "Ondo" });
    expect(classifyLendingSymbol("NVDA", "robinhood-chain")).toEqual({ ticker: "NVDA", wrapper: "Robinhood" });
    expect(classifyLendingSymbol("SPCX", "robinhood-chain").ticker).toBe("SPCX");
    expect(classifyLendingSymbol("SPCXB", "bnb")).toEqual({ ticker: "SPCX", wrapper: "bStocks" });
    expect(classifyLendingSymbol("deSPXA", "base")).toEqual({ ticker: "SPXA", wrapper: "Centrifuge" });
    expect(classifyLendingSymbol("wbCOIN", "base").wrapper).toBe("Not named");

    const groups = lendingStockGroups([
      {
        id: "kamino-xstocks",
        venue: "Kamino xStocks",
        chainId: "solana",
        chainLabel: "Solana",
        borrowApy: 0.055,
        borrowApyMin: 0.055,
        borrowApyMax: 0.055,
        borrowEstimate: null,
        assets: [{ symbol: "NVDAx", address: "a", collateralUsd: 100, collateralTokens: null, maxLtv: 0.55 }],
      },
      {
        id: "lista-bnb",
        venue: "Lista",
        chainId: "bnb",
        chainLabel: "BNB",
        borrowApy: 0.013,
        borrowApyMin: 0.006,
        borrowApyMax: 0.02,
        borrowEstimate: null,
        assets: [{ symbol: "NVDAB", address: "b", collateralUsd: null, collateralTokens: null, maxLtv: 0.75 }],
      },
      {
        id: "aave",
        venue: "Aave",
        chainId: "base",
        chainLabel: "Base",
        borrowApy: 0.013,
        borrowApyMin: 0.013,
        borrowApyMax: 0.013,
        borrowEstimate: null,
        assets: [{ symbol: "NVDAc", address: "c", collateralUsd: 40, collateralTokens: null, maxLtv: null }],
      },
    ]);
    const nvda = groups.find((group) => group.ticker === "NVDA");
    expect(nvda?.places.map((place) => place.wrapper).sort()).toEqual(["Coinbase", "bStocks", "xStocks"]);
    expect(nvda?.collateralUsd).toBe(140);
    expect(nvda?.unpricedPlaces).toBe(1);
    expect(nvda?.places.find((place) => place.wrapper === "Coinbase")?.maxLtv).toBeNull();
    expect(nvda?.places.find((place) => place.wrapper === "bStocks")?.collateralUsd).toBeNull();
    expect(lendingGlossary("oracle").text).toMatch(/price feed/);
    expect(lendingGlossary("wrapper").text).toMatch(/xStocks/);
  });

  it("writes where's-the-action lines from the numbers and skips a dust pool", () => {
    const lines = lendingActionLines([
      {
        venue: "Kamino xStocks",
        chainLabel: "Solana",
        utilization: 0.9,
        stableBorrowedUsd: 5_000_000,
        borrowApy: 0.055,
        borrowApyMin: 0.055,
        borrowApyMax: 0.055,
        stockBorrowedUsd: 222_000,
        borrowEstimate: null,
        assets: [{ symbol: "SPYx", address: "a", collateralUsd: 4_000_000, collateralTokens: null, maxLtv: 0.7 }],
      },
      {
        venue: "Aave",
        chainLabel: "Base",
        utilization: 0.28,
        stableBorrowedUsd: 1_500_000,
        borrowApy: 0.013,
        borrowApyMin: 0.013,
        borrowApyMax: 0.013,
        stockBorrowedUsd: 0,
        borrowEstimate: null,
        assets: [],
      },
      {
        venue: "Morpho",
        chainLabel: "Robinhood Chain",
        utilization: 0.76,
        stableBorrowedUsd: 1_600_000,
        borrowApy: 0.23,
        borrowApyMin: 0.19,
        borrowApyMax: 0.29,
        stockBorrowedUsd: 0,
        borrowEstimate: null,
        assets: [],
      },
      {
        venue: "Tiny",
        chainLabel: "HyperEVM",
        utilization: 0.99,
        stableBorrowedUsd: 11,
        borrowApy: 0.08,
        borrowApyMin: 0.08,
        borrowApyMax: 0.08,
        stockBorrowedUsd: 0,
        borrowEstimate: null,
        assets: [],
      },
    ]);
    const text = lines.join(" ");
    expect(text).toMatch(/Kamino xStocks on Solana is 90\.0% full/);
    expect(text).toMatch(/Cheap pools with room: Aave on Base is 28\.0% full/);
    expect(text).toMatch(/Morpho on Robinhood Chain costs 19\.0–29\.0%/);
    expect(text).toMatch(/Stocks lent for shorting: Kamino xStocks/);
    expect(text).toMatch(/SPYx on Kamino xStocks/);
    expect(text).not.toMatch(/Tiny/);
    const chips = lendingActionChips([
      {
        venue: "Kamino xStocks",
        chainLabel: "Solana",
        utilization: 0.9,
        stableBorrowedUsd: 5_000_000,
        borrowApy: 0.055,
        borrowApyMin: 0.055,
        borrowApyMax: 0.055,
        stockBorrowedUsd: 222_000,
        borrowEstimate: null,
        assets: [{ symbol: "SPYx", address: "a", collateralUsd: 4_000_000, collateralTokens: null, maxLtv: 0.7 }],
      },
      {
        venue: "Tiny",
        chainLabel: "HyperEVM",
        utilization: 0.99,
        stableBorrowedUsd: 11,
        borrowApy: 0.08,
        borrowApyMin: 0.08,
        borrowApyMax: 0.08,
        stockBorrowedUsd: 0,
        borrowEstimate: null,
        assets: [],
      },
    ]);
    expect(chips.map((chip) => chip.label)).toContain("Nearly full");
    expect(chips.map((chip) => chip.label)).not.toContain("Tiny");
    expect(chips.some((chip) => chip.text.includes("Tiny"))).toBe(false);
  });
});

describe("venus log scan", () => {
  const holder = `0x${"11".repeat(20)}`;

  function logFor(address: string) {
    return { topics: [`0x${"ab".repeat(32)}`, `0x${address.slice(2).padStart(64, "0")}`] };
  }

  it("retries a dropped response and then keeps the logs", async () => {
    let calls = 0;
    const holders = await collectHolderAddresses({
      vTokens: ["0xv"],
      startBlock: 0,
      endBlock: 10,
      initialSpan: 100,
      minSpan: 5,
      deadlineMs: 10_000,
      now: () => 0,
      sleep: async () => undefined,
      attempts: 3,
      getLogs: async () => {
        calls += 1;
        if (calls === 1) throw new Error("header not found");
        return [logFor(holder)];
      },
    });
    expect(calls).toBe(2);
    expect(holders.has(holder)).toBe(true);
  });

  it("splits a range that keeps failing into smaller ranges", async () => {
    const seen: string[] = [];
    const holders = await collectHolderAddresses({
      vTokens: ["0xv"],
      startBlock: 0,
      endBlock: 99,
      initialSpan: 100,
      minSpan: 40,
      deadlineMs: 10_000,
      now: () => 0,
      sleep: async () => undefined,
      attempts: 1,
      concurrency: 1,
      getLogs: async (range) => {
        seen.push(`${range.fromBlock}-${range.toBlock}`);
        if (range.toBlock - range.fromBlock > 60) throw new Error("header not found");
        return [logFor(holder)];
      },
    });
    expect(seen).toEqual(["0-99", "0-49", "50-99"]);
    expect(holders.has(holder)).toBe(true);
  });

  it("stops when the time budget is already spent", async () => {
    let calls = 0;
    await expect(
      collectHolderAddresses({
        vTokens: ["0xv"],
        startBlock: 0,
        endBlock: 10,
        initialSpan: 100,
        minSpan: 5,
        deadlineMs: 100,
        now: () => 100,
        sleep: async () => undefined,
        getLogs: async () => {
          calls += 1;
          return [];
        },
      }),
    ).rejects.toThrow(/ran out of time/);
    expect(calls).toBe(0);
  });

  it("keeps the last good estimate and its original timestamp", () => {
    const previous = {
      usd: 1234,
      lowerBoundUsd: 900,
      method: "Pro-rata from onchain balances at BSC block 1.",
      asOf: "2026-10-08T18:00:00.000Z",
      block: 1,
    };
    const kept = chooseVenusEstimate(null, previous, VENUS_CHECKED_ESTIMATE);
    expect(kept.usd).toBe(1234);
    expect(kept.asOf).toBe("2026-10-08T18:00:00.000Z");
    expect(kept.method).toMatch(/did not refresh/);
    expect(kept.stale).toBe(true);
    const live = { ...previous, usd: 2000, asOf: "2026-10-09T03:00:00.000Z" };
    expect(chooseVenusEstimate(live, previous, VENUS_CHECKED_ESTIMATE)).toEqual({ ...live, stale: false });
    const checked = chooseVenusEstimate(null, null, VENUS_CHECKED_ESTIMATE);
    expect(checked.asOf).toBe(VENUS_CHECKED_ESTIMATE.asOf);
    expect(checked.stale).toBe(true);
  });

  it("resumes a Venus log cache from the contiguous prefix and skips finished ranges", () => {
    const ranges = [
      { fromBlock: 104_000_000, toBlock: 104_009_999 },
      { fromBlock: 104_020_000, toBlock: 104_029_999 },
      { fromBlock: 104_010_000, toBlock: 104_019_999 },
    ];
    expect(venusCoveredThrough(104_000_000, ranges)).toBe(104_029_999);
    expect(venusCoveredThrough(104_000_000, [{ fromBlock: 104_010_000, toBlock: 104_019_999 }])).toBe(103_999_999);
    const missing = missingVenusLogRanges(100, 129, 10, [
      { fromBlock: 100, toBlock: 109 },
      { fromBlock: 120, toBlock: 129 },
    ]);
    expect(missing).toEqual([{ fromBlock: 110, toBlock: 119 }]);
    const cache: VenusHolderCache = {
      schema: "venus-holder-cache-v1",
      vTokens: ["0xabc"],
      startBlock: 104_000_000,
      ranges,
      addresses: ["0x1111111111111111111111111111111111111111"],
    };
    expect(venusCacheMatches(cache, 104_000_000, ["0xAbC"])).toBe(true);
    expect(venusCacheMatches(cache, 1, ["0xabc"])).toBe(false);
    expect(parseVenusHolderCache({ ...cache, schema: "nope" })).toBeNull();
    expect(parseVenusHolderCache(cache)?.addresses).toEqual(["0x1111111111111111111111111111111111111111"]);
  });
});

function market(
  collateral: string,
  collateralSymbol: string,
  loan: string,
  loanSymbol: string,
  collateralUsd: number,
  borrowUsd: number,
  supplyUsd: number,
  borrowApy: number,
) {
  return {
    collateralAsset: { address: collateral, symbol: collateralSymbol },
    loanAsset: { address: loan, symbol: loanSymbol },
    state: {
      collateralAssetsUsd: collateralUsd,
      borrowAssetsUsd: borrowUsd,
      supplyAssetsUsd: supplyUsd,
      borrowApy,
    },
  };
}

function asset(
  address: string,
  symbol: string,
  supplied: string,
  borrowed: string,
  borrowApy = "0",
  utilization = "0",
  tokens?: string,
) {
  return {
    underlying: { address, info: { symbol } },
    summary: {
      supplied: { amount: tokens === undefined ? undefined : { value: tokens }, exchange: { value: supplied } },
      borrowed: { exchange: { value: borrowed } },
      borrowApy: { value: borrowApy, normalized: String(Number(borrowApy) * 100) },
      utilizationRate: { value: utilization, normalized: String(Number(utilization) * 100) },
    },
  };
}
