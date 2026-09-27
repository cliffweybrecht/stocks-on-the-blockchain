import { describe, expect, it } from "vitest";
import {
  applyOutstandingMintSupply,
  fetchMintUiSupply,
  parseGetTokenSupply,
  valuationFromSupply,
} from "../solana-supply";

/** Live NVDAx `getTokenSupply` shape: UI amount includes the Token-2022 multiplier. */
const NVDAX_SUPPLY = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    context: { slot: 1 },
    value: {
      amount: "32127242493018",
      decimals: 8,
      uiAmount: 321818.97255174,
      uiAmountString: "321818.97255174",
    },
  },
};

const NVDAX_UI = 321818.97255174;
const NVDAX_RAW_UI = 32127242493018 / 10 ** 8;

describe("parseGetTokenSupply", () => {
  it("uses uiAmountString so Token-2022 scaled UI is not dropped", () => {
    expect(parseGetTokenSupply(NVDAX_SUPPLY)).toBe(NVDAX_UI);
    expect(parseGetTokenSupply(NVDAX_SUPPLY)).not.toBeCloseTo(NVDAX_RAW_UI, 2);
  });

  it("does not invent UI supply from raw amount and decimals when the string is unreadable", () => {
    expect(
      parseGetTokenSupply({
        result: {
          value: {
            amount: "32127242493018",
            decimals: 8,
            uiAmount: NVDAX_RAW_UI,
            uiAmountString: "321,818.97",
          },
        },
      }),
    ).toBeNull();
  });

  it("accepts uiAmount only when uiAmountString was omitted", () => {
    expect(
      parseGetTokenSupply({
        result: { value: { amount: "100000000", decimals: 8, uiAmount: 1 } },
      }),
    ).toBe(1);
  });

  it("treats a missing mint and an RPC error as unknown supply", () => {
    expect(parseGetTokenSupply({ result: { value: null } })).toBeNull();
    expect(parseGetTokenSupply({ error: { code: -32602, message: "Invalid param" } })).toBeNull();
    expect(parseGetTokenSupply(null)).toBeNull();
    expect(parseGetTokenSupply({ result: { value: { uiAmountString: "0" } } })).toBe(0);
  });
});

describe("valuationFromSupply", () => {
  it("sets market cap from circulating supply and FDV from total supply", () => {
    const price = 225.39;
    const valuation = valuationFromSupply({
      priceUsd: price,
      circulatingSupply: 300_000,
      totalSupply: 321_819,
    });
    expect(valuation.marketCapUsd).toBeCloseTo(price * 300_000);
    expect(valuation.fdvUsd).toBeCloseTo(price * 321_819);
    expect(valuation.circulatingSupply).toBe(300_000);
    expect(valuation.totalSupply).toBe(321_819);
  });

  it("does not invent market cap when circulating supply is missing", () => {
    const valuation = valuationFromSupply({
      priceUsd: 225.39,
      circulatingSupply: null,
      totalSupply: NVDAX_UI,
    });
    expect(valuation.marketCapUsd).toBeNull();
    expect(valuation.fdvUsd).toBeCloseTo(225.39 * NVDAX_UI);
    expect(valuation.circulatingSupply).toBeNull();
  });

  it("does not invent FDV when total supply is missing", () => {
    const valuation = valuationFromSupply({
      priceUsd: 225.39,
      circulatingSupply: NVDAX_UI,
      totalSupply: null,
    });
    expect(valuation.fdvUsd).toBeNull();
    expect(valuation.marketCapUsd).toBeCloseTo(225.39 * NVDAX_UI);
  });

  it("leaves both caps blank when supply and a positive price are not both known", () => {
    expect(
      valuationFromSupply({ priceUsd: null, circulatingSupply: NVDAX_UI, totalSupply: NVDAX_UI }),
    ).toMatchObject({ marketCapUsd: null, fdvUsd: null, circulatingSupply: NVDAX_UI });
    expect(
      valuationFromSupply({ priceUsd: 0, circulatingSupply: NVDAX_UI, totalSupply: NVDAX_UI }),
    ).toMatchObject({ marketCapUsd: null, fdvUsd: null });
    expect(
      valuationFromSupply({ priceUsd: 225, circulatingSupply: null, totalSupply: null }),
    ).toEqual({
      circulatingSupply: null,
      totalSupply: null,
      marketCapUsd: null,
      fdvUsd: null,
    });
  });

  it("keeps a reported zero supply as zero instead of a dash", () => {
    expect(valuationFromSupply({ priceUsd: 10, circulatingSupply: 0, totalSupply: 0 })).toEqual({
      circulatingSupply: 0,
      totalSupply: 0,
      marketCapUsd: 0,
      fdvUsd: 0,
    });
  });

  it("drops non-finite products", () => {
    expect(
      valuationFromSupply({
        priceUsd: Number.MAX_VALUE,
        circulatingSupply: Number.MAX_VALUE,
        totalSupply: 1,
      }).marketCapUsd,
    ).toBeNull();
  });
});

describe("applyOutstandingMintSupply", () => {
  const priced = {
    dexMedianPriceUsd: 225.39,
    displayedLiquidityUsd: 4_100_000,
    volume24hUsd: 5_400_000,
    marketCapUsd: 225_300,
    fdvUsd: 225_300,
    circulatingSupply: null,
    totalSupply: null,
  };

  it("replaces a DexScreener-sized cap with price × mint UI supply", () => {
    const next = applyOutstandingMintSupply(priced, NVDAX_UI);
    expect(next.circulatingSupply).toBe(NVDAX_UI);
    expect(next.totalSupply).toBe(NVDAX_UI);
    expect(next.marketCapUsd).toBeCloseTo(225.39 * NVDAX_UI);
    expect(next.fdvUsd).toBeCloseTo(225.39 * NVDAX_UI);
    expect(next.marketCapUsd).toBeGreaterThan(50_000_000);
    expect(next.displayedLiquidityUsd).toBe(4_100_000);
  });

  it("does not keep a fake cap or derive one from liquidity when the mint supply is missing", () => {
    const next = applyOutstandingMintSupply(priced, null);
    expect(next.circulatingSupply).toBeNull();
    expect(next.totalSupply).toBeNull();
    expect(next.marketCapUsd).toBeNull();
    expect(next.fdvUsd).toBeNull();
    expect(next.displayedLiquidityUsd).toBe(4_100_000);
    expect(next.volume24hUsd).toBe(5_400_000);
  });
});

describe("fetchMintUiSupply", () => {
  it("posts getTokenSupply and reads the scaled UI amount", async () => {
    const bodies: string[] = [];
    const supply = await fetchMintUiSupply("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", {
      rpcUrl: "https://rpc.example.test",
      timeoutMs: 1_000,
      fetchImpl: async (url, init) => {
        expect(url).toBe("https://rpc.example.test");
        expect(init?.method).toBe("POST");
        bodies.push(String(init?.body));
        return new Response(JSON.stringify(NVDAX_SUPPLY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({
      method: "getTokenSupply",
      params: ["Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"],
    });
    expect(supply).toBe(NVDAX_UI);
  });

  it("returns null when the RPC fails", async () => {
    const supply = await fetchMintUiSupply("mint", {
      rpcUrl: "https://rpc.example.test",
      timeoutMs: 1_000,
      fetchImpl: async () => new Response("nope", { status: 502 }),
    });
    expect(supply).toBeNull();
  });
});
