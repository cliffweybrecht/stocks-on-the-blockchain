import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyVolumeChart } from "./daily-volume-chart";
import { HOURLY_VOLUME_DELTA_CAPTION, HOURLY_VOLUME_DELTA_EMPTY } from "@/lib/market/daily-volume-view";
import { formatUsdCompact } from "@/lib/market/format";
import type { EquityVolumeHistoryResult, VolumeHistoryPoint } from "@/lib/market/types";
import { emptyEquityVolumeHistory } from "@/lib/market/volume-history";

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

const firstHour = 1_790_700_000;
const hourlyLevels = [
  { t: firstHour, volumeUsd: 200_000_000, kind: "rolling_24h" as const },
  { t: firstHour + 3600, volumeUsd: 210_000_000, kind: "rolling_24h" as const },
  { t: firstHour + 3 * 3600, volumeUsd: 205_000_000, kind: "rolling_24h" as const },
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

  it("omits the first hour and does not invent the missing hour", () => {
    const bars = [...html.matchAll(/data-volume-t="(\d+)"/g)].map((match) => Number(match[1]));
    expect(bars).toEqual([firstHour + 3600, firstHour + 3 * 3600]);
    expect(bars).not.toContain(firstHour);
    expect(bars).not.toContain(firstHour + 2 * 3600);
    expect(html).toContain('data-volume-sign="up"');
    expect(html).toContain('data-volume-sign="down"');
    expect(html).toContain('data-volume-delta="10000000"');
    expect(html).toContain('data-volume-delta="-5000000"');
    expect(html).toContain('fill="#B7FF3C"');
    expect(html).toContain("var(--price-down)");
    expect(html).toContain('data-volume-zero="true"');
    expect(html).toContain('data-volume-y="+$10.0M"');
    expect(html).toContain('data-volume-y="-$5.0M"');
    expect(html).toContain('data-volume-y="$0"');
    expect(html).not.toContain('fill="url(#volume-area)"');
  });
});

describe("DailyVolumeChart closed ranges", () => {
  it("leaves 7D, 14D, and 30D on closed snapshot days", () => {
    for (const range of ["7d", "14d", "30d"] as const) {
      const html = markup(range);
      expect(html).toContain('data-volume-series="closed-day"');
      expect(html).toContain('data-volume-kind="range_sum"');
      expect(html).not.toContain("data-volume-bar");
      expect(html).not.toContain(HOURLY_VOLUME_DELTA_CAPTION);
      expect(html).not.toContain('data-volume-y="+$');
      expect(html).toContain('fill="url(#volume-area)"');
      expect(html).toContain("History from closed desk DexScreener snapshots");
      expect(html).not.toContain(formatUsdCompact(999_000_000));
      expect(html).not.toContain(formatUsdCompact(220_500_000));
    }
  });

  it("does not invent a zero bar when only one hourly capture exists", () => {
    const html = markup("24h", hourlyLevels.slice(0, 1));
    expect(html).toContain(HOURLY_VOLUME_DELTA_EMPTY);
    expect(html).not.toContain("data-volume-bar");
    expect(html).not.toContain('data-volume-zero="true"');
    expect(html).toContain(`>${formatUsdCompact(220_500_000)}<`);
    expect(html).toContain('data-volume-kind="combined_24h"');
  });
});
