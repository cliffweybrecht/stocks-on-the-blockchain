import { describe, expect, it } from "vitest";
import {
  mapDexScreenerPairsToSolanaAssets,
  mergeUnpairedSolanaAssets,
  unwrapDexScreenerPairs,
  unwrapDexScreenerSearch,
} from "../map-solana";
import { sortByVolumeThenLiquidity } from "../aggregate";

const tslaMint = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const aaplMint = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const otherTeslaMint = "OtherTeslaMint111111111111111111111111111";

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

describe("unwrapDexScreenerSearch", () => {
  it("treats a search envelope with null pairs as empty", () => {
    expect(unwrapDexScreenerSearch({ schemaVersion: "1.0.0", pairs: null })).toEqual([]);
  });

  it("fails closed on an unknown search payload", () => {
    expect(() => unwrapDexScreenerSearch({ data: [] })).toThrow(/search response/);
  });
});

describe("mapDexScreenerPairsToSolanaAssets", () => {
  it("aggregates every Solana pool under the mint and ignores non-equities", () => {
    const { assets, details } = mapDexScreenerPairsToSolanaAssets(fixturePairs);
    expect(assets.map((asset) => asset.symbol)).toEqual(["TSLAx", "AAPLx"]);
    const tsla = assets[0];
    expect(tsla?.volume24hUsd).toBeCloseTo(300_596.11);
    expect(tsla?.displayedLiquidityUsd).toBeCloseTo(2_077_739.88);
    expect(tsla?.poolCount).toBe(2);
    expect(tsla?.dexCount).toBe(2);
    expect(tsla?.issuer).toBe("Backed / xStocks");
    expect(tsla?.pools).toHaveLength(2);
    expect(tsla?.pools.map((pool) => pool.pairAddress)).toEqual(["pair-tsla-usdc", "pair-tsla-sol"]);
    expect(tsla?.pools[0]?.volume24hUsd).toBeCloseTo(290_596.11);
    expect(tsla?.robinhoodReferencePriceUsd).toBeNull();
    expect(tsla?.sourceId).toBe("solana");

    const aapl = assets[1];
    expect(aapl?.volume24hUsd).toBeNull();
    expect(aapl?.displayedLiquidityUsd).toBeCloseTo(96_308.87);
    expect(aapl?.volumeCoverage).toBe("pools_without_volume");
    expect(tsla?.volumeCoverage).toBe("reported");

    expect(details[0]?.buys24h).toBe(1287);
    expect(details[0]?.dexes.map((dex) => dex.dexId)).toEqual(["raydium", "orca"]);
    expect(details[0]?.largestPool?.pairAddress).toBe("pair-tsla-usdc");
  });

  it("does not treat one DexScreener pair as one stock and deduplicates the same pool", () => {
    const { assets } = mapDexScreenerPairsToSolanaAssets([
      fixturePairs[0]!,
      fixturePairs[0]!,
      fixturePairs[1]!,
    ]);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.poolCount).toBe(2);
    expect(assets[0]?.volume24hUsd).toBeCloseTo(300_596.11);
  });

  it("keeps different mints for the same ticker as separate stocks", () => {
    const { assets } = mapDexScreenerPairsToSolanaAssets([
      fixturePairs[0]!,
      {
        chainId: "solana",
        dexId: "meteora",
        pairAddress: "pair-other-tesla",
        baseToken: { address: otherTeslaMint, name: "Tesla Tokenized Stock", symbol: "TSLA" },
        quoteToken: { address: "usdc", name: "USDC", symbol: "USDC" },
        volume: { h24: 50_000 },
        liquidity: { usd: 12_000 },
      },
    ]);
    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.contractAddress).sort()).toEqual([otherTeslaMint, tslaMint].sort());
    expect(assets.find((asset) => asset.contractAddress === tslaMint)?.volume24hUsd).toBeCloseTo(290_596.11);
    expect(assets.find((asset) => asset.contractAddress === otherTeslaMint)?.volume24hUsd).toBe(50_000);
  });

  it("admits an equity mint that is not on the historical allowlist", () => {
    const { assets } = mapDexScreenerPairsToSolanaAssets([
      {
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "pair-hood",
        baseToken: {
          address: "XsNotAllowlisted1111111111111111111111111",
          name: "Robinhood xStock",
          symbol: "HOODx",
        },
        volume: { h24: 80 },
        liquidity: { usd: 10 },
      },
    ]);
    expect(assets).toHaveLength(1);
    expect(assets[0]?.symbol).toBe("HOODx");
  });

  it("returns no assets when nothing classifies as a tokenized equity", () => {
    const { assets } = mapDexScreenerPairsToSolanaAssets([
      { chainId: "solana", volume: { h24: 1 }, baseToken: { address: "nope", symbol: "NOPE", name: "Nope" } },
    ]);
    expect(assets).toEqual([]);
  });

  it("ranks null volume last and does not coerce missing volume to zero", () => {
    const ranked = sortByVolumeThenLiquidity([
      { symbol: "MSFTx", volume24hUsd: null, displayedLiquidityUsd: 9 },
      { symbol: "AAPLx", volume24hUsd: 0, displayedLiquidityUsd: 1 },
      { symbol: "TSLAx", volume24hUsd: 10, displayedLiquidityUsd: 1 },
    ]);
    expect(ranked.map((row) => row.symbol)).toEqual(["TSLAx", "AAPLx", "MSFTx"]);
  });

  it("keeps classified registry mints with no DexScreener pools as null-volume rows", () => {
    const mapped = mapDexScreenerPairsToSolanaAssets([fixturePairs[0]!]);
    const merged = mergeUnpairedSolanaAssets(mapped, [
      {
        mint: tslaMint,
        symbol: "TSLAx",
        name: "Tesla xStock",
        issuer: "Backed / xStocks",
        reason: "xStock name",
        kind: "equity",
      },
      {
        mint: "XsUnpairedNflx11111111111111111111111111",
        symbol: "NFLXx",
        name: "Netflix xStock",
        issuer: "Backed / xStocks",
        reason: "xStock name",
        kind: "equity",
      },
    ]);
    expect(merged.assets.map((asset) => asset.symbol)).toEqual(["TSLAx", "NFLXx"]);
    const nflx = merged.assets.find((asset) => asset.symbol === "NFLXx");
    expect(nflx?.volume24hUsd).toBeNull();
    expect(nflx?.poolCount).toBe(0);
    expect(nflx?.volumeCoverage).toBe("no_indexed_pools");
    expect(nflx?.contractAddress).toBe("XsUnpairedNflx11111111111111111111111111");
  });
});
