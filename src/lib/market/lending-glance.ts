import { formatUsdCompact } from "./format";
import { collateralAtRisk, LENDING_PAST_LIMIT_USD, majoritySafeUntilPct, poolBreachDropPct, riskSentence } from "./lending-health";
import { classifyLendingSymbol } from "./lending-stocks";
import {
  aggregateLendingTotals,
  formatLendingCapturedAt,
  formatLendingFractionPct,
  formatLtvPerHundred,
  groupLendingRows,
  lendingUtilization,
  type LendingAsset,
  type LendingBorrowEstimate,
  type LendingDaySnapshot,
  type LendingHealthBand,
  type LendingRow,
  type LendingTotals,
} from "./lending-snapshot";

/** A dollar pool at or above this is "filling up", when the borrow book is material. */
export const LENDING_FILLING_UTIL = 0.9;
/** Day-over-day utilization increase, as a fraction, that counts as a jump. */
export const LENDING_FILLING_UTIL_JUMP = 0.1;
/** Day-over-day borrow-APY increase, as a fraction, that counts as a jump. */
export const LENDING_FILLING_APY_JUMP = 0.01;
/** Borrows under this do not set the glance or a badge. */
export const LENDING_FILLING_MIN_BORROWED_USD = 25_000;
export const LENDING_DROP_FRACTIONS = [0.1, 0.2, 0.3, 0.5] as const;

/** Half a cent. Exact equality stays inside the limit; float dust does not count as a breach. */
const PAST_LIMIT_USD = LENDING_PAST_LIMIT_USD;

export type LendingDropFraction = (typeof LENDING_DROP_FRACTIONS)[number];

export interface LendingSimpleBadge {
  venueId: string;
  kind: "nearly-full" | "rate-jumped";
  label: "Nearly full" | "Rate jumped";
  text: string;
}

export interface LendingStaleNote {
  venueId: string;
  label: "Stale";
  text: string;
}

export interface LendingFillingFlag {
  venueId: string;
  venue: string;
  chainId: string;
  chainLabel: string;
  kind: "full" | "utilization-jump" | "rate-jump";
  /** Short badge. */
  text: string;
  /** Clause that can lead the glance sentence. */
  clause: string;
}

export interface LendingGlanceCopy {
  sentence: string;
  tone: "calm" | "stretched" | "unknown";
  /** One plain line beside Calm or Stretched. */
  toneLine: string;
}

export interface LendingDropScope {
  id: string;
  kind: "all" | "venue" | "stock";
  label: string;
}

export interface LendingDropAnswer {
  sentence: string;
  method: string;
  /** One line naming which venues use each loan and which use a pool estimate. Null on older snapshots. */
  methodLine: string | null;
  /** Pre-drop stock dollars past the line. 0 when measured and inside. Null when it cannot be figured. */
  collateralAtRiskUsd: number | null;
}

export interface LendingDepthHistoryPoint {
  date: string;
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
  utilization: number | null;
  borrowApy: number | null;
}

export interface LendingDepthAsset {
  symbol: string;
  ticker: string;
  wrapper: string;
  address: string;
  collateralUsd: number | null;
  collateralTokens: number | null;
  maxLtv: number | null;
  priceNote: string | null;
}

export interface LendingDepthVenue {
  id: string;
  label: string;
  venue: string;
  chainId: string;
  chainLabel: string;
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
  utilization: number | null;
  borrowApy: number | null;
  borrowApyMin: number | null;
  borrowApyMax: number | null;
  stockBorrowedUsd: number | null;
  lendSupplyUsd: number | null;
  source: string;
  note: string | null;
  estimateLabel: string | null;
  ltvLabel: string | null;
  positionsNote: string;
  assets: LendingDepthAsset[];
  history: LendingDepthHistoryPoint[];
}

export interface LendingDepthChain {
  chainId: string;
  chainLabel: string;
  collateralUsd: number | null;
  stableBorrowedUsd: number | null;
  utilization: number | null;
  borrowApy: number | null;
  history: LendingDepthHistoryPoint[];
}

export interface LendingDepthStockPlace {
  venueId: string;
  venueLabel: string;
  chainId: string;
  chainLabel: string;
  symbol: string;
  wrapper: string;
  address: string;
  collateralUsd: number | null;
  collateralTokens: number | null;
  maxLtv: number | null;
  borrowApy: number | null;
  utilization: number | null;
  source: string;
  priceNote: string | null;
}

export interface LendingDepthStock {
  ticker: string;
  collateralUsd: number | null;
  places: LendingDepthStockPlace[];
}

export interface LendingDepth {
  chains: LendingDepthChain[];
  venues: LendingDepthVenue[];
  stocks: LendingDepthStock[];
}

const WEEKEND_ORACLE =
  "Chainlink stock prices go quiet from Friday 8:00 PM Eastern to Sunday 8:00 PM Eastern, about 60 hours. A move over the weekend shows up on Monday.";

const DROP_METHOD =
  "This treats each pool as one loan. The limit is the collateral-weighted borrowing limit published for the tokens in scope. After the drop, the loan is past the line when the dollars borrowed are more than the remaining stock times that limit. A stock is given its share of the venue's borrows, in proportion to its share of that venue's stock. This snapshot stores pool totals and each token deposited, not each person's loan, so one loan can be tighter than the pool.";

export function lendingDropKey(drop: LendingDropFraction): string {
  return String(drop);
}

export function lendingDropPercentLabel(drop: number): string {
  return `${Math.round(drop * 100)}%`;
}

function materialBorrow(row: Pick<LendingRow, "stableBorrowedUsd" | "borrowEstimate">): boolean {
  return row.borrowEstimate == null && (row.stableBorrowedUsd ?? 0) >= LENDING_FILLING_MIN_BORROWED_USD;
}

function pointsLabel(delta: number): string {
  const rounded = Math.round(delta * 1000) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function lendingVenueLabel(row: Pick<LendingRow, "venue" | "chainLabel">, rows: readonly Pick<LendingRow, "venue">[]): string {
  const twins = rows.filter((other) => other.venue === row.venue).length;
  return twins > 1 ? `${row.venue} on ${row.chainLabel}` : row.venue;
}

export function lendingFillingFlags(rows: readonly LendingRow[], previous: readonly LendingRow[] | null): LendingFillingFlag[] {
  const prior = new Map((previous ?? []).map((row) => [row.id, row]));
  const flags: LendingFillingFlag[] = [];
  for (const row of rows) {
    if (!materialBorrow(row)) continue;
    const label = lendingVenueLabel(row, rows);
    if (row.utilization !== null && row.utilization >= LENDING_FILLING_UTIL) {
      flags.push({
        venueId: row.id,
        venue: row.venue,
        chainId: row.chainId,
        chainLabel: row.chainLabel,
        kind: "full",
        text: `${label} · ${formatLendingFractionPct(row.utilization)} full`,
        clause: `${label}'s dollar pool is ${formatLendingFractionPct(row.utilization)} full`,
      });
      continue;
    }
    const before = prior.get(row.id);
    if (!before || before.borrowEstimate) continue;
    if (
      row.utilization !== null &&
      before.utilization !== null &&
      row.utilization - before.utilization >= LENDING_FILLING_UTIL_JUMP
    ) {
      const points = pointsLabel(row.utilization - before.utilization);
      flags.push({
        venueId: row.id,
        venue: row.venue,
        chainId: row.chainId,
        chainLabel: row.chainLabel,
        kind: "utilization-jump",
        text: `${label} · ${points} points fuller`,
        clause: `${label}'s dollar pool is ${points} points fuller than yesterday`,
      });
      continue;
    }
    if (row.borrowApy !== null && before.borrowApy !== null && row.borrowApy - before.borrowApy >= LENDING_FILLING_APY_JUMP) {
      const points = pointsLabel(row.borrowApy - before.borrowApy);
      flags.push({
        venueId: row.id,
        venue: row.venue,
        chainId: row.chainId,
        chainLabel: row.chainLabel,
        kind: "rate-jump",
        text: `${label} · rate up ${points} points`,
        clause: `${label}'s yearly cost is up ${points} points since yesterday`,
      });
    }
  }
  const rank = { full: 0, "utilization-jump": 1, "rate-jump": 2 };
  const score = (flag: LendingFillingFlag) => {
    const row = rows.find((item) => item.id === flag.venueId);
    if (flag.kind === "rate-jump") return row?.borrowApy ?? 0;
    return row?.utilization ?? 0;
  };
  flags.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || score(b) - score(a) || a.venue.localeCompare(b.venue) || a.chainLabel.localeCompare(b.chainLabel),
  );
  return flags;
}

const NO_LEND_SUPPLY_PREFIX = ["jupiter", "venus"] as const;

/** How full is stable dollars borrowed divided by dollars supplied to lend. Jupiter and Venus do not publish that supply. */
export function lendingHowFull(
  row: Pick<LendingRow, "id" | "stableBorrowedUsd" | "lendSupplyUsd" | "borrowEstimate">,
): number | null {
  if (row.borrowEstimate) return null;
  if (NO_LEND_SUPPLY_PREFIX.some((prefix) => row.id.startsWith(prefix))) return null;
  return lendingUtilization(row.stableBorrowedUsd, row.lendSupplyUsd);
}

/**
 * Nearly full: how-full is at least 90% and the borrow book is big enough to matter.
 * Rate jumped: yearly cost rose by at least one point since the prior snapshot.
 * Both use only the stored snapshots. A missing prior rate stays unlabeled.
 */
export function lendingSimpleBadges(rows: readonly LendingRow[], previous: readonly LendingRow[] | null): LendingSimpleBadge[] {
  const prior = new Map((previous ?? []).map((row) => [row.id, row]));
  const badges: LendingSimpleBadge[] = [];
  for (const row of rows) {
    if ((row.stableBorrowedUsd ?? 0) < LENDING_FILLING_MIN_BORROWED_USD) continue;
    const label = lendingVenueLabel(row, rows);
    const howFull = lendingHowFull(row);
    if (howFull !== null && howFull >= LENDING_FILLING_UTIL) {
      badges.push({
        venueId: row.id,
        kind: "nearly-full",
        label: "Nearly full",
        text: `${label} is ${formatLendingFractionPct(howFull)} full.`,
      });
    }
    const before = prior.get(row.id);
    if (!before || before.borrowEstimate || row.borrowEstimate) continue;
    if (row.borrowApy === null || before.borrowApy === null) continue;
    const jump = row.borrowApy - before.borrowApy;
    if (jump >= LENDING_FILLING_APY_JUMP) {
      badges.push({
        venueId: row.id,
        kind: "rate-jumped",
        label: "Rate jumped",
        text: `${label} yearly cost rose by ${pointsLabel(jump)} points since the last snapshot.`,
      });
    }
  }
  badges.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "nearly-full" ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
  return badges;
}

export function borrowEstimateIsStale(estimate: Pick<LendingBorrowEstimate, "method" | "stale"> | null | undefined): boolean {
  if (!estimate) return false;
  return estimate.stale === true || /did not refresh/i.test(estimate.method);
}

export function lendingStaleNotes(rows: readonly LendingRow[]): LendingStaleNote[] {
  const notes: LendingStaleNote[] = [];
  for (const row of rows) {
    const estimate = row.borrowEstimate;
    if (!estimate || !borrowEstimateIsStale(estimate)) continue;
    notes.push({
      venueId: row.id,
      label: "Stale",
      text: `${lendingVenueLabel(row, rows)} borrowed dollars are a pro-rata estimate last measured ${formatLendingCapturedAt(estimate.asOf)}. The new scan did not finish.`,
    });
  }
  return notes;
}

function marketSentence(collateral: number | null, borrowed: number | null): string | null {
  if (collateral !== null && borrowed !== null) {
    return `${formatUsdCompact(collateral)} of stock tokens are locked and ${formatUsdCompact(borrowed)} is borrowed against them.`;
  }
  if (collateral !== null) return `${formatUsdCompact(collateral)} of stock tokens are locked. Borrowed dollars are not reported.`;
  if (borrowed !== null) return `${formatUsdCompact(borrowed)} is borrowed. Stock locked is not reported.`;
  return null;
}

function standoutSentence(flag: LendingFillingFlag, rows: readonly LendingRow[]): string {
  const row = rows.find((item) => item.id === flag.venueId);
  const label = row ? lendingVenueLabel(row, rows) : flag.venue;
  if (flag.kind === "full") return `The busiest pool, ${label}, is ${formatLendingFractionPct(row?.utilization)} full.`;
  const clause = `${flag.clause.charAt(0).toUpperCase()}${flag.clause.slice(1)}`;
  return clause.endsWith(".") ? clause : `${clause}.`;
}

function toneLine(flag: LendingFillingFlag | undefined, tone: LendingGlanceCopy["tone"]): string {
  if (tone === "unknown") return "There is no lending snapshot yet.";
  if (tone === "calm") return "The bigger pools still have room, and none jumped since yesterday.";
  if (flag?.kind === "full") return "A bigger pool is at least 90% full.";
  if (flag?.kind === "utilization-jump") return "A bigger pool filled up sharply since yesterday.";
  return "A bigger pool's yearly cost jumped since yesterday.";
}

export function lendingGlance(rows: readonly LendingRow[], totals: LendingTotals, flags: readonly LendingFillingFlag[]): LendingGlanceCopy {
  const market = marketSentence(totals.collateralUsd, totals.stableBorrowedUsd);
  const lead = flags.find((flag) => flag.kind === "full") ?? flags[0];
  if (!market && !lead) return { sentence: "No lending snapshot yet.", tone: "unknown", toneLine: toneLine(undefined, "unknown") };
  if (lead) {
    const standout = standoutSentence(lead, rows);
    return {
      sentence: market ? `${market} ${standout}` : standout,
      tone: "stretched",
      toneLine: toneLine(lead, "stretched"),
    };
  }
  return {
    sentence: market ? `${market} The bigger pools still have room.` : "No lending snapshot yet.",
    tone: market ? "calm" : "unknown",
    toneLine: toneLine(undefined, market ? "calm" : "unknown"),
  };
}

interface RatedBook {
  collateralUsd: number;
  maxLtv: number;
}

function ratedBook(assets: readonly LendingAsset[]): RatedBook | null {
  let weight = 0;
  let weighted = 0;
  for (const asset of assets) {
    if (asset.collateralUsd === null || !(asset.collateralUsd > 0)) continue;
    if (asset.maxLtv === null || !(asset.maxLtv > 0) || asset.maxLtv > 1.05) continue;
    weight += asset.collateralUsd;
    weighted += asset.collateralUsd * asset.maxLtv;
  }
  if (!(weight > 0)) return null;
  return { collateralUsd: weight, maxLtv: weighted / weight };
}

interface DropSlice {
  collateralUsd: number;
  borrowedUsd: number;
  maxLtv: number;
  estimate: boolean;
}

interface DropPieces {
  slices: DropSlice[];
  exclusions: string[];
  notes: string[];
  known: boolean;
}

function emptyPieces(known: boolean): DropPieces {
  return { slices: [], exclusions: [], notes: [], known };
}

function pastLimit(slice: DropSlice, drop: number): boolean {
  const limit = slice.collateralUsd * (1 - drop) * slice.maxLtv;
  return slice.borrowedUsd - limit > PAST_LIMIT_USD;
}

function venuePieces(row: LendingRow, assets: readonly LendingAsset[], label: string): DropPieces {
  const pieces = emptyPieces(true);
  if (row.collateralUsd === null || row.stableBorrowedUsd === null) {
    pieces.exclusions.push(`${label} is missing a dollar amount, so it is left out.`);
    return pieces;
  }
  if (!(row.collateralUsd > 0) && !(row.stableBorrowedUsd > 0)) return pieces;
  const rated = ratedBook(assets);
  if (!rated) {
    pieces.exclusions.push(`${label} did not publish a borrowing limit in this snapshot, so it is left out.`);
    return pieces;
  }
  const borrowed = row.stableBorrowedUsd * (rated.collateralUsd / row.collateralUsd);
  if (!Number.isFinite(borrowed)) {
    pieces.exclusions.push(`${label} is missing a dollar amount, so it is left out.`);
    return pieces;
  }
  pieces.slices.push({
    collateralUsd: rated.collateralUsd,
    borrowedUsd: borrowed,
    maxLtv: rated.maxLtv,
    estimate: row.borrowEstimate != null,
  });
  return pieces;
}

function stockPieces(rows: readonly LendingRow[], ticker: string): DropPieces {
  const pieces = emptyPieces(false);
  for (const row of rows) {
    const assets = (row.assets ?? []).filter((asset) => classifyLendingSymbol(asset.symbol, row.chainId).ticker === ticker);
    if (assets.length === 0) continue;
    pieces.known = true;
    const label = `${ticker} on ${lendingVenueLabel(row, rows)}`;
    if (assets.some((asset) => asset.collateralUsd === null)) {
      pieces.notes.push(`${label} has a token with no dollar amount, so only the priced part is figured.`);
    }
    const part = venuePieces(row, assets, label);
    if (row.collateralUsd === null || row.stableBorrowedUsd === null || !(row.collateralUsd > 0)) {
      pieces.exclusions.push(...part.exclusions);
      continue;
    }
    const stockUsd = assets.reduce((sum, asset) => sum + (asset.collateralUsd ?? 0), 0);
    if (!(stockUsd > 0)) {
      pieces.exclusions.push(...part.exclusions);
      continue;
    }
    for (const slice of part.slices) {
      pieces.slices.push({ ...slice, borrowedUsd: row.stableBorrowedUsd * (slice.collateralUsd / row.collateralUsd) });
    }
    pieces.exclusions.push(...part.exclusions);
  }
  return pieces;
}

function piecesForScope(rows: readonly LendingRow[], scopeId: string): DropPieces {
  if (scopeId === "all") {
    const pieces = emptyPieces(true);
    for (const row of rows) {
      const part = venuePieces(row, row.assets ?? [], lendingVenueLabel(row, rows));
      pieces.slices.push(...part.slices);
      pieces.exclusions.push(...part.exclusions);
    }
    return pieces;
  }
  if (scopeId.startsWith("stock:")) return stockPieces(rows, scopeId.slice("stock:".length));
  const row = rows.find((item) => item.id === scopeId);
  if (!row) return emptyPieces(false);
  return venuePieces(row, row.assets ?? [], lendingVenueLabel(row, rows));
}

function methodText(pieces: DropPieces): string {
  const estimate = pieces.slices.some((slice) => slice.estimate)
    ? "Venus borrowed dollars are an estimate, not a published pool total."
    : "";
  return [DROP_METHOD, estimate, ...pieces.notes, ...pieces.exclusions, WEEKEND_ORACLE].filter(Boolean).join(" ");
}

function usesPositions(row: LendingRow): boolean {
  const health = row.loanHealth;
  return health?.method === "positions" && health.collateralCoveredUsd !== null;
}

function positionGap(row: LendingRow): boolean {
  const health = row.loanHealth;
  if (!health || health.method !== "positions") return false;
  const unpriced = health.unpricedLoanCount ?? 0;
  const priced = health.loanCount ?? 0;
  if (!(unpriced > 0)) return false;
  return priced / (priced + unpriced) < 0.9;
}

function dropSentence(pct: string, atRisk: number, pieces: DropPieces, gap: boolean): string {
  if (atRisk > 0) {
    const noun = gap ? "priced stock" : "stock";
    return `A ${pct} drop means about ${formatUsdCompact(atRisk)} of ${noun} could be sold off to repay loans.`;
  }
  if (gap) return `A ${pct} drop stays inside the borrowing limit for loans that had a price. Loans with no price are left out.`;
  const where = pieces.exclusions.length > 0 ? " where a limit is published" : "";
  return `A ${pct} drop stays inside the borrowing limit${where}. No stock would be sold off to repay loans.`;
}

function unfiguredSentence(pct: string, pieces: DropPieces): string {
  const missingDollars = pieces.exclusions.some((line) => line.includes("missing a dollar amount"));
  const missingLimit = pieces.exclusions.some((line) => line.includes("borrowing limit"));
  if (missingDollars && !missingLimit) return `A dollar amount is missing, so a ${pct} drop is not figured.`;
  return `No borrowing limit is published here, so a ${pct} drop is not figured.`;
}

function answerFromPieces(pieces: DropPieces, drop: number, method: string, methodLine: string | null, gap: boolean): LendingDropAnswer {
  const pct = lendingDropPercentLabel(drop);
  if (!pieces.known) {
    return { sentence: "That choice is not in this snapshot.", method, methodLine, collateralAtRiskUsd: null };
  }
  if (pieces.slices.length === 0) {
    return { sentence: unfiguredSentence(pct, pieces), method, methodLine, collateralAtRiskUsd: null };
  }
  let atRisk = 0;
  for (const slice of pieces.slices) {
    if (pastLimit(slice, drop)) atRisk += slice.collateralUsd;
  }
  return { sentence: dropSentence(pct, atRisk, pieces, gap), method, methodLine, collateralAtRiskUsd: atRisk };
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function methodLineFor(rows: readonly LendingRow[], scopeId: string): string | null {
  if (scopeId.startsWith("stock:")) return "This stock uses a pool estimate.";
  const scoped = scopeId === "all" ? rows : rows.filter((row) => row.id === scopeId);
  const labeled = scoped.some((row) => row.loanHealth);
  if (!labeled) return null;
  const positioned: string[] = [];
  const pooled: string[] = [];
  const seen = new Set<string>();
  for (const row of scoped) {
    if (seen.has(row.venue)) continue;
    const same = scoped.filter((other) => other.venue === row.venue);
    seen.add(row.venue);
    const positions = same.filter((other) => other.loanHealth?.method === "positions").length;
    const pools = same.filter((other) => other.loanHealth?.method === "pool").length;
    if (positions > 0 && pools === 0) positioned.push(row.venue);
    else if (pools > 0 && positions === 0) pooled.push(row.venue);
    else {
      for (const other of same) {
        const label = lendingVenueLabel(other, rows);
        if (other.loanHealth?.method === "positions") positioned.push(label);
        else pooled.push(label);
      }
    }
  }
  const parts: string[] = [];
  if (positioned.length > 0) parts.push(`${joinNames(positioned)} ${positioned.length > 1 ? "use" : "uses"} each loan`);
  if (pooled.length > 0) parts.push(`${joinNames(pooled)} ${pooled.length > 1 ? "use" : "uses"} a pool estimate`);
  if (parts.length === 0) return null;
  return `${parts.join(". ")}.`;
}

function venueHealthLine(row: LendingRow, rows: readonly LendingRow[]): string {
  const label = lendingVenueLabel(row, rows);
  const health = row.loanHealth;
  if (health?.method === "positions") {
    const count = health.loanCount ?? 0;
    const priced = health.collateralCoveredUsd === null ? "" : `, ${formatUsdCompact(health.collateralCoveredUsd)} of stock priced`;
    const gap = (health.unpricedLoanCount ?? 0) > 0 ? ` ${health.unpricedLoanCount} loans had no collateral price and are left out.` : "";
    return `${label} uses each loan (${count} loans${priced}), read ${formatLendingCapturedAt(health.asOf)} from ${sourceLabel(health.source)}.${gap}`;
  }
  const why = health?.fallback ?? "Each loan was not in this snapshot.";
  return `${label} uses the pool estimate. ${why}`;
}

function healthMethod(rows: readonly LendingRow[], scoped: readonly LendingRow[], pieces: DropPieces, usedPositions: boolean, stock: boolean): string {
  const estimate = scoped.some((row) => row.borrowEstimate) ? "Venus borrowed dollars are an estimate, not a published pool total." : "";
  const how = stock
    ? "This stock uses the pool estimate. Loan health is stored for the whole venue, not one ticker. A pool estimate treats the pool as one loan and uses the collateral-weighted borrowing limit."
    : [
        usedPositions
          ? "Each counted loan is past the line when this drop reaches its liquidation price. The dollars are that loan's stock before the drop."
          : "",
        pieces.slices.length > 0 || !usedPositions
          ? "A pool estimate treats the whole pool as one loan and uses the collateral-weighted borrowing limit."
          : "",
        ...scoped.map((row) => venueHealthLine(row, rows)),
      ]
        .filter(Boolean)
        .join(" ");
  return [how, estimate, ...pieces.notes, ...pieces.exclusions, WEEKEND_ORACLE].filter(Boolean).join(" ");
}

function poolBands(row: LendingRow, rows: readonly LendingRow[]): LendingHealthBand[] {
  const pieces = venuePieces(row, row.assets ?? [], lendingVenueLabel(row, rows));
  return pieces.slices.map((slice) => ({
    dropPct: poolBreachDropPct(slice.collateralUsd, slice.borrowedUsd, slice.maxLtv),
    collateralUsd: slice.collateralUsd,
  }));
}

/** One plain line for the whole book. Position buckets where a venue published loans, otherwise the pool estimate. */
export function lendingRiskLine(rows: readonly LendingRow[]): string {
  const bands: LendingHealthBand[] = [];
  for (const row of rows) {
    if (usesPositions(row) && row.loanHealth) {
      bands.push(...row.loanHealth.bands);
      continue;
    }
    bands.push(...poolBands(row, rows));
  }
  return riskSentence(majoritySafeUntilPct(bands));
}

export function lendingDropAnswer(rows: readonly LendingRow[], scopeId: string, drop: number): LendingDropAnswer {
  const scoped = scopeId === "all" ? rows : scopeId.startsWith("stock:") ? rows : rows.filter((row) => row.id === scopeId);
  const labeled = scoped.some((row) => row.loanHealth);
  if (!labeled) return legacyDropAnswer(rows, scopeId, drop);
  return healthDropAnswer(rows, scopeId, drop);
}

function legacyDropAnswer(rows: readonly LendingRow[], scopeId: string, drop: number): LendingDropAnswer {
  const pieces = piecesForScope(rows, scopeId);
  return answerFromPieces(pieces, drop, methodText(pieces), null, false);
}

function healthDropAnswer(rows: readonly LendingRow[], scopeId: string, drop: number): LendingDropAnswer {
  const methodLine = methodLineFor(rows, scopeId);
  if (scopeId.startsWith("stock:")) {
    const pieces = stockPieces(rows, scopeId.slice("stock:".length));
    const scoped = rows.filter((row) => (row.assets ?? []).some((asset) => classifyLendingSymbol(asset.symbol, row.chainId).ticker === scopeId.slice("stock:".length)));
    return answerFromPieces(pieces, drop, healthMethod(rows, scoped, pieces, false, true), methodLine, false);
  }
  const selected = scopeId === "all" ? [...rows] : rows.filter((row) => row.id === scopeId);
  if (scopeId !== "all" && selected.length === 0) {
    return {
      sentence: "That choice is not in this snapshot.",
      method: WEEKEND_ORACLE,
      methodLine,
      collateralAtRiskUsd: null,
    };
  }
  const positionRows = selected.filter(usesPositions);
  const pieces = emptyPieces(true);
  for (const row of selected) {
    if (usesPositions(row)) continue;
    const part = venuePieces(row, row.assets ?? [], lendingVenueLabel(row, selected));
    pieces.slices.push(...part.slices);
    pieces.exclusions.push(...part.exclusions);
  }
  const gap = positionRows.some(positionGap);
  if (positionRows.length === 0 && pieces.slices.length === 0) {
    return {
      sentence: unfiguredSentence(lendingDropPercentLabel(drop), pieces),
      method: healthMethod(rows, selected, pieces, false, false),
      methodLine,
      collateralAtRiskUsd: null,
    };
  }
  let atRisk = 0;
  for (const row of positionRows) {
    if (!row.loanHealth) continue;
    atRisk += collateralAtRisk(row.loanHealth.bands, drop);
  }
  for (const slice of pieces.slices) {
    if (pastLimit(slice, drop)) atRisk += slice.collateralUsd;
  }
  return {
    sentence: dropSentence(lendingDropPercentLabel(drop), atRisk, pieces, gap),
    method: healthMethod(rows, selected, pieces, positionRows.length > 0, false),
    methodLine,
    collateralAtRiskUsd: atRisk,
  };
}

export function lendingDropScopes(rows: readonly LendingRow[]): LendingDropScope[] {
  const scopes: LendingDropScope[] = [{ id: "all", kind: "all", label: "Everything" }];
  const venues = [...rows].sort((a, b) => (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1) || a.venue.localeCompare(b.venue));
  for (const row of venues) {
    if (row.collateralUsd === null && row.stableBorrowedUsd === null) continue;
    scopes.push({ id: row.id, kind: "venue", label: lendingVenueLabel(row, rows) });
  }
  const stocks = new Map<string, number | null>();
  for (const row of rows) {
    for (const asset of row.assets ?? []) {
      const ticker = classifyLendingSymbol(asset.symbol, row.chainId).ticker;
      const current = stocks.get(ticker);
      if (asset.collateralUsd === null) {
        if (current === undefined) stocks.set(ticker, null);
        continue;
      }
      stocks.set(ticker, (current ?? 0) + asset.collateralUsd);
    }
  }
  const tickers = [...stocks.entries()]
    .filter((entry): entry is [string, number] => entry[1] !== null && entry[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [ticker] of tickers) scopes.push({ id: `stock:${ticker}`, kind: "stock", label: ticker });
  return scopes;
}

export function lendingDropTable(
  rows: readonly LendingRow[],
  scopes: readonly LendingDropScope[],
): Record<string, Record<string, LendingDropAnswer>> {
  const table: Record<string, Record<string, LendingDropAnswer>> = {};
  for (const scope of scopes) {
    const answers: Record<string, LendingDropAnswer> = {};
    for (const drop of LENDING_DROP_FRACTIONS) answers[lendingDropKey(drop)] = lendingDropAnswer(rows, scope.id, drop);
    table[scope.id] = answers;
  }
  return table;
}

export function lendingPreviousRows(days: readonly LendingDaySnapshot[]): LendingRow[] | null {
  const sorted = sortedDays(days);
  if (sorted.length < 2) return null;
  return sorted[sorted.length - 2]?.rows ?? null;
}

function sortedDays(days: readonly LendingDaySnapshot[]): LendingDaySnapshot[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date) || a.capturedAt.localeCompare(b.capturedAt));
}

function historyPoint(date: string, rows: readonly LendingRow[]): LendingDepthHistoryPoint {
  const totals = aggregateLendingTotals(rows);
  const only = rows.length === 1 ? rows[0] : undefined;
  return {
    date,
    collateralUsd: totals.collateralUsd,
    stableBorrowedUsd: totals.stableBorrowedUsd,
    // One venue keeps the fullness it reported. A chain total is borrowed divided by that chain's own lend supply.
    utilization: only ? only.utilization : totals.utilization,
    borrowApy: totals.borrowApy,
  };
}

function sourceLabel(source: string): string {
  try {
    return new URL(source).host.replace(/^www\./, "");
  } catch {
    return source || "the snapshot";
  }
}

function ltvLabel(assets: readonly LendingAsset[]): string | null {
  const values = assets
    .map((asset) => asset.maxLtv)
    .filter((value): value is number => value !== null && value > 0 && value <= 1.05);
  if (values.length === 0) return null;
  const low = formatLtvPerHundred(Math.min(...values));
  const high = formatLtvPerHundred(Math.max(...values));
  if (low === high) return `Up to ${low} for every $100 of stock.`;
  return `Up to ${low}–${high} for every $100 of stock, depending on the token.`;
}

function listsEachLoan(row: Pick<LendingRow, "id" | "venue">): boolean {
  return /morpho|kamino|aave/i.test(`${row.id} ${row.venue}`);
}

function positionsNote(row: LendingRow): string {
  const health = row.loanHealth;
  if (health?.method === "positions") {
    const count = health.loanCount ?? 0;
    const priced = health.collateralCoveredUsd === null ? "" : `, ${formatUsdCompact(health.collateralCoveredUsd)} of stock priced`;
    const gap = (health.unpricedLoanCount ?? 0) > 0 ? ` ${health.unpricedLoanCount} loans had no collateral price and are left out.` : "";
    return `${row.venue} publishes each loan. This snapshot keeps ${count} loans${priced}, read ${formatLendingCapturedAt(health.asOf)} from ${sourceLabel(health.source)}, not each wallet.${gap}`;
  }
  if (health?.method === "pool") {
    const why = health.fallback ?? "Each loan was not available.";
    return `${row.venue} uses the pool estimate. ${why}`;
  }
  const who = listsEachLoan(row) ? `${row.venue} can list each loan. ` : "";
  return `${who}This snapshot stores the pool total and each token deposited, not each person's loan.`;
}

function depthAsset(asset: LendingAsset, chainId: string): LendingDepthAsset {
  const classified = classifyLendingSymbol(asset.symbol, chainId);
  return {
    symbol: asset.symbol,
    ticker: classified.ticker,
    wrapper: classified.wrapper,
    address: asset.address,
    collateralUsd: asset.collateralUsd,
    collateralTokens: asset.collateralTokens,
    maxLtv: asset.maxLtv,
    priceNote: asset.collateralUsd === null ? asset.priceNote ?? null : null,
  };
}

function compareAsset(a: LendingDepthAsset, b: LendingDepthAsset): number {
  if (a.collateralUsd === null && b.collateralUsd === null) return a.symbol.localeCompare(b.symbol);
  if (a.collateralUsd === null) return 1;
  if (b.collateralUsd === null) return -1;
  return b.collateralUsd - a.collateralUsd || a.symbol.localeCompare(b.symbol);
}

export function buildLendingDepth(days: readonly LendingDaySnapshot[]): LendingDepth {
  const sorted = sortedDays(days);
  const latest = sorted[sorted.length - 1];
  if (!latest) return { chains: [], venues: [], stocks: [] };
  const labels = new Map(latest.rows.map((row) => [row.id, lendingVenueLabel(row, latest.rows)]));
  const venueHistory = new Map<string, LendingDepthHistoryPoint[]>();
  const chainHistory = new Map<string, LendingDepthHistoryPoint[]>();
  for (const day of sorted) {
    for (const row of day.rows) {
      const list = venueHistory.get(row.id) ?? [];
      list.push(historyPoint(day.date, [row]));
      venueHistory.set(row.id, list);
    }
    for (const chain of groupLendingRows(day.rows)) {
      const list = chainHistory.get(chain.chainId) ?? [];
      list.push(historyPoint(day.date, chain.rows));
      chainHistory.set(chain.chainId, list);
    }
  }
  const chains: LendingDepthChain[] = groupLendingRows(latest.rows).map((chain) => ({
    chainId: chain.chainId,
    chainLabel: chain.chainLabel,
    collateralUsd: chain.totals.collateralUsd,
    stableBorrowedUsd: chain.totals.stableBorrowedUsd,
    utilization: chain.totals.utilization,
    borrowApy: chain.totals.borrowApy,
    history: chainHistory.get(chain.chainId) ?? [],
  }));
  const venues: LendingDepthVenue[] = [];
  for (const chain of groupLendingRows(latest.rows)) {
    for (const row of chain.rows) {
      const assets = (row.assets ?? []).map((asset) => depthAsset(asset, row.chainId)).sort(compareAsset);
      const estimate = row.borrowEstimate;
      venues.push({
        id: row.id,
        label: labels.get(row.id) ?? row.venue,
        venue: row.venue,
        chainId: row.chainId,
        chainLabel: row.chainLabel,
        collateralUsd: row.collateralUsd,
        stableBorrowedUsd: row.stableBorrowedUsd,
        utilization: row.utilization,
        borrowApy: row.borrowApy,
        borrowApyMin: row.borrowApyMin,
        borrowApyMax: row.borrowApyMax,
        stockBorrowedUsd: row.stockBorrowedUsd,
        lendSupplyUsd: row.lendSupplyUsd,
        source: row.source,
        note: row.note ?? null,
        estimateLabel: estimate
          ? `${borrowEstimateIsStale(estimate) ? "Stale. " : ""}Borrowed dollars are a pro-rata estimate, measured ${formatLendingCapturedAt(estimate.asOf)}. ${estimate.method}${
              estimate.lowerBoundUsd === null ? "" : ` Lower bound ${formatUsdCompact(estimate.lowerBoundUsd)}.`
            }`
          : null,
        ltvLabel: ltvLabel(row.assets ?? []),
        positionsNote: positionsNote(row),
        assets,
        history: venueHistory.get(row.id) ?? [],
      });
    }
  }
  const stocks = new Map<string, LendingDepthStock>();
  for (const venue of venues) {
    for (const asset of venue.assets) {
      const stock = stocks.get(asset.ticker) ?? { ticker: asset.ticker, collateralUsd: null, places: [] };
      stock.places.push({
        venueId: venue.id,
        venueLabel: venue.label,
        chainId: venue.chainId,
        chainLabel: venue.chainLabel,
        symbol: asset.symbol,
        wrapper: asset.wrapper,
        address: asset.address,
        collateralUsd: asset.collateralUsd,
        collateralTokens: asset.collateralTokens,
        maxLtv: asset.maxLtv,
        borrowApy: venue.borrowApy,
        utilization: venue.utilization,
        source: venue.source,
        priceNote: asset.priceNote,
      });
      if (asset.collateralUsd !== null) stock.collateralUsd = (stock.collateralUsd ?? 0) + asset.collateralUsd;
      stocks.set(asset.ticker, stock);
    }
  }
  const stockList = [...stocks.values()];
  for (const stock of stockList) {
    stock.places.sort((a, b) => (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1) || a.venueLabel.localeCompare(b.venueLabel));
  }
  stockList.sort((a, b) => (b.collateralUsd ?? -1) - (a.collateralUsd ?? -1) || a.ticker.localeCompare(b.ticker));
  return { chains, venues, stocks: stockList };
}
