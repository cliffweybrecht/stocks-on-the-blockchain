import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketValueHeadline, MarketValuePlot, MarketValueTooltip } from "./market-value-plot";
import { monotoneVolumePaths } from "@/lib/desk/chart-curve";
import { scaleVolumePoints, VOLUME_CHART_INNER_H, VOLUME_CHART_PAD } from "@/lib/market/daily-volume-view";
import type { VolumeHistoryPoint } from "@/lib/market/types";
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

describe("Market value series markers", () => {
  const day = 86_400;
  const closes: VolumeHistoryPoint[] = [
    { t: 1_700_000_000, volumeUsd: 100, kind: "calendar_day" },
    { t: 1_700_000_000 + day, volumeUsd: 140, kind: "calendar_day" },
    { t: 1_700_000_000 + 3 * day, volumeUsd: 90, kind: "calendar_day" },
  ];

  it("draws the smooth area without a dot on every close", () => {
    const html = renderToStaticMarkup(
      createElement(MarketValuePlot, { points: closes, frameClass: "overflow-hidden rounded-xl" }),
    );
    const map = scaleVolumePoints(closes, { xInset: 0 });
    const paths = monotoneVolumePaths(closes, map, VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H);
    expect(html).toContain('data-market-value-points="3"');
    expect(html).toContain('fill="url(#market-value-area)"');
    expect(html).toContain(`d="${paths.line}"`);
    expect(html).toContain(`d="${paths.area}"`);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("data-market-value-point=");
  });

  it("keeps one dot when a single close has no segment", () => {
    const html = renderToStaticMarkup(
      createElement(MarketValuePlot, {
        points: [closes[0]!],
        frameClass: "overflow-hidden rounded-xl",
      }),
    );
    expect(html.match(/<circle /g)).toHaveLength(1);
    expect(html).toContain(`data-market-value-point="${closes[0]!.t}"`);
  });
});
