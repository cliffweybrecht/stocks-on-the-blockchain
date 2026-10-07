import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyVolumeChart } from "./daily-volume-chart";
import { HOURLY_VOLUME_SERIES_CAPTION } from "@/lib/market/daily-volume-view";
import {
  HOME_24H_ROBINHOOD_PLOT_NOTE,
  HOME_CLOSED_RANGE_WITH_ROBINHOOD_FOOTER,
} from "@/lib/market/home-desk-volume";
import { parseRobinhoodDeskDays, type RobinhoodDeskDay } from "@/lib/market/robinhood-desk-volume";
import { DESK_CHART_STROKE } from "@/lib/desk/chart-curve";
import { DESK_VOLUME_24H_POLL_MS, DESK_VOLUME_HISTORY_POLL_MS } from "@/lib/market/desk-volume-live";
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

describe("DailyVolumeChart 24H rolling area", () => {
  const html = markup("24h");

  it("keeps the live rolling headline and plots absolute hourly totals", () => {
    expect(html).toContain('data-volume-kind="combined_24h"');
    expect(html).toContain(`>${formatUsdCompact(220_500_000)}<`);
    expect(html).toContain("24h · public + private + ETF/index");
    expect(html).not.toContain(formatUsdCompact(999_000_000));
    expect(html).toContain('data-volume-series="hourly-rolling"');
    expect(html).toContain(`>${HOURLY_VOLUME_SERIES_CAPTION}<`);
    expect(html).toContain("rolling 24h desk total captured at that Eastern hour");
    expect(html).toContain("not volume during that hour alone");
    expect(html).not.toContain("Hour-over-hour change");
    expect(html).not.toContain("versus the previous Eastern hour");
  });

  it("draws a lime area through captured hours and leaves the missing hour empty", () => {
    const slots = easternRollingHourStarts(Date.parse(GENERATED_AT) / 1000);
    expect(slots.length).toBeGreaterThan(20);
    expect(html).toContain(`data-hourly-axis-count="${slots.length}"`);
    expect(html).toContain('data-hourly-point-count="4"');
    for (const t of slots) {
      expect(html).toContain(`data-volume-hour="${t}"`);
    }
    expect(html).toContain(`data-volume-hour="${missing14}" data-volume-hour-empty="true"`);
    expect(html).toContain(`data-volume-hour="${captured13}" data-volume-hour-empty="false"`);
    const plotted = [...html.matchAll(/data-volume-t="(\d+)"/g)].map((match) => Number(match[1]));
    expect(plotted).toEqual([captured12, captured13, captured15, captured16]);
    expect(plotted).not.toContain(missing14);
    expect(html).toContain('data-volume-usd="200000000"');
    expect(html).toContain('data-volume-usd="210000000"');
    expect(html).toContain('data-volume-usd="205000000"');
    expect(html).toContain('data-volume-usd="190000000"');
    expect(html).toContain('data-volume-run-count="2"');
    expect(html).toContain(`stroke="${DESK_CHART_STROKE}"`);
    expect(html).toContain('fill="url(#volume-area-24h)"');
    expect(html).toMatch(/ C /);
    expect(html).not.toContain("data-volume-bar");
    expect(html).not.toContain("data-volume-sign");
    expect(html).not.toContain("data-volume-delta");
    expect(html).not.toContain("var(--price-down)");
    expect(html).not.toContain('data-volume-y="+$');
    expect(html).not.toContain('data-volume-y="-$');
    expect(html).toContain('data-volume-y="$0"');
    expect(html).toContain("Every hour in the window is shown");
    expect(html).toContain("missing captures are left empty");
    expect(html).toContain('data-volume-live="24h"');
    expect(html).toContain(`data-volume-refresh-ms="${DESK_VOLUME_24H_POLL_MS}"`);
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
      expect(html).not.toContain(HOURLY_VOLUME_SERIES_CAPTION);
      expect(html).not.toContain("data-volume-rolling-area");
      expect(html).not.toContain('stroke="#B7FF3C"');
      expect(html).not.toContain('data-volume-y="+$');
      expect(html).toContain('fill="url(#volume-area)"');
      expect(html).toContain("History from closed desk DexScreener snapshots");
      expect(html).toContain('data-volume-includes-robinhood="false"');
      expect(html).not.toContain("Robinhood Chain");
      expect(html).toContain(`data-volume-refresh-ms="${DESK_VOLUME_HISTORY_POLL_MS}"`);
      expect(html).toContain('data-volume-live="closed-day"');
      expect(html).not.toContain('data-volume-live="24h"');
      expect(html).not.toContain(formatUsdCompact(999_000_000));
      expect(html).not.toContain(formatUsdCompact(220_500_000));
    }
  });

  it("plots the last 7 closed snapshot days on 7D and every recorded day on 14D when fewer than 14 exist", () => {
    const start = Date.UTC(2026, 8, 22) / 1000;
    const points = Array.from({ length: 8 }, (_, index) => ({
      t: start + index * 86_400,
      volumeUsd: 1_000_000 * (index + 1),
      kind: "calendar_day" as const,
    }));
    const ticksOf = (range: "7d" | "14d") => {
      const html = renderToStaticMarkup(
        createElement(DailyVolumeChart, {
          history: history(points),
          hourlyHistory: history([], "No hourly snapshots."),
          rolling24h: live,
          initialRange: range,
        }),
      );
      return [...html.matchAll(/data-volume-tick="([^"]+)"/g)].map((match) => match[1]);
    };
    expect(ticksOf("7d")).toEqual(["Sep 23", "Sep 24", "Sep 25", "Sep 26", "Sep 27", "Sep 28", "Sep 29"]);
    expect(ticksOf("14d")).toEqual([
      "Sep 22",
      "Sep 23",
      "Sep 24",
      "Sep 25",
      "Sep 26",
      "Sep 27",
      "Sep 28",
      "Sep 29",
    ]);
    const sevenHtml = renderToStaticMarkup(
      createElement(DailyVolumeChart, {
        history: history(points),
        hourlyHistory: history([], "No hourly snapshots."),
        rolling24h: live,
        initialRange: "7d",
      }),
    );
    const sevenSum = points.slice(1).reduce((sum, point) => sum + point.volumeUsd, 0);
    expect(sevenHtml).toContain(`>${formatUsdCompact(sevenSum)}<`);
    expect(sevenHtml).not.toContain(`>${formatUsdCompact(points[0]!.volumeUsd + sevenSum)}<`);
    expect(sevenHtml).toContain('fill="url(#volume-area)"');
    expect(sevenHtml).toContain('stroke="var(--volume)"');
  });

  it("shows the hour axis and a single lime point when only one hourly capture exists", () => {
    const only = [{ t: easternHour("2026-09-30T10"), volumeUsd: 200_000_000, kind: "rolling_24h" as const }];
    const html = markup("24h", only);
    const slots = easternRollingHourStarts(Date.parse(GENERATED_AT) / 1000);
    expect(html).toContain(`data-hourly-axis-count="${slots.length}"`);
    expect(html).toContain(`data-volume-hour="${only[0]!.t}" data-volume-hour-empty="false"`);
    expect(html).toContain(`data-volume-hour="${easternHour("2026-09-30T09")}" data-volume-hour-empty="true"`);
    expect(html).toContain('data-volume-run-count="1"');
    expect(html).toContain(`data-volume-t="${only[0]!.t}"`);
    expect(html).toContain('data-volume-usd="200000000"');
    expect(html).toContain(`fill="${DESK_CHART_STROKE}"`);
    expect(html).not.toContain("data-volume-bar");
    expect(html).not.toContain('fill="url(#volume-area-24h)"');
    expect(html).toContain(HOURLY_VOLUME_SERIES_CAPTION);
    expect(html).toContain(`>${formatUsdCompact(220_500_000)}<`);
    expect(html).toContain('data-volume-kind="combined_24h"');
    expect(html).not.toContain(HOME_24H_ROBINHOOD_PLOT_NOTE);
  });
});

describe("DailyVolumeChart home Robinhood days", () => {
  const robinhoodDays: RobinhoodDeskDay[] = parseRobinhoodDeskDays({
    records: [
      {
        date: "2026-09-20",
        publicEquity24hUsd: 1_000_000,
        private24hUsd: null,
        etfIndex24hUsd: null,
        combined24hUsd: 1_000_000,
        generatedAt: "2026-09-21T04:00:00.000Z",
        sources: { chainId: 4663 },
      },
      {
        date: "2026-09-24",
        publicEquity24hUsd: 5_000_000,
        private24hUsd: null,
        etfIndex24hUsd: null,
        combined24hUsd: 5_000_000,
        generatedAt: "2026-09-25T04:00:00.000Z",
        sources: { chainId: 4663 },
      },
      {
        date: "2026-09-30",
        publicEquity24hUsd: 9_000_000,
        private24hUsd: null,
        etfIndex24hUsd: null,
        combined24hUsd: 9_000_000,
        generatedAt: "2026-10-01T04:00:00.000Z",
        sources: { chainId: 4663 },
      },
    ],
  });

  function withRobinhood(initialRange: "24h" | "7d") {
    return renderToStaticMarkup(
      createElement(DailyVolumeChart, {
        history: history([
          ...closedDays,
          { t: Date.UTC(2026, 8, 30) / 1000, volumeUsd: 999_000_000, kind: "rolling_24h" },
        ]),
        hourlyHistory: history(hourlyLevels),
        rolling24h: live,
        robinhoodDays,
        initialRange,
      }),
    );
  }

  it("adds closed Robinhood days to the 7D sum and leaves the in-progress day out", () => {
    const html = withRobinhood("7d");
    const solanaSum = closedDays.reduce((sum, point) => sum + point.volumeUsd, 0);
    expect(html).toContain(`>${formatUsdCompact(solanaSum + 1_000_000 + 5_000_000)}<`);
    expect(html).not.toContain(`>${formatUsdCompact(solanaSum)}<`);
    expect(html).not.toContain(formatUsdCompact(9_000_000));
    expect(html).toContain(HOME_CLOSED_RANGE_WITH_ROBINHOOD_FOOTER);
    expect(html).toContain('data-volume-includes-robinhood="true"');
    expect(html).toContain("Solana + Robinhood Chain");
    expect(html).toContain("not a true 12:00–11:59 PM ET window");
  });

  it("adds the last closed Robinhood day to the 24H headline and leaves the hourly area on Solana", () => {
    const html = withRobinhood("24h");
    expect(html).toContain(`>${formatUsdCompact(220_500_000 + 5_000_000)}<`);
    expect(html).not.toContain(`>${formatUsdCompact(220_500_000)}<`);
    expect(html).toContain("last closed Robinhood Chain snapshot");
    expect(html).toContain(HOME_24H_ROBINHOOD_PLOT_NOTE);
    expect(html).toContain('data-volume-usd="200000000"');
    expect(html).toContain('data-volume-usd="210000000"');
    expect(html).toContain('data-volume-usd="205000000"');
    expect(html).toContain('data-volume-usd="190000000"');
    expect(html).not.toContain('data-volume-usd="5000000"');
    expect(html).not.toContain(formatUsdCompact(999_000_000));
  });
});
