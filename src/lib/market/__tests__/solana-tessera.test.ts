import { describe, expect, it } from "vitest";
import { parseTesseraTokenMints } from "../solana-tessera";

const fixture = `
# On-Chain Programs

### Programs

#### Token Program

| Property | Value |
| --- | --- |
| Program ID | \`TESQvsR4TmYxiroPPQgZpVRoSFG8pru4fsYr67iv6kf\` |

### Token Mints

#### T-SpaceX (tSpaceX)

| Property | Value |
| --- | --- |
| Mint Address | \`TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v\` |
| Symbol | tSpaceX |

#### T-Kalshi (tKalshi)

| Property | Value |
| --- | --- |
| Mint Address | \`TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ\` |
| Symbol | tKalshi |

### Authorities & Security
`;

describe("parseTesseraTokenMints", () => {
  it("extracts official T-Token mints without treating the docs as an admission list", () => {
    const identities = parseTesseraTokenMints(fixture);
    expect(identities.map((row) => row.symbol)).toEqual(["tSpaceX", "tKalshi"]);
    expect(identities[0]?.address).toBe("TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v");
    expect(identities[0]?.name).toBe("T-SpaceX");
    expect(identities[0]?.underlyingInstrumentType).toBe("private");
  });

  it("fails closed on a malformed payload", () => {
    expect(() => parseTesseraTokenMints({ tokens: [] })).toThrow(/not text/);
    expect(() => parseTesseraTokenMints("no tokens here")).toThrow(/was not found/);
  });
});
