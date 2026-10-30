/**
 * Solana closed-ET-day volume, split so GitHub Actions can finish it.
 *
 *   tsx scripts/snapshot-solana-sharded.ts capture OUT_DETAIL.json
 *       DexScreener token-pairs capture (once), saved for every shard.
 *   tsx scripts/snapshot-solana-sharded.ts shard I N DETAIL.json OUT_POOLS.json
 *       GeckoTerminal pool lists + hourly candles for assets with index % N == I.
 *       Each shard runs on its own runner (own egress IP), so Gecko's per-IP limit is spread out.
 *   tsx scripts/snapshot-solana-sharded.ts merge DETAIL.json POOLS_DIR STATUS.json
 *       Sums candles over the ET day (SOLANA_SNAPSHOT_DATE), decides READY / NOT READY,
 *       and writes data/volume-snapshots/solana.json only when READY.
 *
 * Exactness rule: a pool's day volume is its GeckoTerminal hourly candles over the ET day. A pool with
 * no candles counts $0 only when it had no activity signal at all (DexScreener/Gecko rolling h24 = 0 and
 * no reserve). Anything else is unresolved and the chain-day is NOT READY. Rolling h24 is never written
 * as a value.
 * Env: SOLANA_SNAPSHOT_DATE (YYYY-MM-DD, required for shard/merge), SOLANA_GECKO_CACHE (dir; token pool
 * lists cached 7 days), SOLANA_MIN_H24 (default 0: candle every pool with any signal).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildClosedDayTotals,
  isPerpInstrument,
  loadSolanaClosedDayPools,
  readKnownPoolSides,
  type ClosedDayPool,
  type ClosedDayKind,
} from "../src/lib/market/closed-day-capture";
import { createSolanaMarketDataSource } from "../src/lib/market/factory";
import type { ChainDetailResult } from "../src/lib/market/types";
import { FileDeskVolumeSnapshotStore } from "../src/lib/market/volume-snapshot-store";
import {
  DEFAULT_VOLUME_SNAPSHOT_DIR,
  MemoryDeskVolumeSnapshotStore,
  recordDeskVolumeFromChain,
  type DeskSnapshotAssetSource,
} from "../src/lib/market/volume-snapshots";

const POOL_LIST_TTL_MS = 7 * 24 * 3600 * 1000;

function dayFromEnv(): string {
  const day = (process.env.SOLANA_SNAPSHOT_DATE ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("SOLANA_SNAPSHOT_DATE=YYYY-MM-DD is required");
  return day;
}

/** Noon America/New_York on `day` (inside the ET day under EST and EDT). */
function noonEt(day: string): number {
  return Math.floor(Date.parse(`${day}T12:00:00-05:00`) / 1000);
}

function visibleAssets(detail: ChainDetailResult): DeskSnapshotAssetSource[] {
  return [...detail.assets, ...(detail.etfAssets ?? []), ...(detail.privateAssets ?? [])].filter(
    (asset) => !isPerpInstrument(asset.symbol, asset.name),
  ) as DeskSnapshotAssetSource[];
}

function shardOf(key: string, n: number): number {
  return createHash("sha1").update(key).digest().readUInt32BE(0) % n;
}

/** Disk cache for GET .../tokens/{mint}/pools (pool lists change slowly); OHLCV is always live. */
function cachedFetch(dir: string | undefined): typeof fetch {
  if (!dir) return fetch;
  mkdirSync(dir, { recursive: true });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("/tokens/") || !url.includes("/pools")) return fetch(input, init);
    const file = join(dir, createHash("sha1").update(url).digest("hex") + ".json");
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < POOL_LIST_TTL_MS) {
      return new Response(readFileSync(file), { status: 200, headers: { "content-type": "application/json" } });
    }
    const res = await fetch(input, init);
    if (res.status === 200) {
      const body = await res.text();
      writeFileSync(file, body);
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }
    return res;
  }) as typeof fetch;
}

async function capture(out: string): Promise<number> {
  const source = createSolanaMarketDataSource(process.env, {
    backgroundEnrichment: false,
    fullBudgetMs: 20 * 60 * 1000,
    volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
  }) as { captureFullChain?: () => Promise<ChainDetailResult | null> };
  if (!source.captureFullChain) throw new Error("Solana source has no captureFullChain");
  const detail = await source.captureFullChain();
  if (!detail) throw new Error("captureFullChain returned null");
  writeFileSync(out, JSON.stringify(detail));
  console.log(`solana capture assets=${visibleAssets(detail).length} -> ${out}`);
  return 0;
}

async function shard(i: number, n: number, detailPath: string, out: string): Promise<number> {
  const day = dayFromEnv();
  const detail = JSON.parse(readFileSync(detailPath, "utf8")) as ChainDetailResult;
  const all = visibleAssets(detail);
  const mine = all.filter((asset) => shardOf(asset.contractAddress, n) === i);
  let known: ReturnType<typeof readKnownPoolSides> = [];
  try {
    known = readKnownPoolSides(
      readFileSync(join(process.cwd(), "data", "volume-known-pools", "solana.json"), "utf8"),
    ).filter((k) => shardOf(k.pair.trim(), n) === i);
  } catch {
    known = [];
  }
  const t0 = Date.now();
  const pools = await loadSolanaClosedDayPools({
    assets: mine as never,
    fetchImpl: cachedFetch(process.env.SOLANA_GECKO_CACHE),
    dayKey: day,
    knownPools: known,
    minH24: Number(process.env.SOLANA_MIN_H24 ?? "0"),
  });
  writeFileSync(out, JSON.stringify({ day, shard: i, of: n, assets: mine.length, pools }));
  const ok = pools.filter((p) => p.geckoOk).length;
  console.log(
    `solana shard ${i}/${n} day=${day} assets=${mine.length}/${all.length} pools=${pools.length} candles=${ok} secs=${Math.round((Date.now() - t0) / 1000)}`,
  );
  return 0;
}

async function merge(detailPath: string, poolsDir: string, statusPath: string): Promise<number> {
  const day = dayFromEnv();
  const detail = JSON.parse(readFileSync(detailPath, "utf8")) as ChainDetailResult;
  const visible = visibleAssets(detail);
  const files = readdirSync(poolsDir).filter((f) => f.endsWith(".json"));
  const byPair = new Map<string, ClosedDayPool>();
  const shards = new Set<number>();
  let expected = 0;
  for (const f of files) {
    const part = JSON.parse(readFileSync(join(poolsDir, f), "utf8")) as { day: string; shard: number; of: number; pools: ClosedDayPool[] };
    if (part.day !== day) throw new Error(`${f} is for ${part.day}, not ${day}`);
    shards.add(part.shard);
    expected = part.of;
    for (const p of part.pools) {
      const prev = byPair.get(p.pairAddress);
      if (!prev || (!prev.geckoOk && p.geckoOk)) byPair.set(p.pairAddress, p);
    }
  }
  const reasons: string[] = [];
  if (!expected || shards.size !== expected) reasons.push(`shards present ${shards.size}/${expected || "?"}`);
  const zeroed: string[] = [];
  const unresolved: { pairAddress: string; symbol?: string; reason: string; signal: number | null }[] = [];
  const pools: ClosedDayPool[] = [];
  for (const p of byPair.values()) {
    if (p.geckoOk && p.geckoVolumeUsd !== null) {
      pools.push(p);
      continue;
    }
    const signal = Math.max(p.dexVolumeUsd ?? 0, p.liquidityUsd ?? 0);
    if ((p.dexVolumeUsd ?? 0) === 0 && (p.liquidityUsd ?? 0) === 0) {
      // No activity and no reserve anywhere: exact $0 for the day.
      zeroed.push(p.pairAddress);
      pools.push({ ...p, geckoOk: true, geckoVolumeUsd: 0 });
      continue;
    }
    unresolved.push({ pairAddress: p.pairAddress, symbol: p.symbol, reason: p.fallbackReason ?? "no-geckoterminal-candles", signal });
  }
  // Pools that are only owned by non-desk tokens do not count; only flag unresolved pools the desk would own.
  const kinds = new Map<string, ClosedDayKind>(visible.map((a) => [a.contractAddress, (a as unknown as { instrumentKind: ClosedDayKind }).instrumentKind] as const));
  const desk = new Set(kinds.keys());
  const blocking = unresolved.filter((u) => {
    const p = byPair.get(u.pairAddress)!;
    return desk.has(p.baseAddress) || desk.has(p.quoteAddress);
  });
  if (blocking.length) {
    reasons.push(
      `${blocking.length} pools without ET-day candles but with rolling activity/reserve: ` +
        blocking.slice(0, 10).map((u) => `${u.pairAddress} ${u.symbol ?? ""} (${u.reason})`).join("; "),
    );
  }
  const totals = buildClosedDayTotals({ pools, kinds });
  if (totals.dexscreenerH24Fallbacks.length) reasons.push(`${totals.dexscreenerH24Fallbacks.length} h24 fallbacks in totals`);
  if (totals.combined24hUsd === null) reasons.push("combined total is null");
  const status: Record<string, unknown> = {
    chain: "solana",
    day,
    ready: reasons.length === 0,
    reasons,
    combined24hUsd: totals.combined24hUsd,
    equity: totals.publicEquity24hUsd,
    etf: totals.etfIndex24hUsd,
    private: totals.private24hUsd,
    pools: pools.length,
    zeroActivityPools: zeroed.length,
    unresolvedPools: blocking.length,
    unresolvedSample: blocking.slice(0, 50),
  };
  if (reasons.length === 0) {
    const assets = (detailAssets(detail) as DeskSnapshotAssetSource[])
      .filter((asset) => !isPerpInstrument(asset.symbol, ""))
      .map((asset) => {
        const row = totals.byAddress.get(asset.contractAddress);
        return { ...asset, volume24hUsd: row?.volumeUsd ?? null, pools: row?.pools.length ? row.pools : [] };
      });
    const chain = {
      ...detail.chain,
      volume24hUsd: totals.publicEquity24hUsd,
      privateVolume24hUsd: totals.private24hUsd,
      etfVolume24hUsd: totals.etfIndex24hUsd,
      volumeAggregation: "all-pools",
    };
    const generatedAt = detail.provenance.generatedAt ?? detail.provenance.fetchedAt ?? new Date().toISOString();
    const dir = process.env.SOLANA_VOLUME_SNAPSHOT_DIR?.trim() || DEFAULT_VOLUME_SNAPSHOT_DIR;
    const result = await recordDeskVolumeFromChain(new FileDeskVolumeSnapshotStore(dir), chain as never, generatedAt, noonEt(day), assets, {
      volumeSource: "geckoterminal-hourly-et",
      geckoCombined24hUsd: totals.geckoCombined24hUsd,
      dexCombined24hUsd: null,
      crossCheck: `ET-day hourly candles for every pool with activity; ${zeroed.length} zero-activity pools at $0; sharded x${expected}`,
      gapPct: null,
    });
    status.written = result.ok ? result.snapshot.date : `FAILED: ${result.reason}`;
    if (!result.ok || result.snapshot.date !== day) {
      status.ready = false;
      (status.reasons as string[]).push(result.ok ? `row date ${result.snapshot.date} != ${day}` : result.reason);
    }
  }
  writeFileSync(statusPath, JSON.stringify(status, null, 1));
  console.log(JSON.stringify({ ...status, unresolvedSample: undefined }));
  return 0;
}

function detailAssets(detail: ChainDetailResult): unknown[] {
  return [...detail.assets, ...(detail.etfAssets ?? []), ...(detail.privateAssets ?? [])];
}

async function main(argv: string[]): Promise<number> {
  const [mode, ...rest] = argv;
  if (mode === "capture") return capture(rest[0]);
  if (mode === "shard") return shard(Number(rest[0]), Number(rest[1]), rest[2], rest[3]);
  if (mode === "merge") return merge(rest[0], rest[1], rest[2]);
  console.error("usage: capture OUT | shard I N DETAIL OUT | merge DETAIL POOLS_DIR STATUS");
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
