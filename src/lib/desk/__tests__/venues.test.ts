import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { marketsPoolVenues } from "../venues";

const venueDir = path.resolve(__dirname, "../../../../public/venues");

describe("marketsPoolVenues", () => {
  it("uses the host dex and ignores pool-type labels", () => {
    expect(marketsPoolVenues({ dexId: "raydium", labels: ["CLMM"] })).toEqual([
      { id: "raydium", name: "Raydium", logoSrc: "/venues/raydium.png" },
    ]);
    expect(marketsPoolVenues({ dexId: "orca", labels: ["wp"] })).toEqual([
      { id: "orca", name: "Orca", logoSrc: "/venues/orca.png" },
    ]);
    expect(marketsPoolVenues({ dexId: "meteora", labels: ["DLMM"] })[0]?.id).toBe("meteora");
    expect(marketsPoolVenues({ dexId: "Pump.fun" })).toEqual([
      { id: "pumpfun", name: "Pump.fun", logoSrc: "/venues/pumpfun.png" },
    ]);
  });

  it("adds a second icon only when a label names another known venue", () => {
    expect(marketsPoolVenues({ dexId: "meteora", labels: ["DLMM", "phoenix", "phoenix"] })).toEqual([
      { id: "meteora", name: "Meteora", logoSrc: "/venues/meteora.png" },
      { id: "phoenix", name: "Phoenix", logoSrc: "/venues/phoenix.png" },
    ]);
    expect(marketsPoolVenues({ dexId: "raydium", labels: ["CLMM", "not-a-venue"] })).toEqual([
      { id: "raydium", name: "Raydium", logoSrc: "/venues/raydium.png" },
    ]);
  });

  it("collapses brand aliases onto one logo", () => {
    expect(marketsPoolVenues({ dexId: "sushiswap" })).toEqual([
      { id: "sushi", name: "Sushi", logoSrc: "/venues/sushi.png" },
    ]);
    expect(marketsPoolVenues({ dexId: "whirlpool", labels: ["wp"] })).toEqual([
      { id: "orca", name: "Orca", logoSrc: "/venues/orca.png" },
    ]);
    expect(marketsPoolVenues({ dexId: "raydium", labels: ["raydium-clmm"] })).toHaveLength(1);
  });

  it("degrades unknown dex ids to text and leaves a missing host empty", () => {
    expect(marketsPoolVenues({ dexId: "some-new-dex" })).toEqual([
      { id: "some-new-dex", name: "Some New Dex", logoSrc: null },
    ]);
    expect(marketsPoolVenues({ dexId: "moonshot" })).toEqual([
      { id: "moonshot", name: "Moonshot", logoSrc: null },
    ]);
    expect(marketsPoolVenues({ dexId: "unknown", labels: null })).toEqual([]);
    expect(marketsPoolVenues({ dexId: "  ", labels: ["CLMM"] })).toEqual([]);
  });

  it("ships a logo file for every venue that claims one", () => {
    const files = new Set(fs.readdirSync(venueDir));
    for (const file of files) {
      const id = file.replace(/\.png$/, "");
      const [venue] = marketsPoolVenues({ dexId: id });
      expect(venue?.logoSrc, file).toBe(`/venues/${file}`);
      expect(fs.existsSync(path.join(venueDir, file))).toBe(true);
    }
    expect(files.has("raydium.png")).toBe(true);
    expect(files.has("phoenix.png")).toBe(true);
    expect(files.has("pumpswap.png")).toBe(true);
  });
});
