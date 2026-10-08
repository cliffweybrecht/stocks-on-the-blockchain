import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SnapshotVolumeDesk } from "./snapshot-volume-desk";
import { BASE_DESK } from "@/lib/market/base-desk-volume";
import { BNB_DESK } from "@/lib/market/bnb-desk-volume";
import { formatUsdCompact } from "@/lib/market/format";
import {
  closedSnapshotDeskDays,
  parseSnapshotDeskDays,
  snapshotDeskDaysForRange,
  snapshotDeskVolumePoints,
} from "@/lib/market/snapshot-desk-volume";
import { sumVolumePoints } from "@/lib/market/daily-volume-view";

const nowT = Date.parse("2026-10-08T03:00:00Z") / 1000;

function closed(file: string, config: typeof BASE_DESK) {
  const payload = JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots", file), "utf8"));
  return closedSnapshotDeskDays(parseSnapshotDeskDays(payload, config), nowT);
}

describe("SnapshotVolumeDesk", () => {
  it("renders Base 7D from recorded bars with the range toggles pinned top-right", () => {
    const days = closed("base.json", BASE_DESK);
    const html = renderToStaticMarkup(
      createElement(SnapshotVolumeDesk, { desk: { chainId: BASE_DESK.chainId, name: BASE_DESK.name }, days }),
    );
    const seven = sumVolumePoints(snapshotDeskVolumePoints(snapshotDeskDaysForRange(days, "7d")));
    expect(html).toContain('data-snapshot-volume-desk');
    expect(html).toContain('data-chain-id="base"');
    expect(html).toContain('data-volume-range="24h"');
    expect(html).toContain('data-volume-range="7d"');
    expect(html).toContain('data-volume-range="14d"');
    expect(html).toContain('data-volume-range="30d"');
    expect(html).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(html).toContain("flex-nowrap");
    expect(html).toContain("justify-self-end");
    expect(html).not.toContain("flex-wrap");
    expect(html).toContain('data-volume-series="closed-day"');
    expect(html).toMatch(/ C /);
    expect(html).toContain("overflow-hidden rounded-2xl");
    expect(html).toContain(`>${formatUsdCompact(seven)}<`);
    expect(html).toContain("Coinbase");
    expect(html).toContain("ST0x");
    expect(html).not.toMatch(/trailing h24/i);
    expect(html).not.toContain("12:00");
  });

  it("uses the last closed BNB day as the 24H KPI", () => {
    const days = closed("bnb.json", BNB_DESK);
    const html = renderToStaticMarkup(
      createElement(SnapshotVolumeDesk, {
        desk: { chainId: BNB_DESK.chainId, name: BNB_DESK.name },
        days,
        initialRange: "24h",
      }),
    );
    expect(html).toContain('data-chain-id="bnb"');
    expect(html).toContain('data-volume-series="closed-day-kpi"');
    expect(html).not.toContain("<svg");
    expect(html).toContain(formatUsdCompact(27_166_818.630000003));
    expect(html).toContain("24H · 2026-10-05 America/New_York · last closed snapshot");
    expect(html).toContain("data-snapshot-lane-split");
    expect(html).toContain('data-issuer="ondo"');
    expect(html).toContain('data-issuer-official="true"');
    expect(html).toContain("bStocks");
    expect(html).toContain("Colb Finance");
    expect(html).not.toMatch(/trailing h24/i);
  });

  it("keeps the range shell when the file contributed no days", () => {
    const html = renderToStaticMarkup(
      createElement(SnapshotVolumeDesk, { desk: { chainId: BASE_DESK.chainId, name: BASE_DESK.name }, days: [] }),
    );
    expect(html).toContain('data-volume-kind="empty"');
    expect(html).toContain('data-volume-ranges');
    expect(html).toContain("are not invented");
    expect(html).not.toMatch(/trailing h24/i);
  });
});
