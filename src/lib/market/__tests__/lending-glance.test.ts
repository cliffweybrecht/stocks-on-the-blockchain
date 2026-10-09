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
  type LendingDropFraction,
} from "../lending-glance";
import { aggregateLendingTotals, parseLendingSnapshot, type LendingAsset, type LendingRow } from "../lending-snapshot";

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
    expect(glance.sentence).toBe(
      "Kamino xStocks's dollar pool is 90.2% full, with $22.0M of stock locked and $5.0M borrowed against it.",
    );
  });

  it("stays calm when bigger pools have room and no day-over-day jump", () => {
    const calm = row({ id: "a", venue: "Jupiter Lend", utilization: 0.4, stableBorrowedUsd: 100_000, collateralUsd: 200_000 });
    const flags = lendingFillingFlags([calm], [row({ id: "a", venue: "Jupiter Lend", utilization: 0.36, borrowApy: 0.045 })]);
    expect(flags).toEqual([]);
    const glance = lendingGlance([calm], aggregateLendingTotals([calm]), flags);
    expect(glance.tone).toBe("calm");
    expect(glance.sentence).toMatch(/still have room/);
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
    expect(lendingDropAnswer([room], "room", 0.5).sentence).toBe("A 50% drop stays inside the borrowing limit.");
    expect(lendingDropAnswer([room], "room", 0.5).collateralAtRiskUsd).toBe(0);
    const breached = lendingDropAnswer([tight], "tight", 0.5);
    expect(breached.collateralAtRiskUsd).toBe(100);
    expect(breached.sentence).toBe("A 50% drop would push about $100.0 of stock past the borrowing limit.");
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
    expect(past.sentence).toBe("A 50% drop would push about $80.0 of stock past the borrowing limit.");
    expect(lendingDropAnswer([book], "stock:NOPE", 0.2).sentence).toMatch(/not in this snapshot/);
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
    expect(flags.map((flag) => flag.venueId)).toEqual(["kamino-xstocks"]);
    expect(flags.some((flag) => flag.venueId === "morpho-hyperevm")).toBe(false);
    const totals = aggregateLendingTotals(latest.rows);
    const glance = lendingGlance(latest.rows, totals, flags);
    expect(glance.tone).toBe("stretched");
    expect(glance.sentence).toBe(
      `Kamino xStocks's dollar pool is 90.2% full, with ${formatUsdCompact(totals.collateralUsd)} of stock locked and ${formatUsdCompact(totals.stableBorrowedUsd)} borrowed against it.`,
    );
    const scopes = lendingDropScopes(latest.rows);
    const table = lendingDropTable(latest.rows, scopes);
    const mild = table.all?.[lendingDropKey(0.1 as LendingDropFraction)];
    const mid = table.all?.[lendingDropKey(0.2 as LendingDropFraction)];
    expect(mild?.collateralAtRiskUsd).toBe(0);
    expect(mild?.sentence).toMatch(/stays inside the borrowing limit where a limit is published/);
    expect(mid?.sentence).toMatch(/^A 20% drop would push about \$3\.0M of stock past the borrowing limit\.$/);
    expect(mid?.method).toMatch(/Aave/);
    expect(mid?.method).toMatch(/estimate/);
    expect(mid?.method).toMatch(/Sunday 8:00 PM Eastern/);
    expect(table["kamino-xstocks"]?.[lendingDropKey(0.5 as LendingDropFraction)]?.sentence).toMatch(/stays inside/);
    expect(table["aave-v4-base-coinbase"]?.[lendingDropKey(0.2 as LendingDropFraction)]?.collateralAtRiskUsd).toBeNull();
    const depth = buildLendingDepth(days);
    const kamino = depth.venues.find((venue) => venue.id === "kamino-xstocks");
    expect(kamino?.history.map((point) => point.date)).toEqual(["2026-10-08", "2026-10-09"]);
    expect(kamino?.positionsNote).toMatch(/can list each loan/);
    expect(kamino?.positionsNote).toMatch(/not each person's loan/);
    expect(kamino?.assets[0]?.collateralUsd).not.toBeNull();
    const venus = depth.venues.find((venue) => venue.id === "venus-bnb");
    expect(venus?.estimateLabel).toMatch(/Lower bound/);
    expect(venus?.estimateLabel).toMatch(/estimate/);
    const nvda = depth.stocks.find((stock) => stock.ticker === "NVDA");
    expect(nvda?.places.length).toBeGreaterThan(1);
    expect(depth.chains.map((chain) => chain.chainId)).toContain("solana");
    expect(depth.chains.find((chain) => chain.chainId === "hyperevm")?.collateralUsd).toBeGreaterThan(0);
  });
});
