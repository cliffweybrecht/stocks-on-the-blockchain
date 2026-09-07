import { describe, expect, it } from "vitest";
import { parseOndoGmConstants } from "../solana-ondo";

const fixture = `
pub const GM_TOKENS: [(&str, &str); 3] = [
    ("TSLAon", "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo"),
    ("SPYon", "111111111111111111111111111111111111spyondo"),
    ("TSLAon", "KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo"),
];
`;

describe("parseOndoGmConstants", () => {
  it("extracts unique Solana mints from the public GM token list", () => {
    const identities = parseOndoGmConstants(fixture);
    expect(identities.map((row) => row.symbol)).toEqual(["TSLAon", "SPYon"]);
    expect(identities[0]?.address).toBe("KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo");
  });

  it("fails closed on a malformed payload", () => {
    expect(() => parseOndoGmConstants({ tokens: [] })).toThrow(/not text/);
    expect(() => parseOndoGmConstants("no tokens here")).toThrow(/was not found/);
  });
});
