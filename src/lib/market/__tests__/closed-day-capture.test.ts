import { describe, expect, it } from "vitest";
import {
  buildClosedDayTotals,
  isPerpInstrument,
  parseGeckoOhlcvCandles,
  readKnownPoolSides,
  sumHourlyCandlesOnEasternDay,
} from "../closed-day-capture";

const DAY = "2026-10-08";
const START = Date.parse("2026-10-08T04:00:00Z") / 1000;

describe("closed Eastern day capture", () => {
  it("sums hourly candles inside the America/New_York midnight window", () => {
    const summed = sumHourlyCandlesOnEasternDay(
      [
        { t: START - 3600, volumeUsd: 50 },
        { t: START, volumeUsd: 10 },
        { t: START + 3600, volumeUsd: 2.5 },
        { t: START + 24 * 3600, volumeUsd: 99 },
      ],
      DAY,
    );
    expect(summed.covered).toBe(true);
    expect(summed.volumeUsd).toBe(12.5);
  });

  it("counts a stock-stock pool once on the base and prefers the Gecko day", () => {
    const totals = buildClosedDayTotals({
      kinds: new Map([
        ["baseMint", "equity"],
        ["quoteMint", "equity"],
        ["etfMint", "etf"],
      ]),
      pools: [
        {
          pairAddress: "pool-cross",
          dexId: "raydium",
          baseAddress: "baseMint",
          quoteAddress: "quoteMint",
          dexVolumeUsd: 100,
          liquidityUsd: 10,
          geckoVolumeUsd: 80,
          geckoOk: true,
        },
        {
          pairAddress: "pool-etf",
          dexId: "orca",
          baseAddress: "etfMint",
          quoteAddress: "usdc",
          dexVolumeUsd: 40,
          liquidityUsd: 5,
          geckoVolumeUsd: null,
          geckoOk: false,
        },
      ],
    });
    expect(totals.byAddress.get("baseMint")?.volumeUsd).toBe(80);
    expect(totals.byAddress.get("quoteMint")?.volumeUsd).toBeNull();
    expect(totals.byAddress.get("etfMint")?.volumeUsd).toBe(40);
    expect(totals.publicEquity24hUsd).toBe(80);
    expect(totals.etfIndex24hUsd).toBe(40);
    expect(totals.combined24hUsd).toBe(120);
    expect(totals.volumeSource).toBe("geckoterminal-hourly-et+dexscreener-h24-fallback");
    expect(totals.dexCombined24hUsd).toBe(140);
    expect(totals.geckoCombined24hUsd).toBe(80);
    expect(totals.crossCheck).toBe("dex-gecko-gap");
  });

  it("keeps a DexScreener fallback when Gecko has no candles and excludes perps", () => {
    expect(isPerpInstrument("TSLA", "Tesla perpetual")).toBe(true);
    expect(isPerpInstrument("PERPLEXITY", "Perplexity")).toBe(false);
    const candles = parseGeckoOhlcvCandles({
      data: { attributes: { ohlcv_list: [[START, 1, 1, 1, 1, 7]] } },
    });
    expect(sumHourlyCandlesOnEasternDay(candles, DAY).volumeUsd).toBe(7);
    const totals = buildClosedDayTotals({
      kinds: new Map([["mint", "equity"]]),
      pools: [
        {
          pairAddress: "only-dex",
          dexId: "raydium",
          baseAddress: "mint",
          quoteAddress: "usdc",
          dexVolumeUsd: 15,
          liquidityUsd: null,
          geckoVolumeUsd: null,
          geckoOk: false,
        },
      ],
    });
    expect(totals.combined24hUsd).toBe(15);
    expect(totals.volumeSource).toBe("dexscreener-h24-fallback");
    expect(totals.crossCheck).toBeNull();
  });

  it("keeps a Gecko-only pool out of the DexScreener cross-check total", () => {
    const totals = buildClosedDayTotals({
      kinds: new Map([["mint", "equity"]]),
      pools: [
        {
          pairAddress: "infinity",
          dexId: "uniswap-v4",
          baseAddress: "mint",
          quoteAddress: "usdc",
          dexVolumeUsd: 500,
          liquidityUsd: 1_000,
          geckoVolumeUsd: 80,
          geckoOk: true,
          includeInDexSample: false,
        },
      ],
    });
    expect(totals.combined24hUsd).toBe(80);
    expect(totals.dexCombined24hUsd).toBeNull();
    expect(totals.geckoCombined24hUsd).toBe(80);
    expect(totals.crossCheck).toBeNull();
    const sides = readKnownPoolSides(
      JSON.stringify({ poolSides: { infinity: { pair: "infinity", base: "mint", quote: "usdc" } } }),
    );
    expect(sides).toEqual([{ pair: "infinity", base: "mint", quote: "usdc" }]);
  });
});
