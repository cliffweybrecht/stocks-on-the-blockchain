import { describe, expect, it } from "vitest";
import { mapDexScreenerPairsToSolanaAssets, unwrapDexScreenerPairs } from "../map-solana";
import { SOLANA_XSTOCK_MINTS } from "../solana-allowlist";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const aaplMint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";

const fixturePairs = [
  {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "pair-tsla-usdc",
    baseToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
    quoteToken: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USD Coin", symbol: "USDC" },
    priceUsd: "355.64",
    volume: { h24: 290_596.11 },
    liquidity: { usd: 2_027_739.88 },
    txns: { h24: { buys: 1277, sells: 1426 } },
  },
  {
    chainId: "solana",
    dexId: "orca",
    pairAddress: "pair-tsla-sol",
    baseToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
    quoteToken: { address: "So11111111111111111111111111111111111111112", name: "Wrapped SOL", symbol: "SOL" },
    priceUsd: 356.1,
    volume: { h24: 10_000 },
    liquidity: { usd: 50_000 },
    txns: { h24: { buys: 10, sells: 8 } },
  },
  {
    chainId: "solana",
    dexId: "raydium",
    pairAddress: "pair-aapl",
    baseToken: { address: aaplMint, name: "Apple xStock", symbol: "AAPLx" },
    quoteToken: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USD Coin", symbol: "USDC" },
    priceUsd: "321.60",
    volume: { h24: null },
    liquidity: { usd: 96_308.87 },
    txns: { h24: { buys: 1, sells: 1 } },
  },
  {
    chainId: "ethereum",
    dexId: "uniswap",
    pairAddress: "0xignore",
    baseToken: { address: tslaMint, name: "Tesla xStock", symbol: "TSLAx" },
    volume: { h24: 999_999 },
    liquidity: { usd: 999_999 },
  },
  {
    chainId: "solana",
    dexId: "pumpfun",
    pairAddress: "random-meme",
    baseToken: { address: "RandomMint1111111111111111111111111111111", name: "Not a stock", symbol: "MEME" },
    volume: { h24: 1_000_000 },
    liquidity: { usd: 1_000_000 },
  },
];

describe("unwrapDexScreenerPairs", () => {
  it("accepts a bare array and a { pairs } envelope", () => {
    expect(unwrapDexScreenerPairs(fixturePairs)).toHaveLength(5);
    expect(unwrapDexScreenerPairs({ pairs: fixturePairs })).toHaveLength(5);
  });

  it("fails closed on an unknown payload", () => {
    expect(() => unwrapDexScreenerPairs({ data: [] })).toThrow(/pair list/);
  });
});

describe("mapDexScreenerPairsToSolanaAssets", () => {
  it("aggregates allowlisted Solana pairs and ignores everything else", () => {
    const { assets, details } = mapDexScreenerPairsToSolanaAssets(fixturePairs, SOLANA_XSTOCK_MINTS);
    expect(assets.map((asset) => asset.symbol)).toEqual(["TSLAx", "AAPLx"]);
    const tsla = assets[0];
    expect(tsla?.volume24hUsd).toBeCloseTo(300_596.11);
    expect(tsla?.displayedLiquidityUsd).toBeCloseTo(2_077_739.88);
    expect(tsla?.poolCount).toBe(2);
    expect(tsla?.dexCount).toBe(2);
    expect(tsla?.robinhoodReferencePriceUsd).toBeNull();
    expect(tsla?.premiumDiscountPct).toBeNull();
    expect(tsla?.sourceId).toBe("solana");

    const aapl = assets[1];
    expect(aapl?.volume24hUsd).toBeNull();
    expect(aapl?.displayedLiquidityUsd).toBeCloseTo(96_308.87);

    expect(details[0]?.buys24h).toBe(1287);
    expect(details[0]?.dexes.map((dex) => dex.dexId)).toEqual(["raydium", "orca"]);
  });

  it("returns no assets when no allowlisted mint appears", () => {
    const { assets } = mapDexScreenerPairsToSolanaAssets(
      [{ chainId: "solana", volume: { h24: 1 }, baseToken: { address: "nope", symbol: "NOPE" } }],
      SOLANA_XSTOCK_MINTS,
    );
    expect(assets).toEqual([]);
  });
});
