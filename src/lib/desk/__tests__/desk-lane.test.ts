import { describe, expect, it } from "vitest";
import { deskLaneLabel, deskLaneQueryValue, instrumentKindShortLabel, parseDeskLane } from "../desk-lane";

describe("parseDeskLane", () => {
  it("keeps unknown or unavailable lanes on public equities", () => {
    expect(parseDeskLane("etf", { etf: false, private: true })).toBe("equity");
    expect(parseDeskLane("private", { etf: true, private: false })).toBe("equity");
    expect(parseDeskLane("nope", { etf: true, private: true })).toBe("equity");
  });

  it("admits etf and private only when that lane has rows", () => {
    expect(parseDeskLane("etf", { etf: true, private: true })).toBe("etf");
    expect(parseDeskLane("private", { etf: true, private: true })).toBe("private");
    expect(parseDeskLane(["private"], { etf: false, private: true })).toBe("private");
  });
});

describe("desk lane labels", () => {
  it("labels lanes without mixing them", () => {
    expect(deskLaneLabel("equity")).toBe("Equities");
    expect(deskLaneLabel("etf")).toBe("ETF / index");
    expect(deskLaneLabel("private")).toBe("Private market");
    expect(deskLaneQueryValue("equity")).toBeNull();
    expect(deskLaneQueryValue("private")).toBe("private");
    expect(instrumentKindShortLabel("private")).toBe("Private");
    expect(instrumentKindShortLabel("equity")).toBeNull();
  });
});
