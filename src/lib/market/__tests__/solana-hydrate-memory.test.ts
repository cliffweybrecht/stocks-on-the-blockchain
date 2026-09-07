import { describe, expect, it } from "vitest";
import { SolanaHydrateMemory } from "../solana-hydrate-memory";

describe("SolanaHydrateMemory", () => {
  it("skips confirmed-empty mints until TTL, and never skips a mint that later had pools", () => {
    const memory = new SolanaHydrateMemory(1_000);
    memory.rememberOutcome(["empty", "pooled"], new Set(["pooled"]), new Set(), new Set(), 0);
    expect(memory.isConfirmedEmpty("empty", 10)).toBe(true);
    expect(memory.isConfirmedEmpty("pooled", 10)).toBe(false);
    expect(memory.isConfirmedEmpty("unknown", 10)).toBe(false);
    expect(memory.pooledMints().has("pooled")).toBe(true);

    expect(memory.isConfirmedEmpty("empty", 1_001)).toBe(false);

    memory.markEmpty(["pooled"], 2_000);
    expect(memory.isConfirmedEmpty("pooled", 2_000)).toBe(false);
  });

  it("does not mark failed or incomplete hydrates as confirmed empty", () => {
    const memory = new SolanaHydrateMemory(1_000);
    memory.rememberOutcome(["fail", "wait"], new Set(), new Set(["fail"]), new Set(["wait"]), 0);
    expect(memory.isConfirmedEmpty("fail", 10)).toBe(false);
    expect(memory.isConfirmedEmpty("wait", 10)).toBe(false);
  });
});
