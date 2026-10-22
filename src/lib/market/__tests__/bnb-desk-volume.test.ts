import { describe, expect, it } from "vitest";
import { BNB_DESK, readBnbSnapshotMarketValue } from "../bnb-desk-volume";
import { parseSnapshotDeskDays } from "../snapshot-desk-volume";

describe("BNB snapshot market value", () => {
  it("keeps a day that has no market-value fields, and does not turn that into zero", () => {
    const row = {
      date: "2026-10-19",
      publicEquity24hUsd: 12,
      private24hUsd: null,
      etfIndex24hUsd: 3,
      combined24hUsd: 15,
      issuersByLane: {
        equity: { bstocks: { usd: 12, mints: 2, pools: 1 } },
        etf: {},
        private: {},
      },
      assets: [{ address: "0xabc", symbol: "BNCB", volume24hUsd: 12, pools: [] }],
      sources: { chainId: 56, chainSlug: "bsc" },
    };
    const market = readBnbSnapshotMarketValue(row);
    expect(market.publicEquityMarketValueUsd).toBeNull();
    expect(market.etfIndexMarketValueUsd).toBeNull();
    expect(market.privateMarketValueUsd).toBeNull();
    expect(market.combinedMarketValueUsd).toBeNull();
    expect(market.marketValueSource).toBeNull();
    expect(market.marketValueReadAt).toBeNull();
    expect(market.equity[0]).toMatchObject({ slug: "bstocks", marketValueUsd: null, marketValueMints: null });
    expect(market.assets).toEqual([]);

    const days = parseSnapshotDeskDays({ records: [row] }, BNB_DESK);
    expect(days).toHaveLength(1);
    expect(days[0]?.combined24hUsd).toBe(15);
    expect(days[0]?.publicEquity24hUsd).toBe(12);
    expect(days[0]?.equity[0]?.usd).toBe(12);
  });

  it("reads stored market value and keeps an explicit zero", () => {
    const market = readBnbSnapshotMarketValue({
      date: "2026-10-20",
      publicEquityMarketValueUsd: 40,
      etfIndexMarketValueUsd: 0,
      privateMarketValueUsd: null,
      combinedMarketValueUsd: 40,
      marketValueSource: "bsc-erc20-totalSupply x dexscreener-cash-pool-else-geckoterminal",
      marketValueReadAt: "2026-10-21T03:59:00Z",
      issuersByLane: {
        equity: { xstocks: { usd: 1, marketValueUsd: 40, marketValueMints: 1 } },
        etf: { ondo: { usd: null, marketValueUsd: 0, marketValueMints: 1 } },
        private: { paimon: { usd: null, marketValueUsd: null, marketValueMints: 0 } },
      },
      assets: [
        {
          address: "0xaaa",
          symbol: "AAPLx",
          supply: 10,
          priceUsd: 4,
          priceSource: "dexscreener",
          marketValueUsd: 40,
        },
        {
          address: "0xbbb",
          symbol: "QQQon",
          supply: 0,
          priceUsd: 8,
          priceSource: "geckoterminal",
          marketValueUsd: 0,
        },
      ],
      sources: { chainId: "56", chainSlug: "bsc" },
    });
    expect(market.publicEquityMarketValueUsd).toBe(40);
    expect(market.etfIndexMarketValueUsd).toBe(0);
    expect(market.privateMarketValueUsd).toBeNull();
    expect(market.combinedMarketValueUsd).toBe(40);
    expect(market.equity[0]?.label).toBe("xStocks");
    expect(market.etf[0]).toMatchObject({ slug: "ondo", marketValueUsd: 0, marketValueMints: 1 });
    expect(market.private[0]?.marketValueMints).toBe(0);
    expect(market.assets.map((asset) => asset.marketValueUsd)).toEqual([40, 0]);
    expect(market.assets[1]?.priceSource).toBe("geckoterminal");
  });

  it("derives a missing combined total from the lanes and drops a negative", () => {
    const derived = readBnbSnapshotMarketValue({
      publicEquityMarketValueUsd: 5,
      etfIndexMarketValueUsd: null,
      privateMarketValueUsd: 2,
    });
    expect(derived.combinedMarketValueUsd).toBe(7);
    const explicitNull = readBnbSnapshotMarketValue({
      publicEquityMarketValueUsd: 5,
      combinedMarketValueUsd: null,
    });
    expect(explicitNull.combinedMarketValueUsd).toBeNull();
    const negative = readBnbSnapshotMarketValue({ publicEquityMarketValueUsd: -1, combinedMarketValueUsd: -4 });
    expect(negative.publicEquityMarketValueUsd).toBeNull();
    expect(negative.combinedMarketValueUsd).toBeNull();
  });
});
