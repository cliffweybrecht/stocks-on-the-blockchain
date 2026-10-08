import { createElement, type ReactNode } from "react";
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

import { CHAIN_VOLUME_TRACKS, ChainVolumeCard, ChainVolumeTable } from "./chain-volume-card";
import { formatUsdCompact } from "@/lib/market/format";
import { robinhoodHomeChainVolume } from "@/lib/market/home-desk-volume";
import { parseRobinhoodDeskDays, robinhoodSnapshotChainShell } from "@/lib/market/robinhood-desk-volume";
import type { ChainVolume } from "@/lib/market/types";

const days = parseRobinhoodDeskDays({
  records: [
    {
      date: "2026-10-05",
      publicEquity24hUsd: 30_452_397.6,
      private24hUsd: 2_352_414.29,
      etfIndex24hUsd: 15_750_857.01,
      combined24hUsd: 48_555_668.9,
      generatedAt: "2026-10-06T04:00:00.000Z",
      sources: { chainId: 4663 },
    },
  ],
});

function solanaChain(): ChainVolume {
  return {
    ...robinhoodSnapshotChainShell(),
    id: "solana",
    name: "Solana",
    shortName: "SOL",
    volume24hUsd: 72_600_000,
    privateVolume24hUsd: 24_700_000,
    etfVolume24hUsd: 6_400_000,
  };
}

describe("ChainVolumeCard", () => {
  it("gives Robinhood the same lane split without a snapshot column", () => {
    const chain = robinhoodHomeChainVolume(days);
    const html = renderToStaticMarkup(
      createElement(ChainVolumeCard, {
        chain,
        rank: 2,
        maxVolume: 103_700_000,
      }),
    );
    expect(html).toContain('data-chain-id="robinhood-chain"');
    expect(html).toContain('data-chain-rank="2"');
    expect(html).toContain('href="/chains/robinhood-chain"');
    expect(html).toContain(">Robinhood Chain<");
    expect(html).toContain(">#2<");
    expect(html).not.toContain("24h volume · public + private + ETF/index");
    expect(html).not.toContain("Public 24h");
    expect(html).not.toContain("Private 24h");
    expect(html).not.toContain("ETF/index 24h");
    expect(html).not.toContain(">24H Volume<");
    expect(html).not.toContain(">Public 24H<");
    expect(html).not.toContain(">Private 24H<");
    expect(html).not.toContain(">ETF/Index 24H<");
    expect(html).toContain('data-chain-volume-split="true"');
    expect(html).toContain("data-volume-share-bar");
    expect(html).toContain("grid-cols-subgrid");
    expect(html).toContain(`>${formatUsdCompact(48_555_668.9)}<`);
    expect(html).toContain(`>${formatUsdCompact(30_452_397.6)}<`);
    expect(html).toContain(`>${formatUsdCompact(2_352_414.29)}<`);
    expect(html).toContain(`>${formatUsdCompact(15_750_857.01)}<`);
    expect(html).not.toContain("last closed snapshot");
    expect(html).not.toContain(">Snapshot<");
    expect(html).not.toContain("data-chain-volume-note");
    expect(html).not.toMatch(/trailing h24/i);
    expect(html).not.toContain("12:00");
    expect(html).not.toContain(">$0<");
  });

  it("keeps the Solana lane split", () => {
    const html = renderToStaticMarkup(
      createElement(ChainVolumeCard, {
        chain: solanaChain(),
        rank: 1,
        maxVolume: 103_700_000,
      }),
    );
    expect(html).toContain('data-chain-id="solana"');
    expect(html).toContain('data-chain-rank="1"');
    expect(html).toContain('data-solana-volume-split="true"');
    expect(html).toContain('data-chain-volume-split="true"');
    expect(html).toContain(`>${formatUsdCompact(103_700_000)}<`);
    expect(html).not.toContain("data-chain-volume-note");
    expect(html).toContain("data-volume-share-bar");
    expect(html).not.toContain(">Public 24H<");
  });

  it("puts one header over the bubbles and lines every row up to the same tracks", () => {
    const robinhood = robinhoodHomeChainVolume(days);
    const html = renderToStaticMarkup(
      createElement(ChainVolumeTable, {
        rows: [
          { chain: solanaChain(), rank: 1, maxVolume: 103_700_000 },
          { chain: robinhood, rank: 2, maxVolume: 103_700_000 },
        ],
      }),
    );
    const headerAt = html.indexOf("data-chain-volume-header");
    const solanaAt = html.indexOf('data-chain-id="solana"');
    expect(headerAt).toBeGreaterThan(-1);
    expect(solanaAt).toBeGreaterThan(headerAt);
    expect(html).toContain(CHAIN_VOLUME_TRACKS);
    expect(html.match(/grid-cols-subgrid/g)?.length).toBe(3);
    expect(html.match(/>24H Volume</g)?.length).toBe(1);
    expect(html.match(/>Public 24H</g)?.length).toBe(1);
    expect(html.match(/>Private 24H</g)?.length).toBe(1);
    expect(html.match(/>ETF\/Index 24H</g)?.length).toBe(1);
    expect(html).not.toContain(">Snapshot<");
    expect(html).not.toContain("last closed snapshot");
    expect(html).toContain(">Chain<");
    expect(html).toContain(">#<");
    expect(html.indexOf(">#1<")).toBeGreaterThan(headerAt);
    expect(html.indexOf(">#2<")).toBeGreaterThan(html.indexOf(">#1<"));
  });

  it("renders an empty Robinhood row without inventing zero", () => {
    const html = renderToStaticMarkup(
      createElement(ChainVolumeCard, {
        chain: robinhoodHomeChainVolume([]),
        rank: 2,
        maxVolume: 10,
      }),
    );
    expect(html).toContain(">Robinhood Chain<");
    expect(html).toContain(">—<");
    expect(html).not.toContain("not reported as zero");
    expect(html).not.toContain("last closed snapshot");
    expect(html).not.toContain(">$0<");
  });
});
