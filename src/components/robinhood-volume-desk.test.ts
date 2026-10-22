import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeskVolumeRangeProvider } from "./desk-volume-range";
import { RobinhoodVolumeDesk } from "./robinhood-volume-desk";
import { parseRobinhoodDeskDays, type RobinhoodDeskDay } from "@/lib/market/robinhood-desk-volume";
import { formatUsdCompact } from "@/lib/market/format";
import { easternMidnightUnix } from "@/lib/market/volume-snapshots";

function days(): RobinhoodDeskDay[] {
  return parseRobinhoodDeskDays({
    records: [1, 2, 3].map((n) => ({
      date: `2026-10-0${n}`,
      publicEquity24hUsd: n * 1_000_000,
      private24hUsd: null,
      etfIndex24hUsd: 500_000,
      combined24hUsd: n * 1_000_000 + 500_000,
      displayedLiquidityUsd: n === 3 ? 12_000 : null,
      generatedAt: "2026-10-04T04:00:00.000Z",
      sources: { chainId: 4663 },
      issuersByLane: {
        equity: {
          rhj: { usd: n * 1_000_000 },
          ondo: { usd: n === 3 ? 40 : null },
        },
        etf: { rhj: { usd: 500_000 }, ondo: { usd: null } },
        private: { rhj: { usd: null } },
      },
    })),
  });
}

describe("RobinhoodVolumeDesk", () => {
  it("renders the range shell and a 7D chart from closed days", () => {
    const html = renderToStaticMarkup(createElement(RobinhoodVolumeDesk, { days: days() }));
    expect(html).toContain('data-robinhood-volume-desk');
    expect(html).toContain('data-volume-range="24h"');
    expect(html).toContain('data-volume-range="7d"');
    expect(html).toContain('data-volume-range="14d"');
    expect(html).toContain('data-volume-range="30d"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-volume-series="closed-day"');
    expect(html).toContain('stroke="var(--volume)"');
    expect(html).toMatch(/ C /);
    expect(html).toContain("overflow-hidden rounded-2xl");
    expect(html).toContain(formatUsdCompact(1_000_000 + 2_000_000 + 3_000_000 + 1_500_000));
    expect(html).not.toContain("data-robinhood-volume-note");
    expect(html).not.toContain("null omitted, not stored as $0");
    expect(html).not.toContain("data-issuer-lanes");
    expect(html).not.toContain("Issuer × type");
    expect(html).not.toContain("Ondo-named (unverified)");
  });

  it("keeps the shell and shows the last closed day as a 24H KPI, not a chart", () => {
    const html = renderToStaticMarkup(
      createElement(RobinhoodVolumeDesk, { days: days(), initialRange: "24h" }),
    );
    expect(html).toContain('data-volume-series="closed-day-kpi"');
    expect(html).not.toContain("<svg");
    expect(html).toContain(formatUsdCompact(3_500_000));
    expect(html).toContain("last closed snapshot");
    expect(html).not.toMatch(/trailing h24/i);
    expect(html).not.toContain("12:00");
    expect(html).toContain('data-volume-ranges');
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("data-robinhood-lane-split");
    expect(html).toContain("data-robinhood-liquidity");
    expect(html).not.toContain("data-robinhood-volume-note");
    expect(html).not.toContain("data-issuer-lanes");
    expect(html).not.toContain("Issuer × type");
  });

  it("still renders the range shell when no bars exist", () => {
    const html = renderToStaticMarkup(createElement(RobinhoodVolumeDesk, { days: [] }));
    expect(html).toContain('data-volume-range="30d"');
    expect(html).toContain("are not invented");
    expect(html).not.toContain("data-issuer-lanes");
    expect(html).not.toContain("No issuer split is invented");
    expect(html).not.toContain("data-robinhood-volume-note");
    expect(html).toContain('data-volume-kind="empty"');
    expect(html).toContain('data-volume-ranges');
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("justify-self-end");
    expect(html).not.toContain("flex-wrap");
    expect(html).not.toMatch(/trailing h24/i);
  });

  it("plots the sum of asset reserves for Liquidity and ignores a null day total", () => {
    const t = easternMidnightUnix("2026-10-19");
    const day = days()[0]!;
    const html = renderToStaticMarkup(
      createElement(DeskVolumeRangeProvider, {
        volumes: {},
        initialMetric: "liquidity",
        initialRange: "7d",
        liquidity: {
          lastClosedDay: "2026-10-19",
          snapshotDays: ["2026-10-19"],
          byAsset: {
            a: [{ date: "2026-10-19", t, liquidityUsd: 25 }],
            b: [{ date: "2026-10-19", t, liquidityUsd: 15 }],
          },
        },
        children: createElement(RobinhoodVolumeDesk, {
          days: [{ ...day, date: "2026-10-19", t, displayedLiquidityUsd: null, combined24hUsd: 5 }],
        }),
      }),
    );
    expect(html).toContain("Total liquidity");
    expect(html).toContain(formatUsdCompact(40));
    expect(html).toContain('data-liquidity-plot="series"');
    expect(html).toContain('data-headline-metric="liquidity"');
    expect(html).not.toContain("Issuer × type");
    expect(html).not.toContain("Total Daily Tokenized Stock Volume");
  });
});
