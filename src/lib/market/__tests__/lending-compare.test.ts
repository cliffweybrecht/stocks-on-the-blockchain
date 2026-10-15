import { describe, expect, it } from "vitest";
import { buildLendingCompare, lendingCompareAnswer, lendingFigureFreshness, lendingFigureLine } from "../lending-compare";
import { lendingDayFromCapture, lendingHistoryFromDays, lendingHistoryWindow, type LendingHistoryPoint, type LendingRow } from "../lending-snapshot";

function asset(symbol: string, address: string, collateralUsd: number | null) {
  return { symbol, address, collateralUsd, collateralTokens: null, maxLtv: 0.5 };
}

function row(partial: Partial<LendingRow> & Pick<LendingRow, "id" | "venue" | "chainId" | "chainLabel">): LendingRow {
  return {
    collateralUsd: 100,
    stableBorrowedUsd: 40,
    lendSupplyUsd: 100,
    utilization: 0.4,
    borrowApy: 0.05,
    borrowApyMin: 0.05,
    borrowApyMax: 0.05,
    stockBorrowedUsd: null,
    assets: [],
    borrowEstimate: null,
    source: "https://example.test/pool",
    error: null,
    ...partial,
  };
}

describe("lending compare", () => {
  const morpho = row({
    id: "morpho-ethereum",
    venue: "Morpho",
    chainId: "ethereum",
    chainLabel: "Ethereum",
    borrowApy: 0.05,
    borrowApyMin: 0.04,
    borrowApyMax: 0.06,
    stableBorrowedUsd: 100,
    lendSupplyUsd: 200,
    source: "https://api.morpho.org/graphql",
    assets: [
      asset("wSPYx", "0xaaa0000000000000000000000000000000000001", 500),
      asset("wSPYx", "0xbbb0000000000000000000000000000000000002", 20),
      asset("SPYon", "0xccc0000000000000000000000000000000000003", null),
    ],
  });
  const morphoBase = row({
    id: "morpho-base",
    venue: "Morpho",
    chainId: "base",
    chainLabel: "Base",
    borrowApy: 0.05,
    borrowApyMin: 0.04,
    borrowApyMax: 0.06,
    stableBorrowedUsd: 10,
    lendSupplyUsd: 20,
    source: "https://api.morpho.org/graphql",
    assets: [asset("SPYx", "0xddd0000000000000000000000000000000000004", 40)],
  });
  const jupiter = row({
    id: "jupiter-lend",
    venue: "Jupiter Lend",
    chainId: "solana",
    chainLabel: "Solana",
    borrowApy: 0.02,
    borrowApyMin: 0.02,
    borrowApyMax: 0.02,
    stableBorrowedUsd: 40,
    lendSupplyUsd: null,
    utilization: 0.87,
    source: "https://lite-api.jup.ag/lend/v1/borrow/vaults",
    assets: [asset("SPYx", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", 900)],
  });
  const kamino = row({
    id: "kamino-xstocks",
    venue: "Kamino xStocks",
    chainId: "solana",
    chainLabel: "Solana",
    borrowApy: 0.07,
    borrowApyMin: 0.07,
    borrowApyMax: 0.07,
    stableBorrowedUsd: 70,
    lendSupplyUsd: 100,
    source: "https://api.kamino.finance/kamino-market/example/reserves/metrics",
    assets: [asset("NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", 80)],
  });
  const venus = row({
    id: "venus-bnb",
    venue: "Venus",
    chainId: "bnb",
    chainLabel: "BNB",
    borrowApy: 0.2,
    borrowApyMin: 0.2,
    borrowApyMax: 0.2,
    stableBorrowedUsd: 10,
    lendSupplyUsd: null,
    utilization: null,
    source: "https://api.venus.io/markets/core-pool?chainId=56&limit=100",
    borrowEstimate: {
      method: "Pro-rata from onchain balances.",
      asOf: "2026-10-13T04:00:00.000Z",
      lowerBoundUsd: 5,
    },
    assets: [asset("NVDAB", "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", 30)],
  });
  const capturedAt = "2026-10-14T04:05:54.597Z";
  const model = buildLendingCompare([morpho, morphoBase, jupiter, kamino, venus], capturedAt);

  it("ranks stocks by locked dollars and keeps a missing dollar amount out of the sum", () => {
    expect(model.stocks.map((stock) => stock.ticker)).toEqual(["SPY", "NVDA"]);
    const spy = model.stocks[0];
    expect(spy?.collateralUsd).toBe(500 + 20 + 900 + 40);
    expect(spy?.unpricedTokens).toBe(1);
    expect(spy?.placeCount).toBe(3);
    expect(model.timeLabel).toMatch(/Oct 14, 2026/);
    expect(model.timeLabel).toMatch(/E[DS]T$/);
  });

  it("compares venues by published yearly cost and matches Morpho tokens by address", () => {
    const places = model.places.SPY ?? [];
    expect(places.map((place) => place.venueId)).toEqual(["jupiter-lend", "morpho-ethereum", "morpho-base"]);
    const ethereum = places.find((place) => place.venueId === "morpho-ethereum");
    expect(ethereum?.collateralUsd).toBe(520);
    expect(ethereum?.unpricedTokens).toBe(1);
    expect(ethereum?.tokens.map((token) => token.address)).toEqual([
      "0xaaa0000000000000000000000000000000000001",
      "0xbbb0000000000000000000000000000000000002",
      "0xccc0000000000000000000000000000000000003",
    ]);
    expect(ethereum?.howFull).toBeCloseTo(0.5, 6);
    expect(ethereum?.label).toBe("Morpho on Ethereum");
    const shared = places.find((place) => place.venueId === "jupiter-lend");
    expect(shared?.howFull).toBeNull();
    expect(shared?.borrowApy).toBeCloseTo(0.02, 6);
    expect(lendingCompareAnswer(places)).toBe("The lowest published yearly cost is 2.0% at Jupiter Lend.");
    const morphoPlaces = places.filter((place) => place.venueId.startsWith("morpho"));
    expect(lendingCompareAnswer(morphoPlaces)).toBe("The lowest published yearly cost is 4.0–6.0%, tied at Morpho on Ethereum and Morpho on Base.");
  });

  it("leaves Venus how-full and yearly cost blank and labels the borrow as a pro-rata estimate", () => {
    const places = model.places.NVDA ?? [];
    expect(places.map((place) => place.venueId)).toEqual(["kamino-xstocks", "venus-bnb"]);
    const estimate = places.find((place) => place.venueId === "venus-bnb");
    expect(estimate?.estimate).toBe(true);
    expect(estimate?.borrowApy).toBeNull();
    expect(estimate?.howFull).toBeNull();
    expect(estimate?.collateralUsd).toBe(30);
    expect(estimate?.timeLabel).toMatch(/Oct 13, 2026/);
    expect(lendingCompareAnswer(places)).toBe("The lowest published yearly cost is 7.0% at Kamino xStocks.");
    expect(lendingCompareAnswer([])).toMatch(/No venue published/);
  });

  it("names a different source set for how full than for borrowed dollars", () => {
    const rows = [morpho, jupiter, venus];
    const full = lendingFigureFreshness(rows, capturedAt, "full");
    const borrowed = lendingFigureFreshness(rows, capturedAt, "borrowed");
    const cost = lendingFigureFreshness(rows, capturedAt, "cost");
    expect(full.sources.map((source) => source.host)).toEqual(["api.morpho.org"]);
    expect(full.note).toBeNull();
    expect(borrowed.sources.map((source) => source.host)).toEqual(["api.morpho.org", "api.venus.io", "lite-api.jup.ag"]);
    expect(borrowed.note).toMatch(/Venus borrow is a pro-rata estimate/);
    expect(borrowed.note).toMatch(/Last measured/);
    expect(cost.sources.map((source) => source.host)).toEqual(["api.morpho.org", "lite-api.jup.ag"]);
    expect(lendingFigureLine(full)).toMatch(/api\.morpho\.org · Oct 14, 2026/);
    expect(lendingFigureLine(lendingFigureFreshness([], null, "collateral"))).toBe("—");
  });
});

describe("lending history window", () => {
  function point(date: string, utilization: number | null): LendingHistoryPoint {
    return { date, capturedAt: `${date}T16:00:00.000Z`, collateralUsd: 10, stableBorrowedUsd: 4, utilization };
  }

  it("keeps stored days inside 7 days, 30 days, and all, and does not fill gaps", () => {
    const history = [point("2026-09-01", 0.2), point("2026-09-14", 0.3), point("2026-10-06", 0.4), point("2026-10-07", null), point("2026-10-13", 0.5)];
    expect(lendingHistoryWindow(history, "7d").map((item) => item.date)).toEqual(["2026-10-07", "2026-10-13"]);
    expect(lendingHistoryWindow(history, "30d").map((item) => item.date)).toEqual(["2026-09-14", "2026-10-06", "2026-10-07", "2026-10-13"]);
    expect(lendingHistoryWindow(history, "all")).toHaveLength(5);
    expect(lendingHistoryWindow(history, "7d").some((item) => item.date === "2026-10-08")).toBe(false);
  });

  it("stores desk how-full and leaves a shared-pool day blank", () => {
    const own = row({
      id: "kamino-xstocks",
      venue: "Kamino xStocks",
      chainId: "solana",
      chainLabel: "Solana",
      stableBorrowedUsd: 45,
      lendSupplyUsd: 50,
      collateralUsd: 100,
    });
    const shared = row({
      id: "jupiter-lend",
      venue: "Jupiter Lend",
      chainId: "solana",
      chainLabel: "Solana",
      stableBorrowedUsd: 40,
      lendSupplyUsd: null,
      utilization: 0.8,
      collateralUsd: 80,
    });
    const mixed = lendingHistoryFromDays([lendingDayFromCapture(Date.parse("2026-10-14T04:00:00.000Z"), [own, shared], [])]);
    expect(mixed[0]?.stableBorrowedUsd).toBe(85);
    expect(mixed[0]?.utilization).toBeCloseTo(45 / 50, 6);
    const onlyShared = lendingHistoryFromDays([lendingDayFromCapture(Date.parse("2026-10-14T04:00:00.000Z"), [shared], [])]);
    expect(onlyShared[0]?.collateralUsd).toBe(80);
    expect(onlyShared[0]?.stableBorrowedUsd).toBe(40);
    expect(onlyShared[0]?.utilization).toBeNull();
  });
});
