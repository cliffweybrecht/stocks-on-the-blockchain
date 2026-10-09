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
