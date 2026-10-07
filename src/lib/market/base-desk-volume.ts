import { BASE_CHAIN_ID, BASE_CHAIN_NATIVE_ID } from "./types";
import type { SnapshotDeskConfig } from "./snapshot-desk-volume";

/** Confirmed Base issuers. Ondo is not a confirmed Base issuer and stays unofficial if a row appears. */
const BASE_ISSUER_LABELS: Record<string, string> = {
  coinbase: "Coinbase",
  st0x: "ST0x",
  centrifuge: "Centrifuge",
  dinari: "Dinari",
  backed: "Backed",
  anchored: "Anchored",
};

export function baseIssuerPresentation(slug: string): { label: string; official: boolean } {
  const key = slug.trim().toLowerCase();
  const label = BASE_ISSUER_LABELS[key];
  if (label) return { label, official: true };
  return { label: slug.trim() || key, official: false };
}

export const BASE_DESK: SnapshotDeskConfig = {
  file: "base.json",
  chainId: BASE_CHAIN_ID,
  nativeChainId: BASE_CHAIN_NATIVE_ID,
  chainSlug: "base",
  name: "Base",
  shortName: "Base",
  sourceLabel: "Base desk snapshots",
  issuerPresentation: baseIssuerPresentation,
};
