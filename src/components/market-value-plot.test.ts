import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketValueHeadline, MarketValueTooltip } from "./market-value-plot";
import { MARKET_VALUE_METHOD_LINE, type MarketValueRangeView } from "@/lib/market/onchain-market-value";

const view: MarketValueRangeView = {
  totalUsd: 1_837_839_615.89,
  publicUsd: 1_000,
  privateUsd: 2_000,
  etfUsd: 3_000,
  days: 2,
  recorded: true,
  hint: "avg 14D · 2 of 14 days",
  series: [{ date: "2026-10-08", t: 1, marketValueUsd: 1_837_839_615.89 }],
  basis: "average",
};

describe("Market value methodology", () => {
  it("prints the outstanding-supply line on the headline card", () => {
    const html = renderToStaticMarkup(createElement(MarketValueHeadline, { view }));
    expect(html).toContain('data-market-value-method');
    expect(html).toContain(MARKET_VALUE_METHOD_LINE);
    expect(MARKET_VALUE_METHOD_LINE).toBe(
      "Outstanding onchain supply x DEX price; includes tokens held by issuers/bridges, so can exceed distributed value.",
    );
  });

  it("puts the same line in the hover tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(MarketValueTooltip, { point: { t: 1_759_881_600, volumeUsd: 1_837_839_615.89, kind: "calendar_day" } }),
    );
    expect(html).toContain("data-market-value-tooltip");
    expect(html).toContain(MARKET_VALUE_METHOD_LINE);
  });
});
