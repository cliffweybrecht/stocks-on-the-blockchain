import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyLogoForSymbol, issuerBadgeSrc, underlyingTickerCandidates } from "../company-logo";

describe("underlyingTickerCandidates", () => {
  it("keeps a bare ticker and strips issuer suffixes before the uppercased form", () => {
    expect(underlyingTickerCandidates("NVDA")[0]).toBe("NVDA");
    expect(underlyingTickerCandidates("TSLAx")[0]).toBe("TSLA");
    expect(underlyingTickerCandidates("NVDAon")[0]).toBe("NVDA");
    expect(underlyingTickerCandidates("AAPLc")[0]).toBe("AAPL");
    expect(underlyingTickerCandidates("wtNVDA")[0]).toBe("NVDA");
    expect(underlyingTickerCandidates("deSPXA")[0]).toBe("SPXA");
    expect(underlyingTickerCandidates("tSpaceX")[0]).toBe("SPACEX");
  });

  it("does not turn General Dynamics xStock into the GDX gold-miners ETF", () => {
    expect(underlyingTickerCandidates("GDx")).toEqual(["GD"]);
    expect(underlyingTickerCandidates("GDX")).toEqual(["GDX"]);
    expect(companyLogoForSymbol("GDx")).toBeNull();
  });

  it("strips a bStocks suffix from the issuer, and from an uppercased symbol with no file", () => {
    expect(underlyingTickerCandidates("NVDAB", "bStocks")[0]).toBe("NVDA");
    expect(underlyingTickerCandidates("NVDAB")).toEqual(["NVDAB", "NVDA"]);
  });
});

describe("companyLogoForSymbol", () => {
  it("maps wrapped symbols onto the underlying company file", () => {
    const apple = companyLogoForSymbol("AAPL");
    expect(apple?.src).toBe("/company-logos/AAPL.svg");
    expect(companyLogoForSymbol("AAPLx")?.src).toBe(apple?.src);
    expect(companyLogoForSymbol("AAPLon")?.src).toBe(apple?.src);
    expect(companyLogoForSymbol("AAPLc")?.src).toBe(apple?.src);
    expect(companyLogoForSymbol("wtAAPL")?.src).toBe(apple?.src);
    expect(companyLogoForSymbol("NVDAon")?.src).toBe("/company-logos/NVDA.svg");
    expect(companyLogoForSymbol("TSLAx")?.src).toBe("/company-logos/TSLA.svg");
    expect(companyLogoForSymbol("NVDAB", "bStocks")?.src).toBe("/company-logos/NVDA.svg");
  });

  it("uses the fund or sponsor mark for ETFs and the company mark for private names", () => {
    expect(companyLogoForSymbol("SPY")?.src).toBe("/company-logos/SPY.svg");
    expect(companyLogoForSymbol("SPYx")?.src).toBe("/company-logos/SPY.svg");
    expect(companyLogoForSymbol("SPYM")?.src).toBe("/company-logos/SPY.svg");
    expect(companyLogoForSymbol("deSPXA")?.src).toBe("/company-logos/SPY.svg");
    expect(companyLogoForSymbol("QQQ")?.src).toBe("/company-logos/QQQ.svg");
    expect(companyLogoForSymbol("QQQM")?.src).toBe("/company-logos/QQQM.svg");
    expect(companyLogoForSymbol("SCHD")?.src).toBe("/company-logos/SCHD.png");
    expect(companyLogoForSymbol("SPCX")?.src).toBe("/company-logos/SPCX.png");
    expect(companyLogoForSymbol("SPCXx")?.src).toBe("/company-logos/SPCX.png");
    expect(companyLogoForSymbol("tSpaceX")?.src).toBe("/company-logos/SPCX.png");
    expect(companyLogoForSymbol("xOPAI")?.src).toBe("/company-logos/OPENAI.png");
  });

  it("leaves quote tokens and unknown names without a company file", () => {
    expect(companyLogoForSymbol("USDC")).toBeNull();
    expect(companyLogoForSymbol("USDG")).toBeNull();
    expect(companyLogoForSymbol("WETH")).toBeNull();
    expect(companyLogoForSymbol("NOTATICKER")).toBeNull();
  });

  it("points at files that exist", () => {
    for (const symbol of ["NVDA", "AAPL", "TSLA", "CRCL", "SPCX", "SPY", "QQQ"]) {
      const logo = companyLogoForSymbol(symbol);
      expect(logo, symbol).not.toBeNull();
      expect(existsSync(`public${logo!.src}`)).toBe(true);
    }
  });
});

describe("issuerBadgeSrc", () => {
  it("keeps the Robinhood feather as a corner badge and skips issuers without a mark", () => {
    expect(issuerBadgeSrc("RHJ")).toBe("/lending-logos/chains/robinhood.png");
    expect(issuerBadgeSrc("Robinhood Chain")).toBe("/lending-logos/chains/robinhood.png");
    expect(issuerBadgeSrc("xStocks")).toBeNull();
    expect(issuerBadgeSrc(null)).toBeNull();
  });
});
