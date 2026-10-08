import type { DataProvenance } from "@/lib/market/types";

/**
 * Header provenance chip.
 * The Solana desk does not show "Live Solana" — Jump is the live-list control.
 */
export function headerStatusLabel(provenance: DataProvenance): string | null {
  if (provenance.sourceId === "mock") return "Seed / demo data";
  if (
    provenance.sourceId === "solana" ||
    provenance.sourceId === "robinhood" ||
    provenance.sourceId === "base" ||
    provenance.sourceId === "bnb" ||
    (provenance.sourceId === "composite" && provenance.sourceLabel.toLowerCase().includes("solana"))
  ) {
    return null;
  }
  if (provenance.sourceId === "composite") return "Live sources";
  return "Live Terminal";
}
