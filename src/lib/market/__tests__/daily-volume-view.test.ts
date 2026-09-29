import { describe, expect, it } from "vitest";
import {
  filterVolumeRange,
  formatVolumeChartTick,
  nearestVolumePoint,
  pointerToSvgX,
  pointerToViewBoxX,
  scaleVolumePoints,
  deskRangeVolumeHeadline,
  deskVolumeHeadline,
  sumVolumePoints,
  volumeChartXTicks,
  volumeHeadlineCopy,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
} from "../daily-volume-view";
import { UTC_DAY_SECONDS } from "../volume-history";

const DAY0 = 1_699_920_000;

function days(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    t: DAY0 + index * UTC_DAY_SECONDS,
    volumeUsd: index === count - 1 ? 27_300_000 : index * 1_000,
    kind: "calendar_day" as const,
  }));
}

describe("filterVolumeRange", () => {
  it("lists 7D, 14D, and 30D only", () => {
    expect(VOLUME_CHART_RANGES.map((row) => row.label)).toEqual(["7D", "14D", "30D"]);
    expect(VOLUME_CHART_RANGES.map((row) => row.id)).toEqual(["7d", "14d", "30d"]);
  });

  it("keeps a continuous 7-day window ending on the latest point", () => {
    const points = days(40);
    const visible = filterVolumeRange(points, "7d");
    expect(visible).toHaveLength(8);
    expect(visible[0]?.t).toBe(points[32]?.t);
    expect(visible[visible.length - 1]?.kind).toBe("calendar_day");
  });

  it("keeps a continuous 14-day window ending on the latest point", () => {
    const points = days(40);
    const visible = filterVolumeRange(points, "14d");
    expect(visible).toHaveLength(15);
    expect(visible[0]?.t).toBe(points[25]?.t);
    expect(visible[visible.length - 1]?.kind).toBe("calendar_day");
  });

  it("keeps a continuous 30-day window ending on the latest point", () => {
    const points = days(40);
    const visible = filterVolumeRange(points, "30d");
    expect(visible).toHaveLength(31);
    expect(visible[0]?.t).toBe(points[9]?.t);
    expect(visible[visible.length - 1]?.kind).toBe("calendar_day");
  });
});

describe("nearestVolumePoint", () => {
  it("returns the point whose x is closest to the pointer", () => {
    const points = days(3);
    const map = scaleVolumePoints(points);
    const left = nearestVolumePoint(points, map, map.x(points[0]!.t));
    const right = nearestVolumePoint(points, map, map.x(points[2]!.t));
    const mid = nearestVolumePoint(points, map, map.x(points[1]!.t) + 2);
    expect(left?.t).toBe(points[0]?.t);
    expect(right?.t).toBe(points[2]?.t);
    expect(mid?.t).toBe(points[1]?.t);
    expect(nearestVolumePoint([], map, 10)).toBeNull();
  });
});

describe("pointerToViewBoxX", () => {
  it("inverts a scaled-and-translated CTM so the cursor tracks the viewBox", () => {
    const identity = pointerToViewBoxX(120, 40, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(identity).toBe(120);

    const letterboxed = pointerToViewBoxX(200, 80, { a: 0.5, b: 0, c: 0, d: 0.5, e: 40, f: 20 });
    expect(letterboxed).toBeCloseTo((200 - 40) / 0.5);

    expect(pointerToViewBoxX(10, 10, null)).toBeNull();
    expect(pointerToViewBoxX(10, 10, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toBeNull();
    expect(pointerToSvgX(140, 40, null, { left: 40, width: 400 })).toBeCloseTo((100 / 400) * VOLUME_CHART_WIDTH);
  });

  it("maps a pointer at the plot left edge onto the first day", () => {
    const points = days(5);
    const map = scaleVolumePoints(points);
    const svgX = pointerToViewBoxX(VOLUME_CHART_PAD.left, 40, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(svgX).toBeCloseTo(VOLUME_CHART_PAD.left);
    expect(nearestVolumePoint(points, map, svgX!)?.t).toBe(points[0]?.t);
    expect(VOLUME_CHART_WIDTH).toBeGreaterThan(VOLUME_CHART_PAD.left);
  });
});

describe("volumeHeadlineCopy", () => {
  it("labels the desk 24h point separately from a calendar day", () => {
    expect(volumeHeadlineCopy({ t: DAY0, volumeUsd: 9, kind: "rolling_24h" }).caption).toMatch(/24h/);
    expect(volumeHeadlineCopy({ t: DAY0, volumeUsd: 9, kind: "calendar_day" }).caption).toMatch(/Calendar day/);
  });
});

describe("deskVolumeHeadline", () => {
  const latest = { t: DAY0, volumeUsd: 1_250.25, kind: "rolling_24h" as const };

  it("uses public + private + ETF/index 24h for the rest-state headline", () => {
    const headline = deskVolumeHeadline({
      publicVolume24hUsd: 1_250.25,
      privateVolume24hUsd: 88_000,
      etfVolume24hUsd: 13_000_000,
      hover: null,
      latest,
    });
    expect(headline.volumeUsd).toBeCloseTo(13_089_250.25);
    expect(headline.kind).toBe("combined_24h");
    expect(headline.caption).toBe("24h · public + private + ETF/index");
    expect(headline.caption).not.toMatch(/chart is public history/);
  });

  it("omits unreported private or ETF volume instead of treating it as zero", () => {
    const withoutPrivate = deskVolumeHeadline({
      publicVolume24hUsd: 1_250.25,
      privateVolume24hUsd: null,
      etfVolume24hUsd: 13_000_000,
      hover: null,
      latest,
    });
    expect(withoutPrivate.volumeUsd).toBeCloseTo(13_001_250.25);

    const publicOnly = deskVolumeHeadline({
      publicVolume24hUsd: 1_250.25,
      privateVolume24hUsd: null,
      etfVolume24hUsd: null,
      hover: null,
      latest,
    });
    expect(publicOnly.volumeUsd).toBe(1_250.25);
  });

  it("keeps hover on the DexScreener snapshot series", () => {
    const hoverDay = deskVolumeHeadline({
      publicVolume24hUsd: 1_250.25,
      privateVolume24hUsd: 88_000,
      etfVolume24hUsd: 13_000_000,
      hover: { t: DAY0, volumeUsd: 9, kind: "calendar_day" },
      latest,
    });
    expect(hoverDay.volumeUsd).toBe(9);
    expect(hoverDay.kind).toBe("calendar_day");
    expect(hoverDay.caption).toMatch(/DexScreener snapshot/);
    expect(hoverDay.caption).not.toMatch(/public history/);
    expect(hoverDay.caption).not.toMatch(/headline universe is broader/);

    const hover24h = deskVolumeHeadline({
      publicVolume24hUsd: 1_250.25,
      privateVolume24hUsd: 88_000,
      etfVolume24hUsd: 13_000_000,
      hover: latest,
      latest,
    });
    expect(hover24h.volumeUsd).toBe(1_250.25);
    expect(hover24h.caption).toMatch(/DexScreener snapshot/);
    expect(hover24h.caption).toMatch(/public \+ private \+ ETF\/index/);
  });
});

describe("volumeChartXTicks", () => {
  it("labels every UTC day in the window, including the middle of a short series", () => {
    const start = Date.UTC(2026, 8, 24) / 1000;
    const points = [121_018_931, 115_145_253, 56_268_835.53, 76_080_265, 114_300_000].map(
      (volumeUsd, index) => ({
        t: start + index * UTC_DAY_SECONDS,
        volumeUsd,
        kind: "calendar_day" as const,
      }),
    );
    const ticks = volumeChartXTicks(points);
    expect(ticks).toEqual(points.map((point) => point.t));
    expect(ticks.map((t) => formatVolumeChartTick(t, ticks))).toEqual([
      "Sep 24",
      "Sep 25",
      "Sep 26",
      "Sep 27",
      "Sep 28",
    ]);
    expect(points[2]?.volumeUsd).toBeCloseTo(56_268_835.53);
  });

  it("keeps every day when the window is longer than a week", () => {
    const start = Date.UTC(2026, 8, 1) / 1000;
    const points = Array.from({ length: 14 }, (_, index) => ({
      t: start + index * UTC_DAY_SECONDS,
      volumeUsd: 1_000 + index,
      kind: "calendar_day" as const,
    }));
    const ticks = volumeChartXTicks(points);
    expect(ticks).toEqual(points.map((point) => point.t));
    expect(new Set(ticks.map((t) => formatVolumeChartTick(t, ticks))).size).toBe(14);
  });
});

describe("deskRangeVolumeHeadline", () => {
  it("sums only the snapshot days inside the selected window", () => {
    const points = days(40);
    const seven = filterVolumeRange(points, "7d");
    const fourteen = filterVolumeRange(points, "14d");
    const thirty = filterVolumeRange(points, "30d");
    const h7 = deskRangeVolumeHeadline(seven, "7d");
    const h14 = deskRangeVolumeHeadline(fourteen, "14d");
    const h30 = deskRangeVolumeHeadline(thirty, "30d");
    expect(h7.volumeUsd).toBeCloseTo(seven.reduce((sum, point) => sum + point.volumeUsd, 0));
    expect(h14.volumeUsd).toBeCloseTo(fourteen.reduce((sum, point) => sum + point.volumeUsd, 0));
    expect(h30.volumeUsd).toBeCloseTo(thirty.reduce((sum, point) => sum + point.volumeUsd, 0));
    expect(h7.volumeUsd).toBeLessThan(h14.volumeUsd ?? 0);
    expect(h14.volumeUsd).toBeLessThan(h30.volumeUsd ?? 0);
    expect(h7.caption).toBe("7D · sum of desk snapshot days · public + private + ETF/index");
    expect(h14.caption).toContain("14D");
    expect(h30.caption).toContain("30D");
    expect(h7.kind).toBe("range_sum");
  });

  it("does not invent a total when the window has no points", () => {
    const empty = deskRangeVolumeHeadline([], "14d");
    expect(empty.volumeUsd).toBeNull();
    expect(empty.caption).toBe("14D · no desk snapshots in this window");
  });

  it("leaves a live rolling tip out of the headline sum", () => {
    const points = [
      { t: DAY0, volumeUsd: 10, kind: "calendar_day" as const },
      { t: DAY0 + UTC_DAY_SECONDS, volumeUsd: 99_000, kind: "rolling_24h" as const },
    ];
    expect(sumVolumePoints(points)).toBe(10);
    const headline = deskRangeVolumeHeadline(points, "7d");
    expect(headline.volumeUsd).toBe(10);
    expect(headline.caption).toMatch(/sum of desk snapshot days/);
  });
});

describe("formatVolumeChartTick", () => {
  it("uses month+day when month+year would collapse a 7-day window", () => {
    const start = Date.UTC(2026, 8, 19) / 1000;
    const ticks = [0, 2, 5, 7].map((offset) => start + offset * UTC_DAY_SECONDS);
    const labels = ticks.map((t) => formatVolumeChartTick(t, ticks));
    expect(labels).toEqual(["Sep 19", "Sep 21", "Sep 24", "Sep 26"]);
    expect(new Set(labels).size).toBe(4);
  });

  it("keeps month+year when those labels are already unique (All / 180D)", () => {
    const ticks = [
      Date.UTC(2026, 2, 26) / 1000,
      Date.UTC(2026, 4, 26) / 1000,
      Date.UTC(2026, 6, 26) / 1000,
      Date.UTC(2026, 8, 26) / 1000,
    ];
    const labels = ticks.map((t) => formatVolumeChartTick(t, ticks));
    expect(labels).toEqual(["Mar 26", "May 26", "Jul 26", "Sep 26"]);
  });
});

