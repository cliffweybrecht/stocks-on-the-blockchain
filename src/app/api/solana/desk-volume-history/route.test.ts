import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { easternMidnightUnix } from "@/lib/market/volume-snapshots";
import { GET } from "./route";

const SNAPSHOTS = ["solana.json", "base.json", "bnb.json", "robinhood.json"];

function porcelain(path: string): string {
  return execFileSync("git", ["status", "--porcelain", "--", path], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

describe("GET /api/solana/desk-volume-history", () => {
  it("leaves tracked snapshot files untouched and keeps every record t on New York midnight", async () => {
    const previous = process.env.SOLANA_MARKET_ENABLED;
    process.env.SOLANA_MARKET_ENABLED = "true";
    try {
      const before = SNAPSHOTS.map((name) => {
        const path = join("data", "volume-snapshots", name);
        return { path, text: readFileSync(path, "utf8"), status: porcelain(path) };
      });

      const response = await GET();
      expect(response.status).toBe(200);
      const body = (await response.json()) as { history?: { points?: unknown } };
      expect(Array.isArray(body.history?.points)).toBe(true);

      for (const row of before) {
        expect(readFileSync(row.path, "utf8")).toBe(row.text);
        expect(porcelain(row.path)).toBe(row.status);
        const payload = JSON.parse(row.text) as { records?: Array<{ date?: unknown; t?: unknown }> };
        const records = payload.records ?? [];
        expect(records.length).toBeGreaterThan(0);
        for (const record of records) {
          expect(typeof record.date).toBe("string");
          expect(record.t).toBe(easternMidnightUnix(String(record.date)));
        }
      }
    } finally {
      if (previous === undefined) delete process.env.SOLANA_MARKET_ENABLED;
      else process.env.SOLANA_MARKET_ENABLED = previous;
    }
  });
});
