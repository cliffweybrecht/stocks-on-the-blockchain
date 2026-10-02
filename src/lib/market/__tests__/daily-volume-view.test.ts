import { describe, expect, it } from "vitest";
import {
  deskChartHeadline,
  filterVolumeRange,
  formatHourlyVolumeChartTick,
  formatVolumeChartTick,
  hourlyVolumeChartXTicks,
  isRollingVolumeChartRange,
  nearestVolumePoint,
  pointerToSvgX,
  pointerToViewBoxX,
  formatDeltaUsdCompact,
  formatDeltaUsdFull,
  contiguousHourlyRuns,
  hourlyRollingVolumeDeltas,
  HOURLY_VOLUME_SERIES_CAPTION,
  scaleVolumePoints,
  deskRangeVolumeHeadline,
  deskVolumeHeadline,
  sumVolumePoints,
  volumeChartXTicks,
  volumeDeltaYTicks,
  volumeHeadlineCopy,
  VOLUME_CHART_INNER_H,
  VOLUME_CHART_INNER_W,
  VOLUME_CHART_PAD,
  VOLUME_CHART_RANGES,
  VOLUME_CHART_WIDTH,
} from "../daily-volume-view";
import { UTC_DAY_SECONDS } from "../volume-history";
import { closedSnapshotVolumePoints } from "../volume-snapshots";

const DAY0 = 1_699_920_000;

function days(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    t: DAY0 + index * UTC_DAY_SECONDS,
    volumeUsd: index === count - 1 ? 27_300_000 : index * 1_000,
    kind: "calendar_day" as const,
  }));
}

describe("filterVolumeRange", () => {
  it("lists rolling 24H beside the closed 7D, 14D, and 30D windows", () => {
    expect(VOLUME_CHART_RANGES.map((row) => row.label)).toEqual(["24H", "7D", "14D", "30D"]);
    expect(VOLUME_CHART_RANGES.map((row) => row.id)).toEqual(["24h", "7d", "14d", "30d"]);
    expect(isRollingVolumeChartRange("24h")).toBe(true);
    expect(isRollingVolumeChartRange("7d")).toBe(false);
    expect(isRollingVolumeChartRange("14d")).toBe(false);
    expect(isRollingVolumeChartRange("30d")).toBe(false);
  });

  it("does not treat 24H as a slice of closed snapshot days", () => {
    const points = days(40);
    expect(filterVolumeRange(points, "24h")).toEqual([]);
    const seven = filterVolumeRange(points, "7d");
    expect(seven).toHaveLength(7);
    expect(seven[0]?.t).toBe(points[33]?.t);
    expect(seven[seven.length - 1]?.t).toBe(points[39]?.t);
  });

  it("keeps only the last 7 closed snapshot days", () => {
    const points = days(40);
    const visible = filterVolumeRange(points, "7d");
    expect(visible).toHaveLength(7);
    expect(visible.map((point) => point.t)).toEqual(points.slice(-7).map((point) => point.t));
    expect(filterVolumeRange([...points].reverse(), "7d").map((point) => point.t)).toEqual(
      points.slice(-7).map((point) => point.t),
    );
    expect(visible[visible.length - 1]?.kind).toBe("calendar_day");
    // An inclusive `last.t - 7 * 86400` window would keep this eighth day.
    expect(visible[0]?.t).not.toBe(points[32]?.t);
  });

  it("keeps only the last 14 closed snapshot days", () => {
    const points = days(40);
    const visible = filterVolumeRange(points, "14d");
    expect(visible).toHaveLength(14);
    expect(visible.map((point) => point.t)).toEqual(points.slice(-14).map((point) => point.t));
    expect(visible[visible.length - 1]?.kind).toBe("calendar_day");
  });

  it("keeps only the last 30 closed snapshot days", () => {
    const points = days(40);
    const visible = filterVolumeRange(points, "30d");
    expect(visible).toHaveLength(30);
    expect(visible.map((point) => point.t)).toEqual(points.slice(-30).map((point) => point.t));
    expect(visible[visible.length - 1]?.kind).toBe("calendar_day");
  });

  it("shows every recorded day when fewer than the range exist and does not fill a gap", () => {
    const short = days(5);
    expect(filterVolumeRange(short, "7d")).toEqual(short);
    expect(filterVolumeRange(short, "14d")).toEqual(short);
    expect(filterVolumeRange(short, "30d")).toEqual(short);

    const withGap = days(10).filter((_, index) => index !== 6);
    const visible = filterVolumeRange(withGap, "7d");
    const missing = DAY0 + 6 * UTC_DAY_SECONDS;
    expect(visible).toHaveLength(7);
    expect(visible.map((point) => point.t)).toEqual(withGap.slice(-7).map((point) => point.t));
    expect(visible.some((point) => point.t === missing)).toBe(false);
  });

  it("counts one snapshot day when two rows share a UTC day", () => {
    const points = days(7);
    const duplicate = { ...points[3]!, volumeUsd: 42 };
    const visible = filterVolumeRange([...points, duplicate], "7d");
    expect(visible).toHaveLength(7);
    expect(visible.map((point) => point.t)).toEqual(points.map((point) => point.t));
    expect(visible[3]?.volumeUsd).toBe(42);
  });

  it("drops a rolling tip so it cannot add an extra day to 7D", () => {
    const points = [
      ...days(8),
      { t: DAY0 + 8 * UTC_DAY_SECONDS + 3600, volumeUsd: 99_000, kind: "rolling_24h" as const },
    ];
    const visible = filterVolumeRange(points, "7d");
    expect(visible).toHaveLength(7);
    expect(visible.every((point) => point.kind === "calendar_day")).toBe(true);
    expect(visible[0]?.t).toBe(points[1]?.t);
    expect(visible[visible.length - 1]?.t).toBe(points[7]?.t);
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

  it("uses the live public + private + ETF rollup for 24H and leaves closed-day sums unchanged", () => {
    const points = days(40);
    const seven = filterVolumeRange(points, "7d");
    const rolling = {
      publicVolume24hUsd: 1_250.25,
      privateVolume24hUsd: 88_000,
      etfVolume24hUsd: 13_000_000,
    };
    const day = deskChartHeadline("7d", seven, rolling);
    expect(day.kind).toBe("range_sum");
    expect(day.volumeUsd).toBeCloseTo(seven.reduce((sum, point) => sum + point.volumeUsd, 0));
    expect(day.caption).toBe("7D · sum of desk snapshot days · public + private + ETF/index");

    const live = deskChartHeadline("24h", seven, rolling);
    expect(live.kind).toBe("combined_24h");
    expect(live.volumeUsd).toBeCloseTo(13_089_250.25);
    expect(live.caption).toBe("24h · public + private + ETF/index");
    expect(live.volumeUsd).not.toBeCloseTo(day.volumeUsd ?? 0);

    const hourly = [
      { t: DAY0, volumeUsd: 4_000_000, kind: "rolling_24h" as const },
      { t: DAY0 + 3600, volumeUsd: 5_000_000, kind: "rolling_24h" as const },
    ];
    const fromHourly = deskChartHeadline("24h", hourly, rolling);
    expect(fromHourly.volumeUsd).toBeCloseTo(13_089_250.25);
    expect(fromHourly.kind).toBe("combined_24h");

    const missing = deskChartHeadline("24h", seven, {
      publicVolume24hUsd: null,
      privateVolume24hUsd: null,
      etfVolume24hUsd: null,
    });
    expect(missing.volumeUsd).toBeNull();
    expect(missing.kind).toBe("combined_24h");
    expect(missing.caption).toBe("24h · no reported public, private, or ETF/index volume");
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

describe("hourlyVolumeChartXTicks", () => {
  it("keeps captured hours and does not fill gaps", () => {
    const points = [0, 1, 3].map((hour) => ({
      t: DAY0 + hour * 3600,
      volumeUsd: 1_000,
      kind: "rolling_24h" as const,
    }));
    expect(hourlyVolumeChartXTicks(points)).toEqual(points.map((point) => point.t));
    expect(formatHourlyVolumeChartTick(points[0]!.t)).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/);
    expect(formatHourlyVolumeChartTick(points[0]!.t)).not.toMatch(/Sep|2026/);
  });

  it("thins labels when many hours exist and still includes the last capture", () => {
    const points = Array.from({ length: 19 }, (_, index) => ({
      t: DAY0 + index * 3600,
      volumeUsd: 1_000 + index,
      kind: "rolling_24h" as const,
    }));
    const ticks = hourlyVolumeChartXTicks(points);
    expect(ticks.length).toBeLessThan(points.length);
    expect(ticks[0]).toBe(points[0]!.t);
    expect(ticks[ticks.length - 1]).toBe(points[18]!.t);
    expect(ticks.every((t) => points.some((point) => point.t === t))).toBe(true);
  });

  it("does not park the newest hour on top of the previous tick", () => {
    const points = Array.from({ length: 20 }, (_, index) => ({
      t: DAY0 + index * 3600,
      volumeUsd: 1_000,
      kind: "rolling_24h" as const,
    }));
    const ticks = hourlyVolumeChartXTicks(points);
    const map = scaleVolumePoints(points);
    expect(ticks[ticks.length - 1]).toBe(points[19]!.t);
    expect(ticks).not.toContain(points[18]!.t);
    for (let index = 1; index < ticks.length; index += 1) {
      expect(map.x(ticks[index]!) - map.x(ticks[index - 1]!)).toBeGreaterThanOrEqual(72);
    }
  });
});

describe("scaleVolumePoints", () => {
  it("keeps a nonnegative series anchored at zero and the max", () => {
    const points = days(3);
    const map = scaleVolumePoints(points);
    expect(map.minY).toBe(0);
    expect(map.maxY).toBe(27_300_000);
    expect(map.y(0)).toBeCloseTo(VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H);
    expect(map.y(map.maxY)).toBeCloseTo(VOLUME_CHART_PAD.top);
  });

  it("keeps empty hours in an explicit time domain without inventing their volume", () => {
    const domain = [0, 3600, 7200, 10_800];
    const map = scaleVolumePoints([{ t: 3600, volumeUsd: 10, kind: "rolling_24h" }], {
      domainT: domain,
      xInset: 0,
    });
    expect(map.minT).toBe(0);
    expect(map.maxT).toBe(10_800);
    expect(map.x(0)).toBeCloseTo(VOLUME_CHART_PAD.left);
    expect(map.x(10_800)).toBeCloseTo(VOLUME_CHART_PAD.left + VOLUME_CHART_INNER_W);
    expect(map.maxY).toBe(10);
    expect(map.minY).toBe(0);
  });

  it("puts the zero baseline between positive and negative deltas", () => {
    const map = scaleVolumePoints([
      { t: DAY0, volumeUsd: -10, kind: "rolling_24h" },
      { t: DAY0 + 3600, volumeUsd: 30, kind: "rolling_24h" },
    ]);
    expect(map.minY).toBe(-10);
    expect(map.maxY).toBe(30);
    expect(map.y(30)).toBeCloseTo(VOLUME_CHART_PAD.top);
    expect(map.y(-10)).toBeCloseTo(VOLUME_CHART_PAD.top + VOLUME_CHART_INNER_H);
    expect(map.y(0)).toBeGreaterThan(map.y(30));
    expect(map.y(0)).toBeLessThan(map.y(-10));
  });
});

describe("volumeDeltaYTicks", () => {
  it("labels a signed axis in delta dollars and always includes zero", () => {
    expect(volumeDeltaYTicks(0, 40)).toEqual([0, 10, 20, 30, 40]);
    expect(volumeDeltaYTicks(-10, 30)).toEqual([-10, -5, 0, 15, 30]);
    expect(volumeDeltaYTicks(-8, 0)).toEqual([-8, -6, -4, -2, 0]);
    expect(volumeDeltaYTicks(0, 0)).toEqual([0]);
    const crowded = volumeDeltaYTicks(-1_620_000, 31_840_000);
    expect(crowded).toContain(0);
    expect(crowded).toContain(31_840_000);
    expect(crowded.some((tick) => tick < 0)).toBe(false);
    expect(formatDeltaUsdCompact(40)).toBe("+$40.0");
    expect(formatDeltaUsdCompact(-8)).toBe("-$8.0");
    expect(formatDeltaUsdCompact(0)).toBe("$0");
    expect(formatDeltaUsdFull(1250.5).startsWith("+")).toBe(true);
    expect(formatDeltaUsdFull(-1250.5).startsWith("-")).toBe(true);
  });
});

describe("contiguousHourlyRuns", () => {
  it("keeps adjacent captures together and starts a new run at a missing hour", () => {
    const points = [0, 1, 3].map((hour) => ({
      t: DAY0 + hour * 3600,
      volumeUsd: 1_000 + hour,
      kind: "rolling_24h" as const,
    }));
    const runs = contiguousHourlyRuns(points);
    expect(runs.map((run) => run.map((point) => point.t))).toEqual([[points[0]!.t, points[1]!.t], [points[2]!.t]]);
    expect(runs.flat().some((point) => point.t === DAY0 + 2 * 3600)).toBe(false);
  });
});

describe("hourlyRollingVolumeDeltas", () => {
  it("plots each later capture minus the prior one and omits the first hour", () => {
    const points = [100, 140, 90].map((volumeUsd, index) => ({
      t: DAY0 + index * 3600,
      volumeUsd,
      kind: "rolling_24h" as const,
    }));
    const deltas = hourlyRollingVolumeDeltas(points);
    expect(deltas).toEqual([
      { t: points[1]!.t, priorT: points[0]!.t, volumeUsd: 40, kind: "rolling_24h" },
      { t: points[2]!.t, priorT: points[1]!.t, volumeUsd: -50, kind: "rolling_24h" },
    ]);
    expect(deltas.some((point) => point.t === points[0]!.t)).toBe(false);
  });

  it("describes the 24H series as the rolling total captured at each hour", () => {
    expect(HOURLY_VOLUME_SERIES_CAPTION).toMatch(/rolling 24h desk total captured at that Eastern hour/);
    expect(HOURLY_VOLUME_SERIES_CAPTION).toMatch(/not volume during that hour alone/);
    expect(HOURLY_VOLUME_SERIES_CAPTION).toMatch(/Every hour in the window is shown/);
    expect(HOURLY_VOLUME_SERIES_CAPTION).toMatch(/missing captures are left empty/);
    expect(HOURLY_VOLUME_SERIES_CAPTION).not.toMatch(/change/);
    expect(HOURLY_VOLUME_SERIES_CAPTION).not.toMatch(/previous Eastern hour/);
  });

  it("does not invent a zero for the first point or a delta across a missing hour", () => {
    const points = [0, 1, 3].map((hour) => ({
      t: DAY0 + hour * 3600,
      volumeUsd: 1_000 + hour * 100,
      kind: "rolling_24h" as const,
    }));
    const deltas = hourlyRollingVolumeDeltas(points);
    expect(deltas.map((point) => point.t)).toEqual([points[1]!.t]);
    expect(deltas.map((point) => point.t)).not.toContain(DAY0 + 2 * 3600);
    expect(deltas.map((point) => point.t)).not.toContain(points[2]!.t);
    expect(deltas[0]?.volumeUsd).toBe(points[1]!.volumeUsd - points[0]!.volumeUsd);
    expect(deltas[0]?.priorT).toBe(points[0]!.t);
    expect(hourlyRollingVolumeDeltas(points.slice(0, 1))).toEqual([]);
  });

  it("keeps a real zero change and sorts before differencing", () => {
    const earlier = { t: DAY0, volumeUsd: 10, kind: "rolling_24h" as const };
    const flat = { t: DAY0 + 3600, volumeUsd: 10, kind: "rolling_24h" as const };
    const later = { t: DAY0 + 7200, volumeUsd: 4, kind: "rolling_24h" as const };
    expect(hourlyRollingVolumeDeltas([later, earlier, flat])).toEqual([
      { t: flat.t, priorT: earlier.t, volumeUsd: 0, kind: "rolling_24h" },
      { t: later.t, priorT: flat.t, volumeUsd: -6, kind: "rolling_24h" },
    ]);
  });

  it("skips invalid levels and closed days instead of treating them as a prior hour", () => {
    const points = [
      { t: DAY0, volumeUsd: 100, kind: "calendar_day" as const },
      { t: DAY0 + 3600, volumeUsd: 10, kind: "rolling_24h" as const },
      { t: DAY0 + 7200, volumeUsd: Number.NaN, kind: "rolling_24h" as const },
      { t: DAY0 + 10_800, volumeUsd: -5, kind: "rolling_24h" as const },
      { t: DAY0 + 14_400, volumeUsd: 8, kind: "rolling_24h" as const },
    ];
    expect(hourlyRollingVolumeDeltas(points)).toEqual([]);
  });

  it("replaces a repeated hour instead of plotting two bars at the same time", () => {
    const points = [
      { t: DAY0, volumeUsd: 10, kind: "rolling_24h" as const },
      { t: DAY0, volumeUsd: 15, kind: "rolling_24h" as const },
      { t: DAY0 + 3600, volumeUsd: 18, kind: "rolling_24h" as const },
    ];
    expect(hourlyRollingVolumeDeltas(points)).toEqual([
      { t: DAY0 + 3600, priorT: DAY0, volumeUsd: 3, kind: "rolling_24h" },
    ]);
  });

  it("does not run rolling hours through closedSnapshotVolumePoints", () => {
    const points = [
      { t: DAY0, volumeUsd: 10, kind: "rolling_24h" as const },
      { t: DAY0 + 3600, volumeUsd: 14, kind: "rolling_24h" as const },
    ];
    expect(closedSnapshotVolumePoints(points, DAY0 + 10_000)).toEqual([]);
    expect(hourlyRollingVolumeDeltas(points)).toEqual([
      { t: DAY0 + 3600, priorT: DAY0, volumeUsd: 4, kind: "rolling_24h" },
    ]);
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

