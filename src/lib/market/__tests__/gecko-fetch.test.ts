import { describe, expect, it } from "vitest";
import { fetchGeckoJson, type GeckoPace } from "../gecko-fetch";
import { buildClosedDayTotals, loadSolanaClosedDayPools } from "../closed-day-capture";
import { easternMidnightUnix } from "../volume-snapshots";

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    random: () => 0.25,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("fetchGeckoJson", () => {
  it("retries 429 and 503 with exponential backoff and jitter, then returns the body", async () => {
    const pace: GeckoPace = { nextAt: 0 };
    const time = clock();
    const statuses = [429, 503, 200];
    const result = await fetchGeckoJson({
      url: "https://api.geckoterminal.com/api/v2/networks/solana/pools/abc/ohlcv/hour",
      fetchImpl: async () => {
        const status = statuses.shift() ?? 200;
        return jsonResponse(
          { data: { attributes: { ohlcv_list: [[1, 0, 0, 0, 0, 4]] } } },
          status,
          status === 429 ? { "retry-after": "3" } : {},
        );
      },
      pace,
      sleep: time.sleep,
      now: time.now,
      random: time.random,
      minIntervalMs: 2100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(3);
    expect(statuses).toEqual([]);
  });

  it("does not retry a 404", async () => {
    let calls = 0;
    const result = await fetchGeckoJson({
      url: "https://api.geckoterminal.com/missing",
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({}, 404);
      },
      pace: { nextAt: 0 },
      sleep: async () => {},
      now: () => 0,
      minIntervalMs: 0,
    });
    expect(result).toMatchObject({ ok: false, reason: "not-found", attempts: 1 });
    expect(calls).toBe(1);
  });

  it("returns retries-exhausted after timeouts", async () => {
    let calls = 0;
    const result = await fetchGeckoJson({
      url: "https://api.geckoterminal.com/slow",
      fetchImpl: async () => {
        calls += 1;
        throw new Error("timed out");
      },
      pace: { nextAt: 0 },
      sleep: async () => {},
      now: () => 1_000_000,
      random: () => 0,
      maxAttempts: 3,
      minIntervalMs: 0,
    });
    expect(result).toMatchObject({ ok: false, reason: "retries-exhausted", attempts: 3 });
    expect(calls).toBe(3);
  });
});

describe("loadSolanaClosedDayPools gecko retries", () => {
  const day = "2026-10-16";
  const start = easternMidnightUnix(day);

  it("keeps the Eastern candle after a 429 instead of the Dex h24", async () => {
    let ohlcvCalls = 0;
    const pools = await loadSolanaClosedDayPools({
      dayKey: day,
      minIntervalMs: 0,
      maxAttempts: 4,
      sleep: async () => {},
      now: () => 0,
      random: () => 0,
      assets: [
        {
          contractAddress: "mint",
          symbol: "TSLAx",
          name: "Tesla",
          instrumentKind: "equity",
          pools: [
            {
              pairAddress: "pool-1",
              dexId: "raydium",
              volume24hUsd: 50,
              liquidityUsd: 1_000,
              baseAddress: "mint",
              quoteAddress: "usdc",
            },
          ],
        },
      ],
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/ohlcv/")) {
          ohlcvCalls += 1;
          if (ohlcvCalls < 3) return jsonResponse({}, 429);
          return jsonResponse({
            data: { attributes: { ohlcv_list: [[start, 1, 1, 1, 1, 12.5]] } },
          });
        }
        return jsonResponse({ data: [] });
      },
    });
    expect(ohlcvCalls).toBe(3);
    expect(pools[0]?.geckoOk).toBe(true);
    expect(pools[0]?.geckoVolumeUsd).toBe(12.5);
    const totals = buildClosedDayTotals({
      pools,
      kinds: new Map([["mint", "equity"]]),
    });
    expect(totals.combined24hUsd).toBe(12.5);
    expect(totals.volumeSource).toBe("geckoterminal-hourly-et");
    expect(totals.dexscreenerH24Fallbacks).toEqual([]);
  });

  it("records the pool only after retries are exhausted", async () => {
    let ohlcvCalls = 0;
    const pools = await loadSolanaClosedDayPools({
      dayKey: day,
      minIntervalMs: 0,
      maxAttempts: 3,
      sleep: async () => {},
      now: () => 0,
      random: () => 0,
      assets: [
        {
          contractAddress: "mint",
          symbol: "TSLAx",
          name: "Tesla",
          instrumentKind: "equity",
          pools: [
            {
              pairAddress: "pool-1",
              dexId: "raydium",
              volume24hUsd: 50,
              liquidityUsd: 1_000,
            },
          ],
        },
      ],
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/ohlcv/")) {
          ohlcvCalls += 1;
          throw new Error("timed out");
        }
        return jsonResponse({ data: [] });
      },
    });
    expect(ohlcvCalls).toBe(3);
    expect(pools[0]?.fallbackReason).toBe("retries-exhausted");
    const totals = buildClosedDayTotals({
      pools,
      kinds: new Map([["mint", "equity"]]),
    });
    expect(totals.combined24hUsd).toBe(50);
    expect(totals.volumeSource).toBe("dexscreener-h24-fallback");
    expect(totals.dexscreenerH24Fallbacks).toEqual([
      {
        pairAddress: "pool-1",
        dexId: "raydium",
        volume24hUsd: 50,
        symbol: "TSLAx",
        source: "dexscreener-h24-fallback",
        reason: "retries-exhausted",
      },
    ]);
  });
});
