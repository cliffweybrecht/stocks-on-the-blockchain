import { describe, expect, it } from "vitest";
import { hiddenDeskPaths, hiddenDesks, isSectionHidden, publicSitemapPaths } from "./visibility";

describe("public desk visibility", () => {
  it("keeps Perps and Lending visible when the flags are unset", () => {
    const env = {};
    expect(hiddenDesks(env)).toEqual([]);
    expect(isSectionHidden("perps", env)).toBe(false);
    expect(isSectionHidden("lending", env)).toBe(false);
    expect(publicSitemapPaths(env)).toEqual([
      "/",
      "/chains/solana",
      "/chains/robinhood-chain",
      "/chains/base",
      "/chains/bnb",
      "/perps",
      "/perps/methodology",
      "/lending",
    ]);
    expect(hiddenDeskPaths(env)).toEqual([]);
  });

  it("hides only the desks named in NEXT_PUBLIC_HIDE_SECTIONS", () => {
    const env = { NEXT_PUBLIC_HIDE_SECTIONS: " Perps, lending " };
    expect(hiddenDesks(env)).toEqual(["perps", "lending"]);
    expect(isSectionHidden("perps", { NEXT_PUBLIC_HIDE_SECTIONS: "lending" })).toBe(false);
    expect(isSectionHidden("lending", { NEXT_PUBLIC_HIDE_SECTIONS: "lending" })).toBe(true);
    expect(publicSitemapPaths({ NEXT_PUBLIC_HIDE_SECTIONS: "perps" })).not.toContain("/perps");
    expect(publicSitemapPaths({ NEXT_PUBLIC_HIDE_SECTIONS: "perps" })).toContain("/lending");
  });

  it("hides both desks when PUBLIC_SITE is on", () => {
    for (const value of ["1", "true", "yes", " TRUE "]) {
      expect(hiddenDesks({ PUBLIC_SITE: value })).toEqual(["perps", "lending"]);
    }
    expect(hiddenDesks({ PUBLIC_SITE: "0" })).toEqual([]);
    expect(hiddenDesks({ PUBLIC_SITE: "" })).toEqual([]);
    const paths = publicSitemapPaths({ PUBLIC_SITE: "1" });
    expect(paths.some((path) => path.startsWith("/perps") || path.startsWith("/lending"))).toBe(false);
    expect(hiddenDeskPaths({ PUBLIC_SITE: "1" })).toEqual(["/perps", "/lending"]);
  });
});
