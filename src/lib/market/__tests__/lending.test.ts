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
  parseMorphoMarkets,
  parseVenusMarkets,
  withListaApy,
} from "../lending-parse";
import {
  aggregateLendingTotals,
  buildLendingDeskModel,
  formatLendingApy,
  formatLendingCapturedAt,
  formatLendingFractionPct,
  formatStockBorrowedNote,
  groupLendingRows,
  lendingDayFromCapture,
  lendingUtilization,
  parseLendingSnapshot,
  serializeLendingSnapshot,
} from "../lending-snapshot";
import { saveLendingDay, loadLatestLendingSnapshot } from "../lending-snapshot-file";
import { runLendingSnapshotCli } from "../lending-snapshot-job";
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
        { liquidityToken: "NVDAx", liquidityTokenMint: NVDA, totalSupplyUsd: "20000000", totalBorrowUsd: "100000", borrowApy: "0.05" },
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
        asset("0xb20000000000000000000078ee7ce2fe4908108c", "NVDAc", "1170000", "0"),
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
) {
  return {
    underlying: { address, info: { symbol } },
    summary: {
      supplied: { exchange: { value: supplied } },
      borrowed: { exchange: { value: borrowed } },
        borrowApy: { value: borrowApy, normalized: String(Number(borrowApy) * 100) },
        utilizationRate: { value: utilization, normalized: String(Number(utilization) * 100) },
    },
  };
}
