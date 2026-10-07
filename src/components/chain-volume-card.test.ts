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

import { ChainVolumeCard } from "./chain-volume-card";
import { formatUsdCompact } from "@/lib/market/format";
import { robinhoodHomeChainVolume, robinhoodHomeVolumeDetail } from "@/lib/market/home-desk-volume";
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
  it("gives Robinhood the same lane split and a closed-snapshot note", () => {
    const chain = robinhoodHomeChainVolume(days);
    const html = renderToStaticMarkup(
      createElement(ChainVolumeCard, {
        chain,
        rank: 2,
        maxVolume: 103_700_000,
        detail: robinhoodHomeVolumeDetail(days),
      }),
    );
    expect(html).toContain('data-chain-id="robinhood-chain"');
    expect(html).toContain('data-chain-rank="2"');
    expect(html).toContain('href="/chains/robinhood-chain"');
    expect(html).toContain(">Robinhood Chain<");
    expect(html).toContain(">#2<");
    expect(html).toContain("24h volume · public + private + ETF/index");
    expect(html).toContain('data-chain-volume-split="true"');
    expect(html).toContain(`>${formatUsdCompact(48_555_668.9)}<`);
    expect(html).toContain(`>${formatUsdCompact(30_452_397.6)}<`);
    expect(html).toContain(`>${formatUsdCompact(2_352_414.29)}<`);
    expect(html).toContain(`>${formatUsdCompact(15_750_857.01)}<`);
    expect(html).toContain("Public 24h");
    expect(html).toContain("Private 24h");
    expect(html).toContain("ETF/index 24h");
    expect(html).toContain("2026-10-05 America/New_York");
    expect(html).toContain("not a 12:00–11:59 PM ET window");
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
  });

  it("renders an empty Robinhood row without inventing zero", () => {
    const html = renderToStaticMarkup(
      createElement(ChainVolumeCard, {
        chain: robinhoodHomeChainVolume([]),
        rank: 2,
        maxVolume: 10,
        detail: robinhoodHomeVolumeDetail([]),
      }),
    );
    expect(html).toContain(">Robinhood Chain<");
    expect(html).toContain(">—<");
    expect(html).toContain("not reported as zero");
    expect(html).not.toContain(">$0<");
  });
});
