import { describe, expect, it } from "vitest";
import { headerStatusLabel } from "../header-status";
import type { DataProvenance } from "@/lib/market/types";

function provenance(partial: Pick<DataProvenance, "sourceId" | "sourceLabel">): DataProvenance {
  return {
    sourceId: partial.sourceId,
    sourceLabel: partial.sourceLabel,
    fetchedAt: "2026-09-28T00:00:00.000Z",
    generatedAt: "2026-09-28T00:00:00.000Z",
    refreshStartedAt: null,
    refreshDurationMs: null,
    cacheStatus: "fresh",
    cacheAgeMs: 0,
    notes: [],
    sourceFailures: [],
  };
}

describe("headerStatusLabel", () => {
  it("hides the Live Solana chip and keeps other source badges", () => {
    expect(headerStatusLabel(provenance({ sourceId: "solana", sourceLabel: "Solana" }))).toBeNull();
    expect(headerStatusLabel(provenance({ sourceId: "composite", sourceLabel: "Solana" }))).toBeNull();
    expect(headerStatusLabel(provenance({ sourceId: "mock", sourceLabel: "Seed" }))).toBe("Seed / demo data");
    expect(headerStatusLabel(provenance({ sourceId: "composite", sourceLabel: "Terminal + Solana" }))).toBeNull();
    expect(headerStatusLabel(provenance({ sourceId: "composite", sourceLabel: "Markets" }))).toBe("Live sources");
    expect(headerStatusLabel(provenance({ sourceId: "terminal", sourceLabel: "Terminal" }))).toBe("Live Terminal");
  });
});