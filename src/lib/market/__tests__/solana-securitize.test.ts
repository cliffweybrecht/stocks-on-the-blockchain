import { describe, expect, it } from "vitest";
import { parseSecuritizeStocksPage, SECURITIZE_OFFICIAL_MINTS } from "../solana-securitize";

const aapl = SECURITIZE_OFFICIAL_MINTS.find((row) => row.symbol === "AAPL");
const spcx = SECURITIZE_OFFICIAL_MINTS.find((row) => row.symbol === "SPCX");
const secz = SECURITIZE_OFFICIAL_MINTS.find((row) => row.symbol === "SECZ");

function catalogPage(rows: unknown[]): string {
  const state = {
    mutations: [],
    queries: [{ queryKey: ["stocks-catalog"], state: { data: rows } }],
  };
  return `<!doctype html><script id="__REACT_QUERY_STATE__" type="application/json">${JSON.stringify(state)}</script>`;
}

function stock(input: {
  symbol: string;
  name: string;
  address: string;
  decimals?: number;
  iconSrc?: string;
}) {
  return {
    type: "stock",
    chainNamespace: "solana",
    symbol: input.symbol,
    name: input.name,
    decimals: input.decimals ?? 6,
    iconSrc: input.iconSrc ?? "data:image/png;base64,aaaa",
    tradingConfig: { tokenAddress: input.address, chainId: 900 },
  };
}

describe("parseSecuritizeStocksPage", () => {
  it("keeps verified mints and drops stables, copycats, and data-URI logos", () => {
    expect(aapl && spcx && secz).toBeTruthy();
    const parsed = parseSecuritizeStocksPage(
      catalogPage([
        stock({ symbol: "AAPL", name: "Apple", address: aapl!.address }),
        stock({ symbol: "SPCX", name: "Space Exploration Technologies Corp. Class A", address: spcx!.address }),
        stock({ symbol: "SECZ", name: "Securitize Corp", address: secz!.address }),
        {
          type: "stable",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          tradingConfig: { addresses: [{ chainId: 900, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }] },
        },
        stock({
          symbol: "AAPL",
          name: "Apple",
          address: "CopycatAppleSecuritize111111111111111111",
          iconSrc: "https://cdn.example/fake-apple.png",
        }),
        stock({ symbol: "AAPL", name: "Apple", address: aapl!.address, decimals: 9 }),
      ]),
    );

    expect(parsed.identities.map((row) => row.symbol)).toEqual(["AAPL", "SPCX", "SECZ"]);
    expect(parsed.identities.map((row) => row.name)).toEqual([
      "Apple - Securitize",
      "SpaceX Class A - Securitize",
      "Securitize Corp.",
    ]);
    expect(parsed.identities.map((row) => row.underlyingInstrumentType)).toEqual(["equity", "private", "equity"]);
    expect(parsed.identities[0]?.metadataUri).toBe("https://metadata.securitize.io/aapl.json");
    expect(parsed.logos[aapl!.address]).toBe("https://metadata.securitize.io/aapl.png");
    expect(parsed.logos[secz!.address]).toBe("https://metadata.securitize.io/secz_logo.png");
    expect(Object.values(parsed.logos).some((url) => url.startsWith("data:"))).toBe(false);
    expect(parsed.logos["CopycatAppleSecuritize111111111111111111"]).toBeUndefined();
  });

  it("fails closed when the catalog is missing or has no verified stocks", () => {
    expect(() => parseSecuritizeStocksPage({ tokens: [] })).toThrow(/not HTML/);
    expect(() => parseSecuritizeStocksPage("<html>no catalog</html>")).toThrow(/was not found/);
    expect(() =>
      parseSecuritizeStocksPage(
        catalogPage([
          {
            type: "stable",
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            tradingConfig: { tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
          },
        ]),
      ),
    ).toThrow(/zero Solana mints/);
  });
});
