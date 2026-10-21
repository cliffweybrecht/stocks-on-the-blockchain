import { describe, expect, it } from "vitest";
import { PRICE_CHART_INNER_W, PRICE_CHART_PAD } from "@/lib/desk/asset-price-view";
import {
  DATE_AXIS_LABEL_MIN_GAP,
  dateAxisRangeForCount,
  selectDateAxisLabelTicks,
} from "@/lib/desk/date-axis";
import { formatChartDay } from "@/lib/market/format";
import { VOLUME_CHART_INNER_W, VOLUME_CHART_PAD, scaleVolumePoints } from "@/lib/market/daily-volume-view";
import type { VolumeHistoryPoint } from "@/lib/market/types";

const DAY = 86_400;

/** UTC midnights. formatChartDay labels that UTC date, which is the Eastern day key. */
function utcDays(start: string, count: number): number[] {
  const startSec = Date.parse(`${start}T00:00:00.000Z`) / 1000;
  return Array.from({ length: count }, (_, index) => startSec + index * DAY);
}

function labels(ticks: readonly number[]): string[] {
  return ticks.map((tick) => formatChartDay(tick));
}

/** Line-chart scale: first day on the left pad, last day on the right pad. */
function lineX(count: number, innerWidth: number, left: number) {
  return (_tick: number, index: number) =>
    count <= 1 ? left + innerWidth / 2 : left + (index / (count - 1)) * innerWidth;
}

function points(times: readonly number[]): VolumeHistoryPoint[] {
  return times.map((t) => ({ t, volumeUsd: 1_000, kind: "calendar_day" as const }));
}

describe("selectDateAxisLabelTicks", () => {
  const volumeX = (count: number) => lineX(count, VOLUME_CHART_INNER_W, VOLUME_CHART_PAD.left);
  const priceX = (count: number) => lineX(count, PRICE_CHART_INNER_W, PRICE_CHART_PAD.left);

  it("labels every day on 7D when the current Oct 13–19 window fits on one row", () => {
    const ticks = utcDays("2026-10-13", 7);
    const selected = selectDateAxisLabelTicks(ticks, "7d", volumeX(ticks.length));
    expect(labels(selected)).toEqual(["Oct 13", "Oct 14", "Oct 15", "Oct 16", "Oct 17", "Oct 18", "Oct 19"]);
    expect(selectDateAxisLabelTicks(ticks, "7d", priceX(ticks.length)).map(formatChartDay)).toEqual(
      labels(selected),
    );
  });

  it("labels every other 14D day and keeps Oct 19, including a short window that would otherwise fit", () => {
    const full = utcDays("2026-10-06", 14);
    expect(labels(selectDateAxisLabelTicks(full, "14d", volumeX(full.length)))).toEqual([
      "Oct 7",
      "Oct 9",
      "Oct 11",
      "Oct 13",
      "Oct 15",
      "Oct 17",
      "Oct 19",
    ]);
    const short = utcDays("2026-09-22", 8);
    expect(labels(selectDateAxisLabelTicks(short, "14d", volumeX(short.length)))).toEqual([
      "Sep 23",
      "Sep 25",
      "Sep 27",
      "Sep 29",
    ]);
    const map = scaleVolumePoints(points(full));
    expect(labels(selectDateAxisLabelTicks(full, "14d", (tick) => map.x(tick)))).toEqual([
      "Oct 7",
      "Oct 9",
      "Oct 11",
      "Oct 13",
      "Oct 15",
      "Oct 17",
      "Oct 19",
    ]);
  });

  it("labels every third 30D day anchored on Oct 19 for the recorded Sep 23–Oct 19 series", () => {
    const recorded = utcDays("2026-09-23", 27);
    const expected = ["Sep 25", "Sep 28", "Oct 1", "Oct 4", "Oct 7", "Oct 10", "Oct 13", "Oct 16", "Oct 19"];
    expect(labels(selectDateAxisLabelTicks(recorded, "30d", volumeX(recorded.length)))).toEqual(expected);
    expect(labels(selectDateAxisLabelTicks(recorded, "30d", priceX(recorded.length)))).toEqual(expected);

    const full = utcDays("2026-09-20", 30);
    expect(labels(selectDateAxisLabelTicks(full, "30d", volumeX(full.length)))).toEqual([
      "Sep 22",
      "Sep 25",
      "Sep 28",
      "Oct 1",
      "Oct 4",
      "Oct 7",
      "Oct 10",
      "Oct 13",
      "Oct 16",
      "Oct 19",
    ]);
    expect(labels(selectDateAxisLabelTicks(full, "30d", priceX(full.length)))).toEqual(
      labels(selectDateAxisLabelTicks(full, "30d", volumeX(full.length))),
    );
  });

  it("does not label a day that was not plotted", () => {
    const ticks = utcDays("2026-10-06", 14).filter((tick) => formatChartDay(tick) !== "Oct 11");
    const selected = labels(selectDateAxisLabelTicks(ticks, "14d", volumeX(ticks.length)));
    expect(selected).not.toContain("Oct 11");
    expect(selected[selected.length - 1]).toBe("Oct 19");
    expect(ticks).toHaveLength(13);
  });

  it("falls 7D back to every other day when every day would collide, and stops there", () => {
    const ticks = utcDays("2026-10-13", 7);
    const everyOther = ["Oct 13", "Oct 15", "Oct 17", "Oct 19"];
    const tight = (_tick: number, index: number) => index * 40;
    expect(labels(selectDateAxisLabelTicks(ticks, "7d", tight))).toEqual(everyOther);
    const crushed = (_tick: number, index: number) => index * 10;
    expect(labels(selectDateAxisLabelTicks(ticks, "7d", crushed))).toEqual(everyOther);
  });

  it("skips more than every third 30D day when those labels would overlap", () => {
    const ticks = utcDays("2026-09-20", 30);
    const tight = (_tick: number, index: number) => index * 20;
    const selected = selectDateAxisLabelTicks(ticks, "30d", tight);
    expect(formatChartDay(selected[selected.length - 1]!)).toBe("Oct 19");
    expect(selected.length).toBeLessThan(10);
    for (let index = 1; index < selected.length; index += 1) {
      const previous = ticks.indexOf(selected[index - 1]!);
      const current = ticks.indexOf(selected[index]!);
      expect(current - previous).toBeGreaterThan(3);
      expect(tight(selected[index]!, current) - tight(selected[index - 1]!, previous)).toBeGreaterThanOrEqual(
        DATE_AXIS_LABEL_MIN_GAP,
      );
    }
  });

  it("keeps bar-chart slots on the 14D and 30D strides", () => {
    const slotX = (count: number) => {
      const slot = VOLUME_CHART_INNER_W / count;
      return (_tick: number, index: number) => VOLUME_CHART_PAD.left + slot * index + slot / 2;
    };
    const fourteen = utcDays("2026-10-06", 14);
    expect(labels(selectDateAxisLabelTicks(fourteen, "14d", slotX(fourteen.length)))).toEqual([
      "Oct 7",
      "Oct 9",
      "Oct 11",
      "Oct 13",
      "Oct 15",
      "Oct 17",
      "Oct 19",
    ]);
    const thirty = utcDays("2026-09-20", 30);
    expect(selectDateAxisLabelTicks(thirty, "30d", slotX(thirty.length))).toHaveLength(10);
  });

  it("returns nothing for an empty axis and the only day when there is one", () => {
    expect(selectDateAxisLabelTicks([], "14d", () => 0)).toEqual([]);
    const only = utcDays("2026-10-19", 1);
    expect(labels(selectDateAxisLabelTicks(only, "30d", () => Number.NaN))).toEqual([]);
    expect(labels(selectDateAxisLabelTicks(only, "30d", () => 12))).toEqual(["Oct 19"]);
  });

  it("maps an unscoped day count onto the same 7D, 14D, and 30D rules", () => {
    expect(dateAxisRangeForCount(1)).toBe("7d");
    expect(dateAxisRangeForCount(7)).toBe("7d");
    expect(dateAxisRangeForCount(8)).toBe("14d");
    expect(dateAxisRangeForCount(14)).toBe("14d");
    expect(dateAxisRangeForCount(15)).toBe("30d");
    expect(dateAxisRangeForCount(Number.NaN)).toBe("7d");
  });
});
