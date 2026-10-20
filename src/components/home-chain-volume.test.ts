import { createElement, type ReactNode } from "react";
import type { VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    prefetch?: boolean;
  }) => {
    delete props.prefetch;
    return createElement("a", { href, ...props }, children);
  },
}));

import { DeskVolumeRangeProvider } from "./desk-volume-range";
import { HomeChainVolume } from "./home-chain-volume";
import type { HomeClosedRangeBoard } from "@/lib/market/home-chain-range";
import { robinhoodSnapshotChainShell } from "@/lib/market/robinhood-desk-volume";
import { BASE_CHAIN_ID, BNB_CHAIN_ID, ROBINHOOD_CHAIN_ID, SOLANA_CHAIN_ID, type ChainVolume } from "@/lib/market/types";

function chain(id: string, name: string, volume: number | null): ChainVolume {
  return {
    ...robinhoodSnapshotChainShell(),
    id,
    name,
    shortName: name,
    volume24hUsd: volume,
    privateVolume24hUsd: null,
    etfVolume24hUsd: null,
  };
}

function legs(combinedUsd: number | null, days: number, publicUsd: number | null = combinedUsd) {
  return {
    volume24hUsd: publicUsd,
    privateVolume24hUsd: null,
    etfVolume24hUsd: null,
    combinedUsd,
    days,
  };
}

const ranges: HomeClosedRangeBoard = {
  "7d": {
    headlineUsd: 30,
    windowDayCount: 7,
    byChainId: {
      [SOLANA_CHAIN_ID]: legs(10, 7),
      [ROBINHOOD_CHAIN_ID]: legs(20, 3),
      [BASE_CHAIN_ID]: legs(null, 0),
      [BNB_CHAIN_ID]: legs(null, 0),
    },
  },
  "14d": {
    headlineUsd: 30,
    windowDayCount: 7,
    byChainId: {},
  },
  "30d": {
    headlineUsd: 70,
    windowDayCount: 10,
    byChainId: {
      [SOLANA_CHAIN_ID]: legs(10, 10),
      [ROBINHOOD_CHAIN_ID]: legs(60, 4),
      [BASE_CHAIN_ID]: legs(null, 0),
      [BNB_CHAIN_ID]: legs(null, 0),
    },
  },
};

function renderAt(initialRange: VolumeChartRangeId, chains: ChainVolume[]) {
  const Provider = DeskVolumeRangeProvider as unknown as (props: {
    volumes: Record<string, never>;
    initialRange?: VolumeChartRangeId;
    children?: ReactNode;
  }) => ReactNode;
  return renderToStaticMarkup(
    createElement(Provider, { volumes: {}, initialRange }, createElement(HomeChainVolume, { chains, ranges })),
  );
}

describe("HomeChainVolume", () => {
  const chains = [
    chain(SOLANA_CHAIN_ID, "Solana", 100),
    chain(ROBINHOOD_CHAIN_ID, "Robinhood Chain", 5),
    chain(BASE_CHAIN_ID, "Base", null),
  ];

  it("follows the shared 30D range, re-ranks, and keeps a partial chain", () => {
    const html = renderAt("30d", chains);
    expect(html).toContain('data-chain-volume-range="30d"');
    expect(html).toContain(">30D Volume<");
    expect(html).toContain(">Public 30D<");
    expect(html).toContain(">4 of 30 days<");
    expect(html).not.toContain(">24H Volume<");
    expect(html.indexOf('data-chain-id="robinhood-chain"')).toBeLessThan(html.indexOf('data-chain-id="solana"'));
    expect(html).toContain(">Base<");
    expect(html).toContain(">—<");
    expect(html).not.toContain(">$0<");
  });

  it("keeps 24H labels and the live chain order when that range is selected", () => {
    const html = renderAt("24h", chains);
    expect(html).toContain('data-chain-volume-range="24h"');
    expect(html).toContain(">24H Volume<");
    expect(html).toContain(">Public 24H<");
    expect(html).not.toContain("of 7 days");
    expect(html.indexOf('data-chain-id="solana"')).toBeLessThan(html.indexOf('data-chain-id="robinhood-chain"'));
  });

  it("drops a disabled Ethereum row and leaves the other chains' volumes in place", () => {
    const html = renderAt("24h", [...chains, chain("ethereum", "Ethereum", 4_530_000)]);
    expect(html).not.toContain('data-chain-id="ethereum"');
    expect(html).not.toContain(">Ethereum<");
    expect(html).not.toContain("$4.5M");
    expect(html).toContain('data-chain-id="solana" data-chain-rank="1"');
    expect(html).toContain("$100.0");
    expect(html).toContain("$5.0");
    expect(html).toContain(">Base<");
  });
});
