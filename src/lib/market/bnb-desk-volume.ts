import { asNonNegativeNumber, sumNullable } from "./numbers";
import type { SnapshotDeskConfig } from "./snapshot-desk-volume";
import { BNB_CHAIN_ID, BNB_CHAIN_NATIVE_ID } from "./types";

/** In-scope BNB Chain issuers. Ondo is confirmed on this chain. */
const BNB_ISSUER_LABELS: Record<string, string> = {
  xstocks: "xStocks",
  ondo: "Ondo",
  bstocks: "bStocks",
  paimon: "Paimon",
  colb: "Colb Finance",
  fourmeme: "Four.meme 4Stock",
};

export function bnbIssuerPresentation(slug: string): { label: string; official: boolean } {
  const key = slug.trim().toLowerCase();
  const label = BNB_ISSUER_LABELS[key];
  if (label) return { label, official: true };
  return { label: slug.trim() || key, official: false };
}

export const BNB_DESK: SnapshotDeskConfig = {
  file: "bnb.json",
  chainId: BNB_CHAIN_ID,
  nativeChainId: BNB_CHAIN_NATIVE_ID,
  chainSlug: "bsc",
  name: "BNB Chain",
  shortName: "BNB",
  sourceLabel: "BNB Chain desk snapshots",
  issuerPresentation: bnbIssuerPresentation,
};

export type BnbPriceSource = "dexscreener" | "geckoterminal";

/** One issuer's market value inside a lane. Missing on days written before the field existed. */
export interface BnbIssuerMarketValue {
  slug: string;
  label: string;
  official: boolean;
  marketValueUsd: number | null;
  /** Mints with a non-null market value. Null when that count was not stored. */
  marketValueMints: number | null;
}

/** Per-mint supply, price, and market value. Present only when the row stored the fields. */
export interface BnbSnapshotAssetMarketValue {
  address: string;
  symbol: string;
  supply: number | null;
  priceUsd: number | null;
  priceSource: BnbPriceSource | null;
  marketValueUsd: number | null;
}

/**
 * Closed-day BNB market value. Every dollar field is null when the snapshot
 * did not record it. Null is unknown, not $0.
 */
export interface BnbSnapshotMarketValue {
  publicEquityMarketValueUsd: number | null;
  etfIndexMarketValueUsd: number | null;
  privateMarketValueUsd: number | null;
  combinedMarketValueUsd: number | null;
  marketValueSource: string | null;
  marketValueReadAt: string | null;
  equity: BnbIssuerMarketValue[];
  etf: BnbIssuerMarketValue[];
  private: BnbIssuerMarketValue[];
  assets: BnbSnapshotAssetMarketValue[];
}

const MARKET_LANES = ["equity", "etf", "private"] as const;
type MarketLane = (typeof MARKET_LANES)[number];

function blankMarketValue(): BnbSnapshotMarketValue {
  return {
    publicEquityMarketValueUsd: null,
    etfIndexMarketValueUsd: null,
    privateMarketValueUsd: null,
    combinedMarketValueUsd: null,
    marketValueSource: null,
    marketValueReadAt: null,
    equity: [],
    etf: [],
    private: [],
    assets: [],
  };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function optionalUsd(record: Record<string, unknown>, key: string): number | null {
  if (!hasOwn(record, key)) return null;
  return asNonNegativeNumber(record[key]);
}

function optionalCount(record: Record<string, unknown>, key: string): number | null {
  if (!hasOwn(record, key)) return null;
  const parsed = asNonNegativeNumber(record[key]);
  if (parsed === null || !Number.isSafeInteger(parsed)) return null;
  return parsed;
}

function recordChainAllowed(record: Record<string, unknown>): boolean {
  const sources = record.sources;
  if (!sources || typeof sources !== "object") return true;
  const source = sources as { chainId?: unknown; chainSlug?: unknown };
  if (source.chainId !== undefined && source.chainId !== null && String(source.chainId) !== BNB_CHAIN_NATIVE_ID) {
    return false;
  }
  if (typeof source.chainSlug === "string" && source.chainSlug.trim()) {
    if (source.chainSlug.trim().toLowerCase() !== BNB_DESK.chainSlug) return false;
  }
  return true;
}

function readIssuerLane(value: unknown): BnbIssuerMarketValue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const cells: BnbIssuerMarketValue[] = [];
  for (const [slug, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const key = slug.trim().toLowerCase();
    if (!key) continue;
    const presentation = bnbIssuerPresentation(key);
    const row = raw as Record<string, unknown>;
    cells.push({
      slug: key,
      label: presentation.label,
      official: presentation.official,
      marketValueUsd: optionalUsd(row, "marketValueUsd"),
      marketValueMints: optionalCount(row, "marketValueMints"),
    });
  }
  return cells.sort((a, b) => a.slug.localeCompare(b.slug));
}

function readPriceSource(value: unknown): BnbPriceSource | null {
  return value === "dexscreener" || value === "geckoterminal" ? value : null;
}

function readAssetMarketValues(value: unknown): BnbSnapshotAssetMarketValue[] {
  if (!Array.isArray(value)) return [];
  const assets: BnbSnapshotAssetMarketValue[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const recorded = ["supply", "priceUsd", "priceSource", "marketValueUsd"].some((key) => hasOwn(row, key));
    if (!recorded) continue;
    const address = typeof row.address === "string" ? row.address.trim() : "";
    if (!address) continue;
    assets.push({
      address,
      symbol: typeof row.symbol === "string" ? row.symbol.trim() : "",
      supply: optionalUsd(row, "supply"),
      priceUsd: optionalUsd(row, "priceUsd"),
      priceSource: hasOwn(row, "priceSource") ? readPriceSource(row.priceSource) : null,
      marketValueUsd: optionalUsd(row, "marketValueUsd"),
    });
  }
  return assets;
}

/**
 * Market value on one BNB snapshot row. Absent fields stay null so a day
 * written before market value existed still loads, and the volume desk does
 * not treat that gap as $0.
 */
export function readBnbSnapshotMarketValue(record: unknown): BnbSnapshotMarketValue {
  if (!record || typeof record !== "object" || Array.isArray(record)) return blankMarketValue();
  const row = record as Record<string, unknown>;
  if (!recordChainAllowed(row)) return blankMarketValue();
  const publicEquityMarketValueUsd = optionalUsd(row, "publicEquityMarketValueUsd");
  const etfIndexMarketValueUsd = optionalUsd(row, "etfIndexMarketValueUsd");
  const privateMarketValueUsd = optionalUsd(row, "privateMarketValueUsd");
  const laneKeys = ["publicEquityMarketValueUsd", "etfIndexMarketValueUsd", "privateMarketValueUsd"] as const;
  const anyLane = laneKeys.some((key) => hasOwn(row, key));
  const combinedMarketValueUsd = hasOwn(row, "combinedMarketValueUsd")
    ? asNonNegativeNumber(row.combinedMarketValueUsd)
    : anyLane
      ? sumNullable([publicEquityMarketValueUsd, etfIndexMarketValueUsd, privateMarketValueUsd])
      : null;
  const issuers = row.issuersByLane;
  const lanes =
    issuers && typeof issuers === "object" && !Array.isArray(issuers) ? (issuers as Record<string, unknown>) : {};
  const byLane = {
    equity: readIssuerLane(lanes.equity),
    etf: readIssuerLane(lanes.etf),
    private: readIssuerLane(lanes.private),
  } satisfies Record<MarketLane, BnbIssuerMarketValue[]>;
  return {
    publicEquityMarketValueUsd,
    etfIndexMarketValueUsd,
    privateMarketValueUsd,
    combinedMarketValueUsd,
    marketValueSource: typeof row.marketValueSource === "string" && row.marketValueSource.trim() ? row.marketValueSource : null,
    marketValueReadAt: typeof row.marketValueReadAt === "string" && row.marketValueReadAt.trim() ? row.marketValueReadAt : null,
    equity: byLane.equity,
    etf: byLane.etf,
    private: byLane.private,
    assets: readAssetMarketValues(row.assets),
  };
}

/** One parsed market-value view per snapshot record. A bad record is all nulls, not a throw. */
export function readBnbSnapshotMarketValues(payload: unknown): BnbSnapshotMarketValue[] {
  if (!payload || typeof payload !== "object") return [];
  const records = (payload as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  return records.map((record) => readBnbSnapshotMarketValue(record));
}
