import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyVolumeChart } from "./daily-volume-chart";
import { HOURLY_VOLUME_DELTA_CAPTION } from "@/lib/market/daily-volume-view";
import { formatUsdCompact } from "@/lib/market/format";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";
import { easternRollingHourStarts } from "@/lib/market/volume-hourly-snapshots";

const GENERATED_AT = "2026-09-30T15:00:00.000Z";

function history(
  points: VolumeHistoryPoint[],
  emptyReason: string | null = null,
): EquityVolumeHistoryResult {
  const base = emptyEquityVolumeHistory(emptyReason ?? "Historical volume series is unavailable.", GENERATED_AT);
  return {
    ...base,
    available: points.length > 0,
    points,
    emptyReason,
  };
}

const dayStart = Date.UTC(2026, 8, 20) / 1000;
const closedDays = [0, 1, 2, 3, 4].map((day) => ({
  t: dayStart + day * 86_400,
  volumeUsd: 1_000_000 * (day + 1),
  kind: "calendar_day" as const,
}));

function easternHour(hour: string): number {
  return Date.parse(`${hour}:00:00-04:00`) / 1000;
}

const captured12 = easternHour("2026-09-29T12");
const captured13 = easternHour("2026-09-29T13");
const missing14 = easternHour("2026-09-29T14");
const captured15 = easternHour("2026-09-29T15");
const captured16 = easternHour("2026-09-29T16");
const hourlyLevels = [
  { t: captured12, volumeUsd: 200_000_000, kind: "rolling_24h" as const },
  { t: captured13, volumeUsd: 210_000_000, kind: "rolling_24h" as const },
  { t: captured15, volumeUsd: 205_000_000, kind: "rolling_24h" as const },
  { t: captured16, volumeUsd: 190_000_000, kind: "rolling_24h" as const },
];

const live = {
  publicVolume24hUsd: 220_500_000,
  privateVolume24hUsd: null,
  etfVolume24hUsd: null,
};

function markup(initialRange: "24h" | "7d" | "14d" | "30d", hourly = hourlyLevels) {
  return renderToStaticMarkup(
    createElement(DailyVolumeChart, {
      history: history([
        ...closedDays,
        { t: Date.UTC(2026, 8, 30) / 1000, volumeUsd: 999_000_000, kind: "rolling_24h" },
      ]),
      hourlyHistory: history(hourly, hourly.length === 0 ? "No hourly snapshots." : null),
      rolling24h: live,
      initialRange,
    }),
  );
}

describe("DailyVolumeChart 24H deltas", () => {
  const html = markup("24h");

  it("keeps the live rolling headline and plots hour-over-hour change", () => {
    expect(html).toContain('data-volume-kind="combined_24h"');
    expect(html).toContain(`>${formatUsdCompact(220_500_000)}<`);
    expect(html).toContain("24h · public + private + ETF/index");
    expect(html).not.toContain(formatUsdCompact(999_000_000));
    expect(html).not.toContain(formatUsdCompact(205_000_000));
    expect(html).toContain('data-volume-series="hourly-delta"');
    expect(html).toContain(`>${HOURLY_VOLUME_DELTA_CAPTION}<`);
    expect(html).not.toContain("24h total captured at that Eastern hour");
    expect(html).toContain("Hour-over-hour change in the DexScreener rolling 24h total");
  });

  it("shows every Eastern hour and draws a delta only for consecutive captures", () => {
    const slots = easternRollingHourStarts(Date.parse(GENERATED_AT) / 1000);
    expect(slots.length).toBeGreaterThan(20);
    expect(html).toContain(`data-hourly-axis-count="${slots.length}"`);
    for (const t of slots) {
      expect(html).toContain(`data-volume-hour="${t}"`);
    }
    expect(html).toContain(`data-volume-hour="${missing14}" data-volume-hour-empty="true"`);
    expect(html).toContain(`data-volume-hour="${captured13}" data-volume-hour-empty="false"`);
    const bars = [...html.matchAll(/data-volume-t="(\d+)"/g)].map((match) => Number(match[1]));
    expect(bars).toEqual([captured13, captured16]);
    expect(bars).not.toContain(captured12);
    expect(bars).not.toContain(missing14);
    expect(bars).not.toContain(captured15);
    expect(html).toContain('data-volume-sign="up"');
    expect(html).toContain('data-volume-sign="down"');
    expect(html).toContain('data-volume-delta="10000000"');
    expect(html).toContain('data-volume-delta="-15000000"');
    expect(html).not.toContain(`data-volume-delta="${205_000_000 - 210_000_000}"`);
    expect(html).toContain('fill="#B7FF3C"');
    expect(html).toContain("var(--price-down)");
    expect(html).toContain('data-volume-zero="true"');
    expect(html).toContain('data-volume-y="+$10.0M"');
    expect(html).toContain('data-volume-y="-$15.0M"');
    expect(html).toContain('data-volume-y="$0"');
    expect(html).not.toContain('fill="url(#volume-area)"');
    expect(html).toContain("Every hour in the window is shown");
    expect(html).toContain("missing captures are left empty");
  });
});

describe("DailyVolumeChart closed ranges", () => {
  it("leaves 7D, 14D, and 30D on closed snapshot days", () => {
    for (const range of ["7d", "14d", "30d"] as const) {
      const html = markup(range);
      expect(html).toContain('data-volume-series="closed-day"');
      expect(html).toContain('data-volume-kind="range_sum"');
      expect(html).not.toContain("data-volume-bar");
      expect(html).not.toContain("data-volume-hour");
      expect(html).not.toContain(HOURLY_VOLUME_DELTA_CAPTION);
      expect(html).not.toContain('data-volume-y="+$');
      expect(html).toContain('fill="url(#volume-area)"');
      expect(html).toContain("History from closed desk DexScreener snapshots");
      expect(html).not.toContain(formatUsdCompact(999_000_000));
      expect(html).not.toContain(formatUsdCompact(220_500_000));
    }
  });

  it("shows the hour axis and no bar when only one hourly capture exists", () => {
    const only = [{ t: easternHour("2026-09-30T10"), volumeUsd: 200_000_000, kind: "rolling_24h" as const }];
    const html = markup("24h", only);
    const slots = easternRollingHourStarts(Date.parse(GENERATED_AT) / 1000);
    expect(html).toContain(`data-hourly-axis-count="${slots.length}"`);
    expect(html).toContain(`data-volume-hour="${only[0]!.t}" data-volume-hour-empty="false"`);
    expect(html).toContain(`data-volume-hour="${easternHour("2026-09-30T09")}" data-volume-hour-empty="true"`);
    expect(html).not.toContain("data-volume-bar");
    expect(html).toContain('data-volume-zero="true"');
    expect(html).toContain(HOURLY_VOLUME_DELTA_CAPTION);
    expect(html).toContain(`>${formatUsdCompact(220_500_000)}<`);
    expect(html).toContain('data-volume-kind="combined_24h"');
  });
});
