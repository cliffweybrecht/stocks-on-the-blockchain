import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyLiquiditySanity,
  correctStoredSnapshotAssets,
  LIQUIDITY_SANITY_REASON_DEAD_DEPTH,
  LIQUIDITY_SANITY_REASON_DOMINANCE,
  LIQUIDITY_SANITY_REASON_GECKO,
  readStoredAssetLiquidityUsd,
} from "../liquidity-sanity";
import { asNonNegativeNumber } from "../numbers";
import {
  deskSnapshotAssetsFromSummaries,
  parseDeskVolumeSnapshotRecords,
  serializeDeskVolumeSnapshots,
} from "../volume-snapshots";

const ORCA_SPCX = "7co5wJY7chDAmkE8Rd3UsSkwjB1X8YC4WDB1FqoyyMYY";
const METEORA_SPCX = "3rnGsqSr5fFXNVjhEEQjiERFu64YH2ChKsdwfRei7QmD";
const BACKPACK_SPCX = "Ae1nDy28fKVEwKPS8wqW2iCz15Kpe6yhMQkK2r2hfjru";
const SEP30_SPCX = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";

const SNAPSHOT_FILES = ["solana.json", "bnb.json", "robinhood.json", "base.json"] as const;

function readSnapshot(file: string): { records?: unknown[] } {
  return JSON.parse(readFileSync(join(process.cwd(), "data/volume-snapshots", file), "utf8"));
}

describe("applyLiquiditySanity", () => {
  it("drops a $50M+ reserve whose 24h volume is under 0.01% of liquidity", () => {
    const result = applyLiquiditySanity({
      pools: [{ poolId: ORCA_SPCX, liquidityUsd: 596_294_797.53, volume24hUsd: 10.96 }],
    });
    expect(result.displayedLiquidityUsd).toBe(0);
    expect(result.excludedLiquidityPools).toEqual([
      {
        poolId: ORCA_SPCX,
        liquidityUsd: 596_294_797.53,
        reason: LIQUIDITY_SANITY_REASON_DEAD_DEPTH,
      },
    ]);
  });

  it("keeps a deep pool that trades and keeps the exact $50M and 0.01% boundaries", () => {
    expect(
      applyLiquiditySanity({
        pools: [{ poolId: "deep", liquidityUsd: 60_000_000, volume24hUsd: 10_000 }],
      }).displayedLiquidityUsd,
    ).toBe(60_000_000);
    expect(
      applyLiquiditySanity({
        pools: [{ poolId: "edge", liquidityUsd: 50_000_000, volume24hUsd: 0 }],
      }).displayedLiquidityUsd,
    ).toBe(50_000_000);
    expect(
      applyLiquiditySanity({
        pools: [{ poolId: "ratio", liquidityUsd: 60_000_000, volume24hUsd: 6_000 }],
      }).displayedLiquidityUsd,
    ).toBe(60_000_000);
  });

  it("keeps the asset's other pools when one reserve is excluded", () => {
    const result = applyLiquiditySanity({
      pools: [
        { poolId: METEORA_SPCX, liquidityUsd: 442_228_509.38, volume24hUsd: 29_053.87 },
        { poolId: "real", liquidityUsd: 1_966_749.25, volume24hUsd: 100 },
      ],
    });
    expect(result.displayedLiquidityUsd).toBe(1_966_749.25);
    expect(result.excludedLiquidityPools.map((row) => row.poolId)).toEqual([METEORA_SPCX]);
  });

  it("applies the dominance check only when market value is known", () => {
    const pools = [
      { poolId: "wide", liquidityUsd: 40_000_000, volume24hUsd: 5_000_000 },
      { poolId: "next", liquidityUsd: 100_000, volume24hUsd: 1_000 },
    ];
    expect(applyLiquiditySanity({ pools }).displayedLiquidityUsd).toBe(40_100_000);
    const known = applyLiquiditySanity({ pools, marketValueUsd: 1_000_000 });
    expect(known.displayedLiquidityUsd).toBe(100_000);
    expect(known.excludedLiquidityPools[0]?.reason).toBe(LIQUIDITY_SANITY_REASON_DOMINANCE);
    expect(
      applyLiquiditySanity({
        pools: [{ poolId: "only", liquidityUsd: 40_000_000, volume24hUsd: 5_000_000 }],
        marketValueUsd: 1_000_000,
      }).displayedLiquidityUsd,
    ).toBe(40_000_000);
  });

  it("uses a far-lower Gecko reserve even when the raw print has almost no volume", () => {
    const result = applyLiquiditySanity({
      pools: [{ poolId: ORCA_SPCX, liquidityUsd: 596_294_797.53, volume24hUsd: 10.96, geckoReserveUsd: 2_000_000 }],
    });
    expect(result.displayedLiquidityUsd).toBe(2_000_000);
    expect(result.excludedLiquidityPools[0]?.reason).toBe(LIQUIDITY_SANITY_REASON_GECKO);
    expect(result.excludedLiquidityPools[0]?.liquidityUsd).toBe(596_294_797.53);
  });

  it("uses a far-lower GeckoTerminal reserve and still records the raw figure", () => {
    const result = applyLiquiditySanity({
      pools: [{ poolId: "pool", liquidityUsd: 2_000_000, volume24hUsd: 50_000, geckoReserveUsd: 20_000 }],
    });
    expect(result.displayedLiquidityUsd).toBe(20_000);
    expect(result.excludedLiquidityPools).toEqual([
      {
        poolId: "pool",
        liquidityUsd: 2_000_000,
        reason: LIQUIDITY_SANITY_REASON_GECKO,
        replacementLiquidityUsd: 20_000,
      },
    ]);
  });

  it("leaves volume on the nightly asset row and records the excluded pool", () => {
    const [row] = deskSnapshotAssetsFromSummaries([
      {
        contractAddress: BACKPACK_SPCX,
        symbol: "SPCX",
        issuer: "Backpack Securities",
        instrumentKind: "private",
        volume24hUsd: 10.96,
        displayedLiquidityUsd: 596_294_797.53,
        pools: [{ pairAddress: ORCA_SPCX, dexId: "orca", volume24hUsd: 10.96, liquidityUsd: 596_294_797.53 }],
      },
    ]);
    expect(row?.volume24hUsd).toBe(10.96);
    expect(row?.pools[0]?.volume24hUsd).toBe(10.96);
    expect(row?.pools[0]?.liquidityUsd).toBe(596_294_797.53);
    expect(row?.displayedLiquidityUsd).toBe(0);
    expect(row?.excludedLiquidityPools?.[0]?.poolId).toBe(ORCA_SPCX);
    expect(readStoredAssetLiquidityUsd(row ?? {})).toBe(0);
  });
});

describe("stored liquidity corrections", () => {
  it("round-trips correction and excluded pools through the Solana snapshot parser", () => {
    const serialized = serializeDeskVolumeSnapshots([
      {
        date: "2026-10-11",
        t: 1,
        publicEquity24hUsd: 1,
        private24hUsd: null,
        etfIndex24hUsd: null,
        combined24hUsd: 1,
        publicMintCount: null,
        publicPoolCount: null,
        generatedAt: "2026-10-12T04:07:32.706Z",
        assets: [
          {
            address: BACKPACK_SPCX,
            symbol: "SPCX",
            instrumentKind: "private",
            volume24hUsd: 10.96,
            displayedLiquidityUsd: 0,
            pools: [{ pairAddress: ORCA_SPCX, dexId: "orca", volume24hUsd: 10.96, liquidityUsd: 596_294_797.53 }],
            excludedLiquidityPools: [
              { poolId: ORCA_SPCX, liquidityUsd: 596_294_797.53, reason: LIQUIDITY_SANITY_REASON_DEAD_DEPTH },
            ],
            correction: {
              reason: `excluded pool ${ORCA_SPCX} raw liquidity 596294797.53: ${LIQUIDITY_SANITY_REASON_DEAD_DEPTH}`,
              displayedLiquidityUsd: 596_294_797.53,
            },
          },
        ],
      },
    ]);
    const [row] = parseDeskVolumeSnapshotRecords(JSON.parse(serialized));
    expect(row?.assets?.[0]?.displayedLiquidityUsd).toBe(0);
    expect(row?.assets?.[0]?.volume24hUsd).toBe(10.96);
    expect(row?.assets?.[0]?.correction?.displayedLiquidityUsd).toBe(596_294_797.53);
    expect(row?.assets?.[0]?.excludedLiquidityPools?.[0]?.poolId).toBe(ORCA_SPCX);
    expect(row?.combined24hUsd).toBe(1);
  });

  it("matches the guard on every stored chain and keeps the three SPCX corrections", () => {
    const expected = [
      {
        date: "2026-09-30",
        address: SEP30_SPCX,
        poolId: METEORA_SPCX,
        before: 444_195_258.63,
        after: 1_966_749.25,
        raw: 442_228_509.38,
        poolVolume: 29_053.87,
        assetVolume: 9_314_815.26,
      },
      {
        date: "2026-10-11",
        address: BACKPACK_SPCX,
        poolId: ORCA_SPCX,
        before: 596_294_797.53,
        after: 0,
        raw: 596_294_797.53,
        poolVolume: 10.96,
        assetVolume: 10.96,
      },
      {
        date: "2026-10-12",
        address: BACKPACK_SPCX,
        poolId: ORCA_SPCX,
        before: 596_989_189.19,
        after: 0,
        raw: 596_989_189.19,
        poolVolume: 0.11,
        assetVolume: 0.11,
      },
    ];
    const found: typeof expected = [];
    for (const file of SNAPSHOT_FILES) {
      const payload = readSnapshot(file);
      expect(correctStoredSnapshotAssets(structuredClone(payload))).toEqual([]);
      for (const row of payload.records ?? []) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const assets = Array.isArray(rec.assets) ? rec.assets : [];
        for (const asset of assets) {
          if (!asset || typeof asset !== "object") continue;
          const item = asset as Record<string, unknown>;
          const pools = Array.isArray(item.pools) ? item.pools : [];
          const sanity = applyLiquiditySanity({
            pools: pools.map((pool) => {
              const entry = pool as Record<string, unknown>;
              return {
                poolId: String(entry.pairAddress ?? ""),
                liquidityUsd: asNonNegativeNumber(entry.liquidityUsd),
                volume24hUsd: asNonNegativeNumber(entry.volume24hUsd),
              };
            }),
          });
          const stored = item.displayedLiquidityUsd === null ? null : asNonNegativeNumber(item.displayedLiquidityUsd);
          if (stored === null || sanity.displayedLiquidityUsd === null) {
            expect(stored).toBe(sanity.displayedLiquidityUsd);
          } else {
            expect(stored).toBeCloseTo(sanity.displayedLiquidityUsd, 2);
          }
          // Range cards prefer displayedLiquidityUsd and do not re-sum raw pools.
          const card = readStoredAssetLiquidityUsd({
            displayedLiquidityUsd: stored,
            pools: pools as { pairAddress?: string; liquidityUsd?: number | null }[],
          });
          if (stored === null) expect(card).toBeNull();
          else expect(card).toBeCloseTo(stored, 2);
          if (!Array.isArray(item.excludedLiquidityPools) || item.excludedLiquidityPools.length === 0) continue;
          const knownReasons = new Set<string>([
            LIQUIDITY_SANITY_REASON_DEAD_DEPTH,
            LIQUIDITY_SANITY_REASON_DOMINANCE,
            LIQUIDITY_SANITY_REASON_GECKO,
          ]);
          for (const raw of item.excludedLiquidityPools) {
            const row = raw as { poolId?: string; liquidityUsd?: number; reason?: string };
            expect(knownReasons.has(String(row.reason))).toBe(true);
            expect(card).not.toBe(row.liquidityUsd);
          }
          const excluded = item.excludedLiquidityPools[0] as { poolId: string; liquidityUsd: number; reason: string };
          const correction = item.correction as { displayedLiquidityUsd?: number; reason?: string } | undefined;
          if (correction) {
            expect(correction.reason).toContain(excluded.poolId);
            expect(correction.reason).toContain(String(excluded.liquidityUsd));
          }
          const spcx = expected.find(
            (row) =>
              row.date === String(rec.date) && row.address === String(item.address) && row.poolId === excluded.poolId,
          );
          if (!spcx) continue;
          expect(file).toBe("solana.json");
          const excludedPool = pools.find(
            (pool) => (pool as { pairAddress?: string }).pairAddress === excluded.poolId,
          ) as { volume24hUsd?: unknown } | undefined;
          found.push({
            date: String(rec.date),
            address: String(item.address),
            poolId: excluded.poolId,
            before: correction?.displayedLiquidityUsd ?? NaN,
            after: stored ?? 0,
            raw: excluded.liquidityUsd,
            poolVolume: asNonNegativeNumber(excludedPool?.volume24hUsd) ?? 0,
            assetVolume: asNonNegativeNumber(item.volume24hUsd) ?? 0,
          });
          expect(excluded.reason).toBe(LIQUIDITY_SANITY_REASON_DEAD_DEPTH);
          expect(card).toBe(sanity.displayedLiquidityUsd);
        }
      }
    }
    expect(found).toEqual(expected);

    const solana = readSnapshot("solana.json");
    const totals: Record<string, number> = {
      "2026-09-30": 168_707_228.1,
      "2026-10-11": 55_718_561.70000001,
      "2026-10-12": 71_041_285.27999999,
    };
    for (const row of solana.records ?? []) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { date?: string; combined24hUsd?: number; assets?: { displayedLiquidityUsd?: number | null }[] };
      if (rec.date && rec.date in totals) expect(rec.combined24hUsd).toBe(totals[rec.date]);
    }
    const sumDisplayed = (date: string) => {
      const rec = (solana.records ?? []).find((row) => (row as { date?: string }).date === date) as {
        assets?: { displayedLiquidityUsd?: number | null }[];
      };
      return (rec.assets ?? []).reduce((sum, asset) => sum + (asset.displayedLiquidityUsd ?? 0), 0);
    };
    expect(sumDisplayed("2026-09-30")).toBeCloseTo(70_581_751.19, 2);
    expect(sumDisplayed("2026-10-11")).toBeCloseTo(64_826_619.61, 2);
    expect(sumDisplayed("2026-10-12")).toBeCloseTo(64_742_226.36, 2);
  });
});
