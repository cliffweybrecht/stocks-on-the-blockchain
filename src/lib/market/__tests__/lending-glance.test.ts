import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatUsdCompact } from "../format";
import {
  buildLendingDepth,
  lendingDropAnswer,
  lendingDropKey,
  lendingDropScopes,
  lendingDropTable,
  lendingFillingFlags,
  lendingGlance,
  lendingPreviousRows,
  lendingRiskLine,
  type LendingDropFraction,
} from "../lending-glance";
import { poolLoanHealth, positionLoanHealth } from "../lending-health";
import { aggregateLendingTotals, formatLendingFractionPct, parseLendingSnapshot, type LendingAsset, type LendingRow } from "../lending-snapshot";

function asset(partial: Partial<LendingAsset> & Pick<LendingAsset, "symbol">): LendingAsset {
  return {
    address: partial.symbol.toLowerCase(),
    collateralUsd: 100,
    collateralTokens: 1,
    maxLtv: 0.5,
    priceNote: null,
    ...partial,
  };
}

function row(partial: Partial<LendingRow> & Pick<LendingRow, "id" | "venue">): LendingRow {
  return {
    chainId: "solana",
    chainLabel: "Solana",
    collateralUsd: 100,
    stableBorrowedUsd: 40,
    lendSupplyUsd: 50,
    utilization: 0.8,
    borrowApy: 0.05,
    borrowApyMin: 0.05,
    borrowApyMax: 0.05,
    stockBorrowedUsd: null,
    assets: [asset({ symbol: "NVDAx" })],
    note: null,
    borrowEstimate: null,
    source: "test",
    error: null,
    ...partial,
  };
}

describe("lending glance", () => {
  it("leads with a material pool that is at least 90% full and ignores a dust pool", () => {
    const full = row({
      id: "kamino-xstocks",
      venue: "Kamino xStocks",
      collateralUsd: 22_000_000,
      stableBorrowedUsd: 5_000_000,
      utilization: 0.902,
      assets: [asset({ symbol: "SPYx", collateralUsd: 22_000_000, maxLtv: 0.55 })],
    });
    const dust = row({
      id: "morpho-hyperevm",
      venue: "Morpho",
      chainId: "hyperevm",
      chainLabel: "HyperEVM",
      collateralUsd: 28,
      stableBorrowedUsd: 11,
      utilization: 0.917,
      assets: [asset({ symbol: "SPY", collateralUsd: 28, maxLtv: 0.6 })],
    });
    const flags = lendingFillingFlags([full, dust], null);
    expect(flags.map((flag) => flag.venueId)).toEqual(["kamino-xstocks"]);
    const glance = lendingGlance([full, dust], aggregateLendingTotals([full, dust]), flags);
    expect(glance.tone).toBe("stretched");
    expect(glance.toneLine).toBe("A bigger pool is at least 90% full.");
    expect(glance.sentence).toBe(
      "$22.0M of stock tokens are locked and $5.0M is borrowed against them. The busiest pool, Kamino xStocks, is 90.2% full.",
    );
  });

  it("stays calm when bigger pools have room and no day-over-day jump", () => {
    const calm = row({ id: "a", venue: "Jupiter Lend", utilization: 0.4, stableBorrowedUsd: 100_000, collateralUsd: 200_000 });
    const flags = lendingFillingFlags([calm], [row({ id: "a", venue: "Jupiter Lend", utilization: 0.36, borrowApy: 0.045 })]);
    expect(flags).toEqual([]);
    const glance = lendingGlance([calm], aggregateLendingTotals([calm]), flags);
    expect(glance.tone).toBe("calm");
    expect(glance.toneLine).toMatch(/still have room/);
    expect(glance.sentence).toBe(
      "$200.0K of stock tokens are locked and $100.0K is borrowed against them. The bigger pools still have room.",
    );
  });

  it("flags a 10 point fullness jump or a 1 point rate jump, and skips smaller moves", () => {
    const current = row({
      id: "lista-bnb",
      venue: "Lista",
      chainId: "bnb",
      chainLabel: "BNB",
      utilization: 0.82,
      borrowApy: 0.03,
      stableBorrowedUsd: 100_000,
    });
    const fuller = lendingFillingFlags([current], [row({ id: "lista-bnb", venue: "Lista", utilization: 0.7, borrowApy: 0.03 })]);
    expect(fuller.map((flag) => flag.kind)).toEqual(["utilization-jump"]);
    expect(fuller[0]?.text).toMatch(/12 points fuller/);
    const pricier = lendingFillingFlags(
      [row({ id: "lista-bnb", venue: "Lista", utilization: 0.5, borrowApy: 0.031, stableBorrowedUsd: 100_000 })],
      [row({ id: "lista-bnb", venue: "Lista", utilization: 0.5, borrowApy: 0.02 })],
    );
    expect(pricier.map((flag) => flag.kind)).toEqual(["rate-jump"]);
    const small = lendingFillingFlags(
      [row({ id: "lista-bnb", venue: "Lista", utilization: 0.75, borrowApy: 0.025, stableBorrowedUsd: 100_000 })],
      [row({ id: "lista-bnb", venue: "Lista", utilization: 0.7, borrowApy: 0.02 })],
    );
    expect(small).toEqual([]);
    const missingPrior = lendingFillingFlags([current], [row({ id: "lista-bnb", venue: "Lista", utilization: null, borrowApy: null })]);
    expect(missingPrior).toEqual([]);
  });

  it("estimates a drop from published limits and borrowed dollars, and leaves a missing limit unfigured", () => {
    const room = row({
      id: "room",
      venue: "Room",
      collateralUsd: 100,
      stableBorrowedUsd: 10,
      assets: [asset({ symbol: "SPYx", collateralUsd: 100, maxLtv: 0.8 })],
    });
    const tight = row({
      id: "tight",
      venue: "Tight",
      chainId: "base",
      chainLabel: "Base",
      collateralUsd: 100,
      stableBorrowedUsd: 80,
      assets: [asset({ symbol: "TSLAx", collateralUsd: 100, maxLtv: 0.5 })],
    });
    const aave = row({
      id: "aave",
      venue: "Aave",
      chainId: "base",
      chainLabel: "Base",
      collateralUsd: 100,
      stableBorrowedUsd: 50,
      assets: [asset({ symbol: "NVDAc", collateralUsd: 100, maxLtv: null })],
    });
    expect(lendingDropAnswer([room], "room", 0.5).sentence).toBe(
      "A 50% drop stays inside the borrowing limit. No stock would be sold off to repay loans.",
    );
    expect(lendingDropAnswer([room], "room", 0.5).collateralAtRiskUsd).toBe(0);
    const breached = lendingDropAnswer([tight], "tight", 0.5);
    expect(breached.collateralAtRiskUsd).toBe(100);
    expect(breached.sentence).toBe("A 50% drop means about $100.0 of stock could be sold off to repay loans.");
    const mixed = lendingDropAnswer([room, tight, aave], "all", 0.5);
    expect(mixed.collateralAtRiskUsd).toBe(100);
    expect(mixed.method).toMatch(/Aave did not publish a borrowing limit/);
    expect(mixed.method).toMatch(/Friday 8:00 PM Eastern/);
    expect(mixed.method).toMatch(/not each person's loan/);
    const unfigured = lendingDropAnswer([aave], "aave", 0.2);
    expect(unfigured.collateralAtRiskUsd).toBeNull();
    expect(unfigured.sentence).toMatch(/not figured/);
    const noBorrow = lendingDropAnswer([row({ id: "x", venue: "X", stableBorrowedUsd: null })], "x", 0.2);
    expect(noBorrow.collateralAtRiskUsd).toBeNull();
    expect(noBorrow.sentence).not.toMatch(/\$0/);
  });

  it("gives a stock its share of the venue's borrows and keeps an exact limit inside", () => {
    const book = row({
      id: "kamino",
      venue: "Kamino xStocks",
      collateralUsd: 100,
      stableBorrowedUsd: 25,
      assets: [
        asset({ symbol: "NVDAx", collateralUsd: 80, maxLtv: 0.5 }),
        asset({ symbol: "TSLAx", collateralUsd: 20, maxLtv: 0.5 }),
      ],
    });
    const onTheLine = lendingDropAnswer([book], "stock:NVDA", 0.5);
    expect(onTheLine.collateralAtRiskUsd).toBe(0);
    expect(onTheLine.sentence).toMatch(/stays inside/);
    const hotter = row({ ...book, stableBorrowedUsd: 60 });
    const past = lendingDropAnswer([hotter], "stock:NVDA", 0.5);
    expect(past.collateralAtRiskUsd).toBe(80);
    expect(past.sentence).toBe("A 50% drop means about $80.0 of stock could be sold off to repay loans.");
    expect(lendingDropAnswer([book], "stock:NOPE", 0.2).sentence).toMatch(/not in this snapshot/);
  });

  it("uses stored loan buckets when a venue published them and labels the pool estimate", () => {
    const positions = row({
      id: "morpho-base",
      venue: "Morpho",
      chainId: "base",
      chainLabel: "Base",
      collateralUsd: 1_000,
      stableBorrowedUsd: 100,
      assets: [asset({ symbol: "NVDAc", collateralUsd: 1_000, maxLtv: 0.86 })],
      loanHealth: positionLoanHealth({
        asOf: "2026-10-09T12:00:00.000Z",
        source: "morpho",
        unpricedLoanCount: 0,
        loans: [
          { collateralUsd: 800, cushion: 0.545, alreadyPast: false },
          { collateralUsd: 200, cushion: 0.099, alreadyPast: false },
        ],
      }),
    });
    const pool = row({
      id: "kamino",
      venue: "Kamino xStocks",
      collateralUsd: 100,
      stableBorrowedUsd: 40,
      assets: [asset({ symbol: "SPYx", collateralUsd: 100, maxLtv: 0.5 })],
      loanHealth: poolLoanHealth({
        asOf: "2026-10-09T12:00:00.000Z",
        source: "kamino",
        fallback: "Kamino publishes a loan only when the wallet is known, not a list of every loan, so this is the pool estimate.",
      }),
    });
    const mild = lendingDropAnswer([positions, pool], "all", 0.1);
    expect(mild.collateralAtRiskUsd).toBe(200);
    expect(mild.sentence).toBe("A 10% drop means about $200.0 of stock could be sold off to repay loans.");
    expect(mild.methodLine).toBe("Morpho uses each loan. Kamino xStocks uses a pool estimate.");
    expect(mild.method).toMatch(/reaches its liquidation price/);
    expect(mild.method).toMatch(/wallet is known/);
    expect(lendingDropAnswer([positions, pool], "all", 0.5).collateralAtRiskUsd).toBe(300);
    expect(lendingDropAnswer([positions], "morpho-base", 0.1).collateralAtRiskUsd).toBe(200);
    expect(lendingDropAnswer([pool], "kamino", 0.2).sentence).toMatch(/stays inside/);
    expect(lendingRiskLine([positions, pool])).toBe(
      "Most of the stock in these loans is safe unless prices fall more than 54%.",
    );
    const depth = buildLendingDepth([
      {
        schema: "equity-lending-v1",
        date: "2026-10-09",
        capturedAt: "2026-10-09T12:00:00.000Z",
        rows: [positions, pool],
        failures: [],
      },
    ]);
    expect(depth.venues.find((venue) => venue.id === "morpho-base")?.positionsNote).toMatch(/not each wallet/);
    expect(depth.venues.find((venue) => venue.id === "kamino")?.positionsNote).toMatch(/pool estimate/);
    const gap = row({
      ...positions,
      loanHealth: positionLoanHealth({
        asOf: "2026-10-09T12:00:00.000Z",
        source: "morpho",
        unpricedLoanCount: 20,
        loans: [{ collateralUsd: 200, cushion: 0.099, alreadyPast: false }],
      }),
    });
    expect(lendingDropAnswer([gap], "morpho-base", 0.1).sentence).toMatch(/priced stock/);
  });

  it("reads the stored snapshots without inventing a jump or a breach", () => {
    const latest = parseLendingSnapshot(JSON.parse(readFileSync("data/lending-snapshots/2026-10-09.json", "utf8")));
    const prior = parseLendingSnapshot(JSON.parse(readFileSync("data/lending-snapshots/2026-10-08.json", "utf8")));
    expect(latest).not.toBeNull();
    expect(prior).not.toBeNull();
    if (!latest || !prior) return;
    const days = [prior, latest];
    expect(lendingPreviousRows(days)?.[0]?.id).toBe(prior.rows[0]?.id);
    const flags = lendingFillingFlags(latest.rows, prior.rows);
    expect(flags[0]?.venueId).toBe("kamino-xstocks");
    expect(flags[0]?.kind).toBe("full");
    expect(flags.some((flag) => flag.venueId === "morpho-hyperevm")).toBe(false);
    const totals = aggregateLendingTotals(latest.rows);
    const glance = lendingGlance(latest.rows, totals, flags);
    const kaminoRow = latest.rows.find((row) => row.id === "kamino-xstocks");
    expect(glance.tone).toBe("stretched");
    expect(glance.sentence).toBe(
      `${formatUsdCompact(totals.collateralUsd)} of stock tokens are locked and ${formatUsdCompact(totals.stableBorrowedUsd)} is borrowed against them. The busiest pool, Kamino xStocks, is ${formatLendingFractionPct(kaminoRow?.utilization)} full.`,
    );
    expect(glance.toneLine).toBe("A bigger pool is at least 90% full.");
    expect(lendingRiskLine(latest.rows)).toBe("Most of the stock in these loans is safe unless prices fall more than 55%.");
    const scopes = lendingDropScopes(latest.rows);
    const table = lendingDropTable(latest.rows, scopes);
    const mild = table.all?.[lendingDropKey(0.1 as LendingDropFraction)];
    const mid = table.all?.[lendingDropKey(0.2 as LendingDropFraction)];
    expect(mild?.sentence).toBe("A 10% drop means about $9.3K of stock could be sold off to repay loans.");
    expect(mid?.sentence).toBe("A 20% drop means about $3.4M of stock could be sold off to repay loans.");
    expect(mid?.methodLine).toBe(
      "Aave V4 Coinbase stocks and Morpho use each loan. Kamino xStocks, Kamino Sentora / Kraken, Jupiter Lend, Venus, and Lista use a pool estimate.",
    );
    expect(mid?.method).toMatch(/each loan/);
    expect(mid?.method).toMatch(/pool estimate/);
    expect(mid?.method).toMatch(/wallet is known/);
    expect(mid?.method).toMatch(/Sunday 8:00 PM Eastern/);
    expect(table["kamino-xstocks"]?.[lendingDropKey(0.5 as LendingDropFraction)]?.sentence).toMatch(/stays inside/);
    const aaveDrop = table["aave-v4-base-coinbase"]?.[lendingDropKey(0.2 as LendingDropFraction)];
    expect(aaveDrop?.collateralAtRiskUsd).toBeGreaterThan(0);
    expect(aaveDrop?.methodLine).toBe("Aave V4 Coinbase stocks uses each loan.");
    const aaveRow = latest.rows.find((row) => row.id === "aave-v4-base-coinbase");
    expect(aaveRow?.assets?.find((asset) => asset.symbol === "NVDAc")?.maxLtv).toBeCloseTo(0.7, 6);
    expect(aaveRow?.loanHealth?.method).toBe("positions");
    expect(aaveRow?.loanHealth?.loanCount).toBe(166);
    const depth = buildLendingDepth(days);
    const kamino = depth.venues.find((venue) => venue.id === "kamino-xstocks");
    expect(kamino?.history.map((point) => point.date)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(kamino?.positionsNote).toMatch(/pool estimate/);
    expect(kamino?.positionsNote).toMatch(/wallet is known/);
    const morpho = depth.venues.find((venue) => venue.id === "morpho-base");
    expect(morpho?.positionsNote).toMatch(/publishes each loan/);
    expect(morpho?.positionsNote).toMatch(/not each wallet/);
    expect(kamino?.assets[0]?.collateralUsd).not.toBeNull();
    const venus = depth.venues.find((venue) => venue.id === "venus-bnb");
    expect(venus?.estimateLabel).toMatch(/Lower bound/);
    expect(venus?.estimateLabel).toMatch(/estimate/);
    const nvda = depth.stocks.find((stock) => stock.ticker === "NVDA");
    expect(nvda?.places.length).toBeGreaterThan(1);
    expect(depth.chains.map((chain) => chain.chainId)).toContain("solana");
    expect(depth.chains.find((chain) => chain.chainId === "hyperevm")?.collateralUsd).toBeGreaterThan(0);
    expect(lendingRiskLine(latest.rows)).toMatch(/Most of the stock in these loans|not figured yet/);
  });
});
