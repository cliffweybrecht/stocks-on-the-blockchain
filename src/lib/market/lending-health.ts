import type { LendingHealthBand, LendingLoanHealth } from "./lending-snapshot";

/** Half a cent. Exact equality stays inside the limit. */
export const LENDING_PAST_LIMIT_USD = 0.005;

export interface PricedLoan {
  collateralUsd: number;
  /**
   * Drop fraction that lands exactly on the liquidation line.
   * 0.5 means a 50% drop reaches the line and any larger drop crosses it.
   */
  cushion: number;
  /** Health is already through the line, before any further drop. */
  alreadyPast: boolean;
}

/**
 * Smallest whole-percent drop that puts the loan past the line.
 * 0 means it is already past. 101 means a 100% drop still stays inside.
 */
export function breachDropPct(loan: Pick<PricedLoan, "cushion" | "alreadyPast">): number {
  if (loan.alreadyPast) return 0;
  const cushion = loan.cushion;
  if (!Number.isFinite(cushion) || cushion < 0) return 0;
  if (cushion >= 1) return 101;
  const pct = Math.floor(cushion * 100) + 1;
  return pct > 100 ? 101 : pct;
}

/** First whole percent where borrowed dollars are more than the remaining stock times the limit. */
export function poolBreachDropPct(collateralUsd: number, borrowedUsd: number, maxLtv: number): number {
  if (!(collateralUsd > 0) || !(maxLtv > 0) || !Number.isFinite(borrowedUsd)) return 101;
  for (let pct = 0; pct <= 100; pct += 1) {
    const limit = collateralUsd * (1 - pct / 100) * maxLtv;
    if (borrowedUsd - limit > LENDING_PAST_LIMIT_USD) return pct;
  }
  return 101;
}

export function bandsFromLoans(loans: readonly PricedLoan[]): LendingHealthBand[] {
  const totals = new Map<number, number>();
  for (const loan of loans) {
    if (!(loan.collateralUsd > 0) || !Number.isFinite(loan.collateralUsd)) continue;
    const dropPct = breachDropPct(loan);
    totals.set(dropPct, (totals.get(dropPct) ?? 0) + loan.collateralUsd);
  }
  return [...totals.entries()]
    .map(([dropPct, collateralUsd]) => ({ dropPct, collateralUsd }))
    .sort((a, b) => a.dropPct - b.dropPct);
}

/** Pre-drop collateral of loans a drop of this fraction would put past the line. */
export function collateralAtRisk(bands: readonly LendingHealthBand[], drop: number): number {
  if (!Number.isFinite(drop)) return 0;
  const pct = Math.round(drop * 100);
  return bands.reduce((sum, band) => (band.dropPct <= pct ? sum + band.collateralUsd : sum), 0);
}

/**
 * Largest whole percent that keeps at most half the covered stock inside the limit.
 * -1 when a majority is already past. Null when nothing was priced.
 */
export function majoritySafeUntilPct(bands: readonly LendingHealthBand[]): number | null {
  const covered = bands.reduce((sum, band) => sum + band.collateralUsd, 0);
  if (!(covered > 0)) return null;
  const half = covered / 2;
  const at = (pct: number) => bands.reduce((sum, band) => (band.dropPct <= pct ? sum + band.collateralUsd : sum), 0);
  if (at(0) > half) return -1;
  let safe = 0;
  for (let pct = 0; pct <= 100; pct += 1) {
    if (at(pct) <= half) safe = pct;
    else break;
  }
  return safe;
}

export function riskSentence(safeUntilPct: number | null): string {
  if (safeUntilPct === null) return "How far prices can fall is not figured yet.";
  if (safeUntilPct < 0) return "Most of the stock in these loans is already past the borrowing limit.";
  if (safeUntilPct === 0) return "Most of the stock in these loans is safe only while prices do not fall.";
  if (safeUntilPct >= 100) return "Most of the stock in these loans stays inside the borrowing limit even if stocks fall 100%.";
  return `Most of the stock in these loans is safe unless prices fall more than ${safeUntilPct}%.`;
}

export function positionLoanHealth(input: {
  asOf: string;
  source: string;
  loans: readonly PricedLoan[];
  unpricedLoanCount: number;
}): LendingLoanHealth {
  const loans = input.loans.filter((loan) => loan.collateralUsd > 0 && Number.isFinite(loan.collateralUsd));
  const bands = bandsFromLoans(loans);
  const covered = bands.reduce((sum, band) => sum + band.collateralUsd, 0);
  return {
    method: "positions",
    asOf: input.asOf,
    source: input.source,
    loanCount: loans.length,
    collateralCoveredUsd: covered,
    unpricedLoanCount: input.unpricedLoanCount > 0 ? input.unpricedLoanCount : 0,
    bands,
    fallback: null,
  };
}

export function poolLoanHealth(input: { asOf: string; source: string; fallback: string }): LendingLoanHealth {
  return {
    method: "pool",
    asOf: input.asOf,
    source: input.source,
    loanCount: null,
    collateralCoveredUsd: null,
    unpricedLoanCount: null,
    bands: [],
    fallback: input.fallback,
  };
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Morpho price variation is negative while the loan can still fall. A positive value is already through the line. */
export function loanFromMorphoPosition(value: unknown): { loan: PricedLoan | null; unpriced: boolean } {
  if (!value || typeof value !== "object") return { loan: null, unpriced: false };
  const row = value as {
    healthFactor?: unknown;
    priceVariationToLiquidationPrice?: unknown;
    state?: { collateralUsd?: unknown; borrowAssetsUsd?: unknown } | null;
  };
  const collateral = finiteNumber(row.state?.collateralUsd);
  const borrowed = finiteNumber(row.state?.borrowAssetsUsd);
  if (collateral === null) {
    if (borrowed !== null && borrowed > 0) return { loan: null, unpriced: true };
    return { loan: null, unpriced: false };
  }
  if (!(collateral > 0)) return { loan: null, unpriced: false };
  if (borrowed !== null && !(borrowed > 0)) return { loan: null, unpriced: false };
  const variation = finiteNumber(row.priceVariationToLiquidationPrice);
  if (variation !== null) {
    if (variation > 0) return { loan: { collateralUsd: collateral, cushion: 0, alreadyPast: true }, unpriced: false };
    return { loan: { collateralUsd: collateral, cushion: Math.min(1, -variation), alreadyPast: false }, unpriced: false };
  }
  const health = finiteNumber(row.healthFactor);
  if (health === null || !(health > 0)) return { loan: null, unpriced: true };
  if (health < 1) return { loan: { collateralUsd: collateral, cushion: 0, alreadyPast: true }, unpriced: false };
  return { loan: { collateralUsd: collateral, cushion: 1 - 1 / health, alreadyPast: false }, unpriced: false };
}

export function loansFromMorphoPositions(items: readonly unknown[]): { loans: PricedLoan[]; unpricedLoanCount: number } {
  const loans: PricedLoan[] = [];
  let unpricedLoanCount = 0;
  for (const item of items) {
    const read = loanFromMorphoPosition(item);
    if (read.loan) loans.push(read.loan);
    else if (read.unpriced) unpricedLoanCount += 1;
  }
  return { loans, unpricedLoanCount };
}

function aaveMoney(value: unknown): number | null {
  if (!value || typeof value !== "object") return finiteNumber(value);
  const current = (value as { current?: { value?: unknown } | null }).current;
  if (!current) return null;
  return finiteNumber(current.value);
}

/** Aave health factor is collateral times the collateral factor, divided by debt. A uniform stock drop scales it by (1 - drop). */
export function loanFromAavePosition(value: unknown): { loan: PricedLoan | null; unpriced: boolean } {
  if (!value || typeof value !== "object") return { loan: null, unpriced: false };
  const row = value as {
    healthFactor?: { current?: unknown } | null;
    totalCollateral?: unknown;
    totalDebt?: unknown;
    spoke?: { name?: unknown } | null;
  };
  const spoke = typeof row.spoke?.name === "string" ? row.spoke.name : "";
  if (spoke && !/coinbase/i.test(spoke)) return { loan: null, unpriced: false };
  const collateral = aaveMoney(row.totalCollateral);
  const debt = aaveMoney(row.totalDebt);
  if (debt === null || !(debt > 0)) return { loan: null, unpriced: false };
  if (collateral === null || !(collateral > 0)) return { loan: null, unpriced: true };
  const health = finiteNumber(row.healthFactor?.current);
  if (health === null || !(health > 0)) return { loan: null, unpriced: true };
  if (health < 1) return { loan: { collateralUsd: collateral, cushion: 0, alreadyPast: true }, unpriced: false };
  return { loan: { collateralUsd: collateral, cushion: 1 - 1 / health, alreadyPast: false }, unpriced: false };
}

export function loansFromAavePositions(positions: readonly unknown[]): { loans: PricedLoan[]; unpricedLoanCount: number } {
  const loans: PricedLoan[] = [];
  let unpricedLoanCount = 0;
  for (const position of positions) {
    const list = Array.isArray(position) ? position : [position];
    const onSpoke = list.filter((item) => {
      if (!item || typeof item !== "object") return false;
      const name = (item as { spoke?: { name?: unknown } }).spoke?.name;
      return typeof name !== "string" || /coinbase/i.test(name);
    });
    const chosen = onSpoke.length > 0 ? onSpoke : [];
    if (chosen.length === 0 && list.length > 0) continue;
    for (const item of chosen) {
      const read = loanFromAavePosition(item);
      if (read.loan) loans.push(read.loan);
      else if (read.unpriced) unpricedLoanCount += 1;
    }
  }
  return { loans, unpricedLoanCount };
}
