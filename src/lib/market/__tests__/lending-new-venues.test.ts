import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANCHORED_EXCLUDED_TICKERS } from "../base-markets";
import { formatUsdCompact } from "../format";
import { MORPHO_CHAINS } from "../lending-fetch";
import { buildLendingCompare } from "../lending-compare";
import { eulerBorrowApy, eulerLtv, parseEulerChain, parseEulerCollateralList } from "../lending-euler";
import { frankencoinPrivateShareFootnote, parseFrankencoin } from "../lending-frankencoin";
import { classifyLendingSymbol } from "../lending-stocks";
import { tokenCountFromRaw } from "../numbers";

const frankencoin = JSON.parse(readFileSync(new URL("./fixtures/frankencoin.json", import.meta.url), "utf8")) as {
  stats: { map: Record<string, { address?: string; symbol?: string; totalValueLocked?: { usd?: number }; price?: { usd?: number; chf?: number } }> };
  positions: { list: { collateral?: string; closed?: boolean; denied?: boolean; minted?: string; collateralBalance?: string; collateralDecimals?: number; zchfDecimals?: number; annualInterestPPM?: number }[] };
};
const euler = JSON.parse(readFileSync(new URL("./fixtures/euler.json", import.meta.url), "utf8")) as Record<
  string,
  {
    vaults: { address: string; asset: { address: string; symbol: string }; totalSupplyUsd: number; totalBorrowsUsd: number }[];
    metadata: unknown;
    collaterals: Record<string, unknown[]>;
  }
>;

const SPYON = "0xfedc5f4a6c38211c1338aa411018dfaf26612c08";
const BOSS = "0x2e880962a9609aa3eab4def919fe9e917e99073b";
const WSTETH = "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0";

function spyBook(): Set<string> {
  return new Set([SPYON, BOSS]);
}

describe("Morpho Robinhood Chain", () => {
  it("already asks Morpho for chain 4663", () => {
    expect(MORPHO_CHAINS).toContain(4663);
  });
});

describe("Frankencoin parser", () => {
  it("counts public SPYon, converts ZCHF with the API price, and skips the debt limit", () => {
    const row = parseFrankencoin({
      stats: frankencoin.stats,
      positions: frankencoin.positions,
      equityAddresses: spyBook(),
    });
    const spy = Object.values(frankencoin.stats.map).find((item) => item.symbol === "SPYon");
    const priceUsd = spy?.price?.usd ?? 0;
    const priceChf = spy?.price?.chf ?? 0;
    let tokens = 0;
    let zchf = 0;
    for (const position of frankencoin.positions.list) {
      if (position.closed || position.denied) continue;
      if (position.collateral?.toLowerCase() !== SPYON) continue;
      tokens += tokenCountFromRaw(position.collateralBalance, position.collateralDecimals ?? 18) ?? 0;
      zchf += tokenCountFromRaw(position.minted, position.zchfDecimals ?? 18) ?? 0;
    }
    expect(zchf).toBeGreaterThan(2_000_000);
    expect(row.error).toBeNull();
    expect(row.id).toBe("frankencoin-ethereum");
    expect(row.chainId).toBe("ethereum");
    expect(row.assets?.map((asset) => asset.symbol)).toEqual(["SPYon"]);
    expect(row.collateralUsd).toBeCloseTo(tokens * priceUsd, 2);
    expect(row.stableBorrowedUsd).toBeCloseTo(zchf * (priceUsd / priceChf), 2);
    expect(row.borrowApy).toBeCloseTo(0.01, 8);
    expect(row.borrowApyMin).toBeCloseTo(0.01, 8);
    expect(row.borrowApyMax).toBeCloseTo(0.01, 8);
    expect(row.lendSupplyUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.note).toBe("The debt is in ZCHF, a Swiss franc coin. It is 2.73M ZCHF, shown here in dollars.");
    expect(row.footnote).toContain("Swiss private-company shares are left out");
    expect(row.footnote).toContain("BOSS");
    expect(row.footnote).toContain("DQTS");
    expect(row.footnote).toContain("REALU");
    expect(row.footnote).toContain("LENDS");
    expect(row.footnote).toContain(formatUsdCompact(privateTvl(frankencoin.stats)));
    expect(row.footnote).toContain("not real market prices");
    expect(row.assets?.some((asset) => asset.address === BOSS || asset.address === WSTETH)).toBe(false);
  });

  it("ignores a closed position and a same-symbol token that is not in the address book", () => {
    const stats = structuredClone(frankencoin.stats);
    const fake = "0x1111111111111111111111111111111111111111";
    stats.map[fake] = {
      ...stats.map[SPYON],
      address: fake,
      symbol: "SPYon",
      totalValueLocked: { usd: 9_000_000 },
    };
    const positions = structuredClone(frankencoin.positions);
    const closed = positions.list.find((position) => position.closed);
    expect(closed).toBeTruthy();
    if (closed) closed.minted = "9000000000000000000000000";
    const row = parseFrankencoin({ stats, positions, equityAddresses: spyBook() });
    const honest = parseFrankencoin({
      stats: frankencoin.stats,
      positions: frankencoin.positions,
      equityAddresses: spyBook(),
    });
    expect(row.stableBorrowedUsd).toBeCloseTo(honest.stableBorrowedUsd ?? 0, 2);
    expect(row.collateralUsd).toBeCloseTo(honest.collateralUsd ?? 0, 2);
    expect(row.assets?.some((asset) => asset.address === fake)).toBe(false);
  });

  it("reads the private-share footnote size from the API", () => {
    const stats = structuredClone(frankencoin.stats);
    const boss = Object.values(stats.map).find((item) => item.symbol === "BOSS");
    expect(boss?.totalValueLocked).toBeTruthy();
    if (boss?.totalValueLocked) boss.totalValueLocked.usd = 1_000;
    const footnote = frankencoinPrivateShareFootnote(stats);
    expect(footnote).toContain(formatUsdCompact(privateTvl(stats)));
    expect(footnote).not.toContain(formatUsdCompact(privateTvl(frankencoin.stats)));
  });

  it("refuses to match when the address book is empty", () => {
    const row = parseFrankencoin({ stats: frankencoin.stats, positions: frankencoin.positions, equityAddresses: new Set() });
    expect(row.collateralUsd).toBeNull();
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.error).toMatch(/not matched by symbol/);
  });
});

describe("Euler parser", () => {
  it("turns percent APY and parts-per-10,000 LTV into fractions", () => {
    expect(eulerBorrowApy(6.680686308738111)).toBeCloseTo(0.06680686308738111, 10);
    expect(eulerLtv("8000")).toBeCloseTo(0.8, 6);
    expect(eulerLtv(0.8)).toBeCloseTo(0.8, 6);
  });

  it("reads a collateral list from the API payload or a raw array", () => {
    const item = euler["1"].collaterals["0xdfa6451eac51c913003bfeb52418f55376996a64"]?.[0];
    expect(parseEulerCollateralList({ data: [item] })).toHaveLength(1);
    expect(parseEulerCollateralList([item])).toHaveLength(1);
    expect(parseEulerCollateralList(item)).toEqual([]);
  });

  it("counts Ethereum stock vaults and only all-stock stable borrows", () => {
    const chain = euler["1"];
    const book = stockBook(chain, "ethereum");
    const row = parseEulerChain({
      chainId: 1,
      vaults: chain.vaults,
      metadata: chain.metadata,
      collaterals: chain.collaterals,
      equityAddresses: book,
    });
    expect(row.error).toBeNull();
    expect(row.id).toBe("euler-ethereum");
    expect(row.collateralUsd).toBeCloseTo(collateralOf(chain, book, "ethereum"), 4);
    expect(row.stableBorrowedUsd).toBeCloseTo(12200.138028005116 + 140.2898702998606, 4);
    expect(row.lendSupplyUsd).toBeCloseTo(17425.656755086056 + 1667.722572872981, 4);
    expect(row.utilization).toBeCloseTo((row.stableBorrowedUsd ?? 0) / (row.lendSupplyUsd ?? 1), 6);
    expect(row.borrowApyMin).toBeCloseTo(0.06680686308738111, 8);
    expect(row.borrowApyMax).toBeCloseTo(0.06680686308738111, 8);
    expect(row.assets?.find((asset) => asset.symbol === "wSTRCx")?.maxLtv).toBeCloseTo(0.8, 6);
    expect(row.assets?.some((asset) => asset.symbol === "AUSD" || asset.symbol === "PYUSD")).toBe(false);
    expect(row.note).toBeNull();

    const wrapped = parseEulerChain({
      chainId: 1,
      vaults: { data: chain.vaults },
      metadata: chain.metadata,
      collaterals: Object.fromEntries(Object.entries(chain.collaterals).map(([address, list]) => [address, { data: list }])),
      equityAddresses: book,
    });
    expect(wrapped.stableBorrowedUsd).toBeCloseTo(row.stableBorrowedUsd ?? 0, 4);
  });

  it("does not treat a loaded empty collateral list as a failed read", () => {
    const chain = euler["1"];
    const empty = Object.fromEntries(Object.keys(chain.collaterals).map((address) => [address, []]));
    const row = parseEulerChain({
      chainId: 1,
      vaults: chain.vaults,
      metadata: chain.metadata,
      collaterals: empty,
      equityAddresses: stockBook(chain, "ethereum"),
    });
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.note ?? "").not.toMatch(/did not load/);
  });

  it("leaves a borrow blank when its collateral list did not load", () => {
    const chain = euler["1"];
    const row = parseEulerChain({
      chainId: 1,
      vaults: chain.vaults,
      metadata: chain.metadata,
      collaterals: {},
      equityAddresses: stockBook(chain, "ethereum"),
    });
    expect(row.collateralUsd).not.toBeNull();
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.note).toMatch(/collateral list did not load/);
  });

  it("drops silver and bonds and leaves the mixed Poppie pool blank", () => {
    const chain = euler["56"];
    const book = stockBook(chain, "bnb");
    for (const list of Object.values(chain.collaterals)) {
      for (const item of list) {
        const asset = (item as { asset?: string }).asset;
        if (asset) book.add(asset.toLowerCase());
      }
    }
    const row = parseEulerChain({
      chainId: 56,
      vaults: chain.vaults,
      metadata: chain.metadata,
      collaterals: chain.collaterals,
      equityAddresses: book,
    });
    expect(row.assets?.some((asset) => asset.symbol === "SLVon" || asset.symbol === "TLTon")).toBe(false);
    expect(row.assets?.some((asset) => asset.symbol === "NVDAon")).toBe(true);
    expect(row.collateralUsd).toBeCloseTo(collateralOf(chain, book, "bnb"), 4);
    expect(chain.vaults.find((vault) => vault.asset.symbol === "SLVon")?.totalSupplyUsd ?? 0).toBeGreaterThan(10_000);
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.lendSupplyUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.note).toBe("Poppie Ondo Markets also takes things that are not stocks, so the dollars borrowed there are left blank.");
  });

  it("counts Base stock tokens and leaves mixed dollar pools blank", () => {
    const chain = euler["8453"];
    const book = stockBook(chain, "base");
    const row = parseEulerChain({
      chainId: 8453,
      vaults: chain.vaults,
      metadata: chain.metadata,
      collaterals: chain.collaterals,
      equityAddresses: book,
    });
    expect(row.assets?.some((asset) => asset.symbol === "wtCOIN")).toBe(true);
    expect(row.assets?.some((asset) => asset.symbol === "wtSPYM")).toBe(true);
    expect(row.assets?.some((asset) => asset.symbol === "deSPXA")).toBe(true);
    expect(row.collateralUsd).toBeCloseTo(collateralOf(chain, book, "base"), 4);
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.utilization).toBeNull();
    expect(row.note).toMatch(/not stocks/);
    expect(row.stockBorrowedUsd).toBeGreaterThan(0);

    const fake = structuredClone(chain.vaults);
    fake.push({
      ...chain.vaults.find((vault) => vault.asset.symbol === "wtCOIN")!,
      address: "0x2222222222222222222222222222222222222222",
      asset: { address: "0x3333333333333333333333333333333333333333", symbol: "wtCOIN" },
      totalSupplyUsd: 9_000_000,
      totalBorrowsUsd: 0,
    });
    const withoutFake = parseEulerChain({
      chainId: 8453,
      vaults: fake,
      metadata: chain.metadata,
      collaterals: chain.collaterals,
      equityAddresses: book,
    });
    expect(withoutFake.collateralUsd).toBeCloseTo(row.collateralUsd ?? 0, 4);
  });

  it("does not match Euler tokens by symbol when the book is empty", () => {
    const row = parseEulerChain({
      chainId: 8453,
      vaults: euler["8453"].vaults,
      metadata: euler["8453"].metadata,
      collaterals: euler["8453"].collaterals,
      equityAddresses: new Set(),
    });
    expect(row.collateralUsd).toBeNull();
    expect(row.stableBorrowedUsd).toBeNull();
    expect(row.error).toMatch(/not matched by symbol/);
  });
});

describe("lending compare notes", () => {
  it("keeps a venue note on the place card", () => {
    const model = buildLendingCompare(
      [
        {
          id: "frankencoin-ethereum",
          venue: "Frankencoin",
          chainId: "ethereum",
          chainLabel: "Ethereum",
          borrowApy: 0.01,
          borrowApyMin: 0.01,
          borrowApyMax: 0.01,
          stableBorrowedUsd: 100,
          lendSupplyUsd: null,
          borrowEstimate: null,
          source: "https://api.frankencoin.com/ecosystem/collateral/stats",
          note: "The debt is in ZCHF, a Swiss franc coin. It is 2.73M ZCHF, shown here in dollars.",
          assets: [{ symbol: "SPYon", address: SPYON, collateralUsd: 50, collateralTokens: 1, maxLtv: null }],
        },
      ],
      "2026-10-20T16:00:00.000Z",
    );
    expect(model.places.SPY?.[0]?.note).toMatch(/ZCHF/);
    expect(model.places.SPY?.[0]?.howFull).toBeNull();
  });
});

function privateTvl(stats: { map: Record<string, { symbol?: string; totalValueLocked?: { usd?: number } }> }): number {
  const names = new Set(["BOSS", "DQTS", "REALU", "LENDS"]);
  return Object.values(stats.map).reduce((sum, item) => {
    if (!item.symbol || !names.has(item.symbol) || item.totalValueLocked?.usd == null) return sum;
    return sum + item.totalValueLocked.usd;
  }, 0);
}

function stockBook(
  chain: { vaults: { asset: { address: string; symbol: string } }[] },
  chainId: string,
): Set<string> {
  const book = new Set<string>();
  for (const vault of chain.vaults) {
    const ticker = classifyLendingSymbol(vault.asset.symbol, chainId).ticker;
    if (vault.asset.symbol === "USDC" || vault.asset.symbol === "USDT" || vault.asset.symbol === "AUSD" || vault.asset.symbol === "PYUSD") continue;
    if (ANCHORED_EXCLUDED_TICKERS.has(ticker) && vault.asset.symbol !== "SLVon" && vault.asset.symbol !== "TLTon") continue;
    book.add(vault.asset.address.toLowerCase());
  }
  return book;
}

function collateralOf(
  chain: { vaults: { asset: { address: string; symbol: string }; totalSupplyUsd: number }[] },
  book: ReadonlySet<string>,
  chainId: string,
): number {
  let sum = 0;
  for (const vault of chain.vaults) {
    if (!book.has(vault.asset.address.toLowerCase())) continue;
    const ticker = classifyLendingSymbol(vault.asset.symbol, chainId).ticker;
    if (ANCHORED_EXCLUDED_TICKERS.has(ticker)) continue;
    if (!(vault.totalSupplyUsd > 0)) continue;
    sum += vault.totalSupplyUsd;
  }
  return sum;
}
