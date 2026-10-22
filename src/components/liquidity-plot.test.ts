import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { monotoneVolumePaths } from "@/lib/desk/chart-curve";
import { scaleVolumePoints, VOLUME_CHART_INNER_H, VOLUME_CHART_PAD } from "@/lib/market/daily-volume-view";
import type { VolumeHistoryPoint } from "@/lib/market/types";
import { LiquidityPlot } from "./liquidity-plot";

const day = 86_400;

describe("LiquidityPlot markers", () => {
  const closes: VolumeHistoryPoint[] = [
    { t: 1_700_000_000, volumeUsd: 70_000_000, kind: "calendar_day" },
    { t: 1_700_000_000 + day, volumeUsd: 80_000_000, kind: "calendar_day" },
    { t: 1_700_000_000 + 3 * day, volumeUsd: 250_000_000, kind: "calendar_day" },
  ];

  it("draws the smooth area without a dot on every day", () => {
    const html = renderToStaticMarkup(
      createElement(LiquidityPlot, {
        points: closes,
        frameClass: "overflow-hidden rounded-xl",
        range: "30d",
      }),
    );
    const map = scaleVolumePoints(closes, { xInset: 0 });
    const paths = monotoneVolumePaths(closes, map, VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H);
    expect(html).toContain('data-liquidity-points="3"');
    expect(html).toContain('fill="url(#liquidity-area)"');
    expect(html).toContain(`d="${paths.line}"`);
    expect(html).toContain(`d="${paths.area}"`);
    expect(html).not.toContain("<circle");
    expect(html).not.toContain("data-liquidity-point=");
  });

  it("keeps one dot when 24H is a single close", () => {
    const html = renderToStaticMarkup(
      createElement(LiquidityPlot, {
        points: [closes[0]!],
        frameClass: "overflow-hidden rounded-xl",
        range: "24h",
      }),
    );
    expect(html.match(/<circle /g)).toHaveLength(1);
    expect(html).toContain(`data-liquidity-point="${closes[0]!.t}"`);
  });
});
