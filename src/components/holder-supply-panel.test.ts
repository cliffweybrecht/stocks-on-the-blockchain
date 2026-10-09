import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HolderSupplyPanel } from "./holder-supply-panel";

describe("HolderSupplyPanel", () => {
  it("renders nothing when no holder snapshot days are recorded", () => {
    const html = renderToStaticMarkup(
      createElement(HolderSupplyPanel, {
        kicker: "Solana holders",
        points: [],
        footnote: "Separate from volume.",
      }),
    );
    expect(html).toBe("");
  });

  it("renders the recorded day instead of an empty placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(HolderSupplyPanel, {
        kicker: "Solana holders",
        points: [{ date: "2026-10-06", t: 1, holderCount: 12, totalSupply: 4, supplyUsd: 40 }],
        footnote: "Separate from volume.",
        showUnits: true,
      }),
    );
    expect(html).toContain('data-holder-supply');
    expect(html).toContain("Solana holders");
    expect(html).toContain("12");
  });
});
