import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriceSparkline } from "./price-sparkline";
import { VolumeSparkline } from "./volume-sparkline";

describe("equity card sparklines", () => {
  it("draws the volume curve and fill without a point marker", () => {
    const html = renderToStaticMarkup(
      createElement(VolumeSparkline, {
        points: [
          { t: 1, volumeUsd: 40, kind: "calendar_day" },
          { t: 2, volumeUsd: 70, kind: "calendar_day" },
          { t: 4, volumeUsd: 55, kind: "calendar_day" },
        ],
        label: "AAPLx 7D liquidity",
      }),
    );
    expect(html).toContain('aria-label="AAPLx 7D liquidity"');
    expect(html).toContain("<path");
    expect(html).not.toContain("<circle");
  });

  it("draws the price curve and fill without a point marker", () => {
    const html = renderToStaticMarkup(
      createElement(PriceSparkline, {
        span: "range",
        label: "AAPLx 7D price",
        points: [
          { t: 1, priceUsd: 200 },
          { t: 2, priceUsd: 210 },
          { t: 4, priceUsd: 205 },
        ],
      }),
    );
    expect(html).toContain('aria-label="AAPLx 7D price"');
    expect(html).toContain("<path");
    expect(html).not.toContain("<circle");
  });
});
