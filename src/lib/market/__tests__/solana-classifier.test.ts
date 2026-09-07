import { describe, expect, it } from "vitest";
import { classifyTokenizedEquity } from "../solana-classifier";

describe("classifyTokenizedEquity", () => {
  it("admits Backed xStock names without consulting an allowlist", () => {
    const result = classifyTokenizedEquity({
      address: "XsNotOnTheOldAllowlist1111111111111111111",
      symbol: "HOODx",
      name: "Robinhood xStock",
    });
    expect(result).toMatchObject({ kind: "equity", issuer: "Backed / xStocks" });
  });

  it("admits a Backed mint convention plus tickerx symbol", () => {
    const result = classifyTokenizedEquity({
      address: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
      symbol: "TSLAx",
      name: "TSLAx",
    });
    expect(result.kind).toBe("equity");
  });

  it("admits an explicit tokenized-stock phrase from another issuer", () => {
    const result = classifyTokenizedEquity({
      address: "OtherTeslaMint111111111111111111111111111",
      symbol: "TSLA",
      name: "Tesla Tokenized Stock",
    });
    expect(result).toMatchObject({ kind: "equity" });
  });

  it("rejects ordinary crypto", () => {
    expect(
      classifyTokenizedEquity({
        address: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Wrapped SOL",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        symbol: "BONK",
        name: "Bonk",
      }).kind,
    ).toBe("reject");
  });

  it("rejects stablecoins", () => {
    expect(
      classifyTokenizedEquity({
        address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        symbol: "USDC",
        name: "USD Coin",
      }).kind,
    ).toBe("reject");
  });

  it("rejects ETFs and index products even when they use xStock naming", () => {
    expect(
      classifyTokenizedEquity({
        address: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
        symbol: "SPYx",
        name: "SP500 xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
        symbol: "QQQx",
        name: "Nasdaq xStock",
      }).kind,
    ).toBe("reject");
  });

  it("rejects commodities and unverifiable tickers", () => {
    expect(
      classifyTokenizedEquity({
        address: "GoldMint11111111111111111111111111111111111",
        symbol: "XAU",
        name: "Tokenized Gold",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "RandomMint1111111111111111111111111111111",
        symbol: "TSLA",
        name: "Tesla",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "RandomMint1111111111111111111111111111111",
        symbol: "MEME",
        name: "Not a stock",
      }).kind,
    ).toBe("reject");
  });

  it("fails closed on malformed identity", () => {
    expect(classifyTokenizedEquity({ address: "", symbol: "TSLAx", name: "Tesla xStock" }).kind).toBe("reject");
    expect(classifyTokenizedEquity({ address: "mint", symbol: null, name: null }).kind).toBe("reject");
  });

  it("rejects generic category tokens, copycat xStock brands, and non-public RWAs", () => {
    expect(
      classifyTokenizedEquity({
        address: "5hBscPYy5Wmbet3paPKhB9WuPoq8FtUaBxJi6Ei6pump",
        symbol: "xStocks",
        name: "xStocks",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "GK517BU3J8fHvq54wQPjGnjaVrAu6e1KZfAk1UHDpump",
        symbol: "EQUITY",
        name: "Tokenized Equity",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "Fr4VPMoAgCPyEtzFAficBggbBz4SnjAbbh5oRXpiYKBR",
        symbol: "AMZNX",
        name: "Amazon tokenized (xStock)",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
        symbol: "SPACEX",
        name: "SpaceX PreStocks",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "TTRXx2ypNmtMALQpk9CEy3eCr7sq47tJohvfEtKVVZJ",
        symbol: "TTR",
        name: "Trump Tokenized Real Estate",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "7GetcwtjHasEtG8NoDsgguh9jhV7w3q12yamUWnqMuLQ",
        symbol: "STRC",
        name: "SaylorTokenizedRocketCum",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
        symbol: "SPCXx",
        name: "SpaceX xStock",
      }).kind,
    ).toBe("reject");
  });

  it("admits listed-company xStocks that previous rules false-negatived", () => {
    expect(
      classifyTokenizedEquity({
        address: "XsNasdaqInc11111111111111111111111111111",
        symbol: "NDAQx",
        name: "Nasdaq Inc. xStock",
      }).kind,
    ).toBe("equity");
    expect(
      classifyTokenizedEquity({
        address: "XsRoyalGold11111111111111111111111111111",
        symbol: "RGLDx",
        name: "Royal Gold xStock",
      }).kind,
    ).toBe("equity");
    expect(
      classifyTokenizedEquity({
        address: "XsLaopuGold11111111111111111111111111111",
        symbol: "LAOPGx",
        name: "Laopu Gold xStock",
      }).kind,
    ).toBe("equity");
    expect(
      classifyTokenizedEquity({
        address: "XsWharfRE1111111111111111111111111111111",
        symbol: "WHRFRx",
        name: "Wharf Real Estate Investment xStock",
      }).kind,
    ).toBe("equity");
    expect(
      classifyTokenizedEquity({
        address: "XsGoldman1111111111111111111111111111111",
        symbol: "GSx",
        name: "Goldman Sachs xStock",
      }).kind,
    ).toBe("equity");
    expect(
      classifyTokenizedEquity({
        address: "XsGeneralDynamics11111111111111111111111",
        symbol: "GDx",
        name: "General Dynamics xStock",
      }).kind,
    ).toBe("equity");
  });

  it("uses live issuer instrument type as a signal, not a mint allowlist", () => {
    expect(
      classifyTokenizedEquity({
        address: "OtherIssuerApple111111111111111111111111",
        symbol: "AAPL",
        name: "Apple",
        underlyingInstrumentType: "equity",
      }),
    ).toMatchObject({ kind: "equity", reason: "issuer-classified public equity" });
    expect(
      classifyTokenizedEquity({
        address: "OtherIssuerApple111111111111111111111111",
        symbol: "AAPL",
        name: "Apple",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsIssuerEtf11111111111111111111111111111",
        symbol: "EWYx",
        name: "Korea Basket xStock",
        underlyingInstrumentType: "etf",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsSheinStillPrivate111111111111111111111",
        symbol: "SHEINx",
        name: "SHEIN xStock",
        underlyingInstrumentType: "equity",
      }).kind,
    ).toBe("reject");
  });

  it("still rejects commodity products, ETF wrappers, and private-company xStocks", () => {
    expect(
      classifyTokenizedEquity({
        address: "XsGoldProduct111111111111111111111111111",
        symbol: "GLDx",
        name: "Gold xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsVanEckGoldMiners1111111111111111111111",
        symbol: "GDXx",
        name: "VanEck Gold Miners xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsISharesKorea11111111111111111111111111",
        symbol: "EWYx",
        name: "iShares MSCI South Korea xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsShein111111111111111111111111111111111",
        symbol: "SHEINx",
        name: "SHEIN xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "Xs2xLong11111111111111111111111111111111",
        symbol: "MUUx",
        name: "Micron 2x Long ETF xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsTqqq1111111111111111111111111111111111",
        symbol: "TQQQx",
        name: "TQQQ xStock",
      }).kind,
    ).toBe("reject");
    expect(
      classifyTokenizedEquity({
        address: "XsJpst1111111111111111111111111111111111",
        symbol: "JPSTx",
        name: "JPMorgan Ultra-Short Income xStock",
      }).kind,
    ).toBe("reject");
  });
});
