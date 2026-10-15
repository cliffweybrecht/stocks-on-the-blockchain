import { describe, expect, it } from "vitest";
import {
  breachDropPct,
  collateralAtRisk,
  loanFromAavePosition,
  loanFromMorphoPosition,
  loansFromMorphoPositions,
  majoritySafeUntilPct,
  poolBreachDropPct,
  positionLoanHealth,
  riskSentence,
} from "../lending-health";
import { parseLendingSnapshot, serializeLendingSnapshot, lendingDayFromCapture } from "../lending-snapshot";

describe("loan health buckets", () => {
  it("puts a loan in the first whole percent past its cushion, and keeps an exact line inside", () => {
    expect(breachDropPct({ cushion: 0.545, alreadyPast: false })).toBe(55);
    expect(breachDropPct({ cushion: 0.099, alreadyPast: false })).toBe(10);
    expect(breachDropPct({ cushion: 0.1, alreadyPast: false })).toBe(11);
    expect(breachDropPct({ cushion: 0, alreadyPast: true })).toBe(0);
    expect(breachDropPct({ cushion: 1, alreadyPast: false })).toBe(101);
    const bands = positionLoanHealth({
      asOf: "2026-10-09T12:00:00.000Z",
      source: "test",
      unpricedLoanCount: 1,
      loans: [
        { collateralUsd: 200, cushion: 0.099, alreadyPast: false },
        { collateralUsd: 50, cushion: 0.1, alreadyPast: false },
        { collateralUsd: 25, cushion: 0, alreadyPast: true },
      ],
    }).bands;
    expect(collateralAtRisk(bands, 0.1)).toBe(225);
    expect(collateralAtRisk(bands, 0.11)).toBe(275);
    expect(poolBreachDropPct(100, 40, 0.5)).toBe(21);
    expect(poolBreachDropPct(100, 40, 0.8)).toBe(51);
  });

  it("reads Morpho and Aave loans without inventing a missing price", () => {
    const morpho = loanFromMorphoPosition({
      healthFactor: 2,
      priceVariationToLiquidationPrice: -0.5,
      state: { collateralUsd: 100, borrowAssetsUsd: 40 },
    });
    expect(morpho.loan).toEqual({ collateralUsd: 100, cushion: 0.5, alreadyPast: false });
    const past = loanFromMorphoPosition({
      priceVariationToLiquidationPrice: 0.02,
      state: { collateralUsd: 10, borrowAssetsUsd: 9 },
    });
    expect(past.loan?.alreadyPast).toBe(true);
    const missing = loansFromMorphoPositions([
      { state: { collateralUsd: null, borrowAssetsUsd: 5 } },
      { state: { collateralUsd: 0, borrowAssetsUsd: 5 } },
    ]);
    expect(missing.loans).toEqual([]);
    expect(missing.unpricedLoanCount).toBe(1);
    const aave = loanFromAavePosition({
      healthFactor: { current: "2.0" },
      totalCollateral: { current: { value: "100" } },
      totalDebt: { current: { value: "40" } },
      spoke: { name: "Coinbase Stocks" },
    });
    expect(aave.loan?.cushion).toBeCloseTo(0.5, 6);
    expect(collateralAtRisk([{ dropPct: breachDropPct(aave.loan!), collateralUsd: 100 }], 0.5)).toBe(0);
    expect(loanFromAavePosition({
      healthFactor: { current: "1.2" },
      totalCollateral: { current: { value: "10" } },
      totalDebt: { current: { value: "4" } },
      spoke: { name: "Other Spoke" },
    }).loan).toBeNull();
  });

  it("names the drop that puts most of the priced stock past the line", () => {
    const safe = majoritySafeUntilPct([
      { dropPct: 25, collateralUsd: 60 },
      { dropPct: 80, collateralUsd: 40 },
    ]);
    expect(safe).toBe(24);
    expect(riskSentence(safe)).toBe("Most of the stock in these loans is safe unless prices fall more than 24%.");
    expect(riskSentence(-1)).toBe("Most of the stock in these loans is already past the borrowing limit.");
    expect(riskSentence(null)).toBe("How far prices can fall is not figured yet.");
    expect(majoritySafeUntilPct([{ dropPct: 0, collateralUsd: 51 }, { dropPct: 90, collateralUsd: 49 }])).toBe(-1);
  });

  it("keeps bucketed health on a snapshot and still reads a file that has none", () => {
    const health = positionLoanHealth({
      asOf: "2026-10-09T12:00:00.000Z",
      source: "morpho",
      loans: [{ collateralUsd: 10, cushion: 0.2, alreadyPast: false }],
      unpricedLoanCount: 0,
    });
    const day = lendingDayFromCapture(
      Date.parse("2026-10-09T16:00:00.000Z"),
      [
        {
          id: "morpho-base",
          venue: "Morpho",
          chainId: "base",
          chainLabel: "Base",
          collateralUsd: 10,
          stableBorrowedUsd: 4,
          lendSupplyUsd: 8,
          utilization: 0.5,
          borrowApy: 0.1,
          borrowApyMin: 0.1,
          borrowApyMax: 0.1,
          stockBorrowedUsd: null,
          assets: [],
          note: null,
          borrowEstimate: null,
          loanHealth: health,
          source: "morpho",
          error: null,
        },
      ],
      [],
    );
    const parsed = parseLendingSnapshot(JSON.parse(serializeLendingSnapshot(day)));
    expect(parsed?.rows[0]?.loanHealth?.method).toBe("positions");
    expect(parsed?.rows[0]?.loanHealth?.bands).toEqual([{ dropPct: 21, collateralUsd: 10 }]);
    const old = parseLendingSnapshot({
      schema: "equity-lending-v1",
      date: "2026-10-08",
      capturedAt: "2026-10-08T12:00:00.000Z",
      rows: [{ id: "old", venue: "Old", chainId: "base", collateralUsd: 1, stableBorrowedUsd: 1 }],
      failures: [],
    });
    expect(old?.rows[0]?.loanHealth).toBeNull();
    expect(parseLendingSnapshot({ ...day, rows: [{ ...day.rows[0], loanHealth: { method: "nope" } }] })?.rows[0]?.loanHealth).toBeNull();
  });
});
