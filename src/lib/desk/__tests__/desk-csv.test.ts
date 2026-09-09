import { describe, expect, it } from "vitest";
import { buildDeskCsv, csvNullableNumber, deskCsvFilename, shapeDeskCsvRow } from "../desk-csv";

const tsla = {
  symbol: "TSLAx",
  name: 'Tesla "xStock"',
  issuer: "Backed / xStocks",
  contractAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  volume24hUsd: 0,
  displayedLiquidityUsd: 1_200.5,
  poolCount: 2,
  volumeCoverage: "reported" as const,
};

const empty = {
  symbol: "AALon",
  name: "American Airlines (Ondo Tokenized)",
  issuer: null,
  contractAddress: "AALon1111111111111111111111111111111111111",
  volume24hUsd: null,
  displayedLiquidityUsd: null,
  poolCount: 0,
  volumeCoverage: "no_indexed_pools" as const,
};

describe("csvNullableNumber", () => {
  it("keeps a reported 0 and leaves null blank", () => {
    expect(csvNullableNumber(0)).toBe("0");
    expect(csvNullableNumber(12.5)).toBe("12.5");
    expect(csvNullableNumber(null)).toBe("");
    expect(csvNullableNumber(undefined)).toBe("");
    expect(csvNullableNumber(Number.NaN)).toBe("");
  });
});

describe("shapeDeskCsvRow / buildDeskCsv", () => {
  it("shapes the current list with ranks and never writes fake zeros for null volume", () => {
    const row = shapeDeskCsvRow(empty, 3);
    expect(row.rank).toBe("3");
    expect(row.issuer).toBe("");
    expect(row.volume24hUsd).toBe("");
    expect(row.liquidity).toBe("");
    expect(row.poolCount).toBe("0");
    expect(row.coverage).toBe("Confirmed no pools");

    const csv = buildDeskCsv([tsla, empty]);
    expect(csv.startsWith("rank,symbol,name,issuer,mint,volume24hUsd,liquidity,poolCount,coverage\n")).toBe(true);
    expect(csv).toContain('1,TSLAx,"Tesla ""xStock""",Backed / xStocks,');
    expect(csv).toContain(",0,1200.5,2,With volume\n");
    expect(csv).toContain(",,,0,Confirmed no pools\n");
  });
});

describe("deskCsvFilename", () => {
  it("includes lane, coverage, and UTC date", () => {
    expect(
      deskCsvFilename({
        lane: "equity",
        coverage: "with-volume",
        at: new Date("2026-09-07T18:00:00.000Z"),
      }),
    ).toBe("solana-equity-with-volume-2026-09-07.csv");
    expect(deskCsvFilename({ lane: "etf", coverage: "hydrating", at: new Date("2026-09-07T00:00:00.000Z") })).toBe(
      "solana-etf-hydrating-2026-09-07.csv",
    );
    expect(deskCsvFilename({ lane: "private", coverage: "with-volume", at: new Date("2026-09-07T00:00:00.000Z") })).toBe(
      "solana-private-with-volume-2026-09-07.csv",
    );
  });
});
