/**
 * Sum GeckoTerminal hourly pool candles into America/New_York days.
 * Writes data/volume-snapshots/<chain>-asset-daily.json.
 * Existing DexScreener per-asset rows are left untouched.
 *
 *   npx tsx scripts/backfill-gecko-hourly-et.ts --chain solana
 *   npx tsx scripts/backfill-gecko-hourly-et.ts --chain robinhood
 *   npx tsx scripts/backfill-gecko-hourly-et.ts --chain bnb --catalog /tmp/bnb-catalog.json
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { equityCardRangeAddressKey } from "../src/lib/market/equity-card-range-volume";
import {
  GECKO_HOURLY_ET_BACKFILL_SOURCE,
  easternDayKeysInclusive,
  hourlySeriesCoversEasternDay,
  sumHourlyVolumeByEasternDay,
  type HourlyVolumeCandle,
} from "../src/lib/market/gecko-hourly-et";
import { loadRobinhoodChainMarkets } from "../src/lib/market/robinhood-chain-markets";
import { geckoTerminalOhlcvPath } from "../src/lib/market/solana-geckoterminal";

const FROM_DAY = "2026-09-07";
const THROUGH_DAY = "2026-10-06";
const DAY_KEYS = easternDayKeysInclusive(FROM_DAY, THROUGH_DAY);
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const CACHE_DIR = process.env.GECKO_HOURLY_CACHE?.trim() || "/tmp/gecko-hourly-et-cache";
const CONCURRENCY = 1;
/** About 5 requests a minute. The keyless GeckoTerminal cap is about 10 a minute. */
const SNAPSHOT_DIR = join(process.cwd(), "data", "volume-snapshots");

const CHAINS: Record<string, { network: string; snapshot: string; out: string; live: "snapshot" | "robinhood" | "catalog" }> = {
  solana: { network: "solana", snapshot: "solana.json", out: "solana-asset-daily.json", live: "snapshot" },
  base: { network: "base", snapshot: "base.json", out: "base-asset-daily.json", live: "snapshot" },
  robinhood: {
    network: "robinhood",
    snapshot: "robinhood.json",
    out: "robinhood-asset-daily.json",
    live: "robinhood",
  },
  bnb: { network: "bsc", snapshot: "bnb.json", out: "bnb-asset-daily.json", live: "catalog" },
};

interface TrackedAsset {
  address: string;
  symbol: string;
  pools: string[];
}

interface PoolCache {
  ok: boolean;
  status?: number;
  reason?: string;
  candles?: HourlyVolumeCandle[];
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const chainId = arg("--chain");
  const chain = chainId ? CHAINS[chainId] : undefined;
  if (!chain || !chainId) {
    throw new Error("Pass --chain solana|base|robinhood|bnb");
  }
  const days = DAY_KEYS;
  if (days.length !== 30 || days[0] !== FROM_DAY || days[29] !== THROUGH_DAY) {
    throw new Error(`Expected 30 Eastern days, got ${days.join(",")}`);
  }
  const assets = await loadAssets(chainId, chain.live, arg("--catalog"));
  const dex = await dexAddressDays(chain.snapshot);
  console.log(
    `backfill ${chainId} assets=${assets.length} pools=${assets.reduce((sum, asset) => sum + asset.pools.length, 0)} dexDays=${dex.size}`,
  );
  const poolOwners = new Map<string, TrackedAsset[]>();
  for (const asset of assets) {
    for (const pool of asset.pools) {
      const list = poolOwners.get(pool) ?? [];
      list.push(asset);
      poolOwners.set(pool, list);
    }
  }
  const rank = await poolVolumeRank(chain.snapshot);
  const pools = [...poolOwners.keys()].sort((a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0));
  if (!process.argv.includes("--aggregate-only")) {
    await fetchPools(chain.network, pools, async (done) => {
      if (done % 100 !== 0) return;
      const caches = new Map<string, PoolCache>();
      for (const pool of pools) caches.set(pool, await readCache(chain.network, pool));
      const partial = await writeBackfill(chainId, chain, assets, dex, caches);
      console.log(`partial ${done} ${JSON.stringify(partial.coverage)}`);
    });
  }
  const caches = new Map<string, PoolCache>();
  for (const pool of pools) {
    caches.set(pool, await readCache(chain.network, pool));
  }
  const written = await writeBackfill(chainId, chain, assets, dex, caches);
  console.log(JSON.stringify(written.coverage));
}

async function loadAssets(
  chainId: string,
  live: "snapshot" | "robinhood" | "catalog",
  catalogPath: string | null,
): Promise<TrackedAsset[]> {
  if (catalogPath) return readCatalog(catalogPath);
  if (live === "robinhood") return robinhoodAssets();
  if (live === "catalog") {
    if (!catalogPath) throw new Error("--catalog is required for bnb");
    return readCatalog(catalogPath);
  }
  return snapshotAssets(CHAINS[chainId]?.snapshot ?? "");
}

function snapshotAssets(file: string): Promise<TrackedAsset[]> {
  return readFile(join(SNAPSHOT_DIR, file), "utf8").then((raw) => assetsFromSnapshot(JSON.parse(raw)));
}

function assetsFromSnapshot(payload: unknown): TrackedAsset[] {
  const records = (payload as { records?: unknown }).records;
  const byAddress = new Map<string, TrackedAsset>();
  if (!Array.isArray(records)) return [];
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const assets = (row as { assets?: unknown }).assets;
    if (!Array.isArray(assets)) continue;
    for (const asset of assets) {
      if (!asset || typeof asset !== "object") continue;
      const rec = asset as { address?: unknown; symbol?: unknown; pools?: unknown };
      const address = typeof rec.address === "string" ? rec.address.trim() : "";
      if (!address) continue;
      const current = byAddress.get(address) ?? {
        address,
        symbol: typeof rec.symbol === "string" ? rec.symbol : "",
        pools: [],
      };
      const seen = new Set(current.pools);
      if (Array.isArray(rec.pools)) {
        for (const pool of rec.pools) {
          const pair = pool && typeof pool === "object" ? (pool as { pairAddress?: unknown }).pairAddress : null;
          if (typeof pair === "string" && pair.trim() && !seen.has(pair)) {
            seen.add(pair);
            current.pools.push(pair);
          }
        }
      }
      byAddress.set(address, current);
    }
  }
  return [...byAddress.values()];
}

async function robinhoodAssets(): Promise<TrackedAsset[]> {
  const catalog = await loadRobinhoodChainMarkets();
  return catalog.details
    .map((asset) => ({
      address: asset.contractAddress,
      symbol: asset.symbol,
      pools: [...new Set(asset.pools.map((pool) => pool.pairAddress).filter(Boolean))],
    }))
    .filter((asset) => asset.address && asset.pools.length > 0);
}

async function readCatalog(path: string): Promise<TrackedAsset[]> {
  const payload = JSON.parse(await readFile(path, "utf8")) as { assets?: TrackedAsset[] };
  return (payload.assets ?? [])
    .map((asset) => ({
      address: asset.address,
      symbol: asset.symbol ?? "",
      pools: [...new Set((asset.pools ?? []).filter(Boolean))],
    }))
    .filter((asset) => asset.address && asset.pools.length > 0);
}

async function dexAddressDays(file: string): Promise<Map<string, Set<string>>> {
  const payload = JSON.parse(await readFile(join(SNAPSHOT_DIR, file), "utf8")) as { records?: unknown[] };
  const days = new Map<string, Set<string>>();
  for (const row of payload.records ?? []) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: unknown; assets?: unknown; symbolsWithVolume?: unknown };
    const date = typeof rec.date === "string" ? rec.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const keys = days.get(date) ?? new Set<string>();
    const lists = [rec.assets, rec.symbolsWithVolume];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const asset of list) {
        if (!asset || typeof asset !== "object") continue;
        const address = (asset as { address?: unknown }).address;
        const volume = (asset as { volume24hUsd?: unknown }).volume24hUsd;
        if (typeof address !== "string" || typeof volume !== "number" || volume < 0) continue;
        keys.add(equityCardRangeAddressKey(address));
      }
    }
    if (keys.size > 0) days.set(date, keys);
  }
  return days;
}

function cachePath(network: string, pool: string): string {
  return join(CACHE_DIR, network, `${encodeURIComponent(pool)}.json`);
}

async function readCache(network: string, pool: string): Promise<PoolCache> {
  try {
    return JSON.parse(await readFile(cachePath(network, pool), "utf8")) as PoolCache;
  } catch {
    return { ok: false, reason: "not-fetched" };
  }
}

let nextStart = 0;
let spacingMs = 200;

async function takeSlot(): Promise<void> {
  const now = Date.now();
  const start = Math.max(now, nextStart);
  nextStart = start + spacingMs;
  if (start > now) await sleep(start - now);
}

async function poolVolumeRank(file: string): Promise<Map<string, number>> {
  const rank = new Map<string, number>();
  try {
    const payload = JSON.parse(await readFile(join(SNAPSHOT_DIR, file), "utf8")) as { records?: unknown[] };
    for (const row of payload.records ?? []) {
      if (!row || typeof row !== "object") continue;
      const assets = (row as { assets?: unknown }).assets;
      if (!Array.isArray(assets)) continue;
      for (const asset of assets) {
        if (!asset || typeof asset !== "object") continue;
        const pools = (asset as { pools?: unknown }).pools;
        if (!Array.isArray(pools)) continue;
        for (const pool of pools) {
          if (!pool || typeof pool !== "object") continue;
          const pair = (pool as { pairAddress?: unknown }).pairAddress;
          const volume = (pool as { volume24hUsd?: unknown }).volume24hUsd;
          if (typeof pair !== "string" || typeof volume !== "number" || volume <= 0) continue;
          rank.set(pair, (rank.get(pair) ?? 0) + volume);
        }
      }
    }
  } catch {
    return rank;
  }
  return rank;
}

async function fetchPools(
  network: string,
  pools: string[],
  onProgress?: (done: number) => Promise<void>,
): Promise<void> {
  spacingMs = 12_000;
  nextStart = 0;
  await mkdir(join(CACHE_DIR, network), { recursive: true });
  let cursor = 0;
  let done = 0;
  const deferred = new Map<string, number>();
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const pool = pools[index];
      if (!pool) return;
      const path = cachePath(network, pool);
      try {
        await stat(path);
        done += 1;
        if (onProgress && done % 100 === 0) await onProgress(done);
        continue;
      } catch {
        // fetch below
      }
      const result = await fetchPool(network, pool);
      if (transientPoolFailure(result)) {
        const tries = (deferred.get(pool) ?? 0) + 1;
        deferred.set(pool, tries);
        if (tries < 8) {
          const pause = Math.min(120_000, 5_000 * 2 ** (tries - 1));
          console.log(`retry ${network} ${pool} try=${tries} pause=${pause} reason=${result.reason ?? ""}`);
          await sleep(pause);
          pools.push(pool);
          continue;
        }
      }
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(result), "utf8");
      await rename(tmp, path);
      done += 1;
      if (onProgress && done % 100 === 0) await onProgress(done);
      if (done % 25 === 0 || done === pools.length) {
        console.log(`fetched ${done}/${pools.length} ${network}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pools.length) }, () => worker()));
}

function transientPoolFailure(result: PoolCache): boolean {
  if (result.ok) return false;
  const reason = result.reason ?? "";
  if (reason === "not-found" || reason === "no-ohlcv-list" || reason.startsWith("http-")) return false;
  return true;
}

async function fetchPool(network: string, pool: string): Promise<PoolCache> {
  const path = geckoTerminalOhlcvPath(pool, { timeframe: "hour", limit: 1000, network });
  const url = `${GECKO_BASE}${path}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await takeSlot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "stocks-on-the-blockchain/0.1" },
      });
      if (response.status === 429 || response.status >= 500) {
        await response.arrayBuffer().catch(() => undefined);
        const retryAfter = Number(response.headers.get("retry-after"));
        // Retry-After is often 0. A short retry keeps the keyless window closed.
        const exponential = Math.min(180_000, 90_000 * 2 ** attempt);
        const headerPause = Number.isFinite(retryAfter) && retryAfter > 1 ? retryAfter * 1000 : 0;
        const pause = Math.max(headerPause, exponential);
        nextStart = Math.max(nextStart, Date.now() + pause);
        console.log(`backoff ${network} status=${response.status} pause=${pause} attempt=${attempt + 1}`);
        await sleep(pause);
        continue;
      }
      if (response.status === 404 || response.status === 400) {
        return { ok: false, status: response.status, reason: "not-found" };
      }
      if (!response.ok) return { ok: false, status: response.status, reason: `http-${response.status}` };
      const payload = (await response.json()) as {
        data?: { attributes?: { ohlcv_list?: unknown } };
      };
      const list = payload.data?.attributes?.ohlcv_list;
      if (!Array.isArray(list)) return { ok: false, reason: "no-ohlcv-list" };
      const candles: HourlyVolumeCandle[] = [];
      for (const row of list) {
        if (!Array.isArray(row) || row.length < 6) continue;
        const t = Number(row[0]);
        const volumeUsd = Number(row[5]);
        if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(volumeUsd) || volumeUsd < 0) continue;
        candles.push({ t: Math.trunc(t), volumeUsd });
      }
      return { ok: true, candles };
    } catch (error) {
      const pause = Math.min(60_000, 2_000 * 2 ** attempt);
      await sleep(pause);
      if (attempt === 5) {
        return { ok: false, reason: error instanceof Error ? error.message : "fetch-failed" };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "rate-limit" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeBackfill(
  chainId: string,
  chain: (typeof CHAINS)[string],
  assets: TrackedAsset[],
  dex: Map<string, Set<string>>,
  caches: Map<string, PoolCache>,
): Promise<{ coverage: Record<string, number> }> {
  const byDate = new Map<string, { address: string; symbol: string; volumeUsd: number; hours: number; pools: string[] }[]>();
  const skipped: { address: string; symbol: string; date: string; reason: string }[] = [];
  const poolSkips: { address: string; pool: string; reason: string }[] = [];
  let keptDex = 0;
  let filled = 0;
  let skippedDays = 0;
  let poolsOk = 0;
  let poolsFailed = 0;

  for (const asset of assets) {
    const key = equityCardRangeAddressKey(asset.address);
    const covered = new Set<string>();
    const totals = new Map<string, { volumeUsd: number; hours: number; pools: string[] }>();
    for (const pool of asset.pools) {
      const cached = caches.get(pool) ?? { ok: false, reason: "not-fetched" };
      if (!cached.ok || !cached.candles) {
        poolsFailed += 1;
        poolSkips.push({ address: asset.address, pool, reason: cached.reason ?? "not-fetched" });
        continue;
      }
      poolsOk += 1;
      const summed = sumHourlyVolumeByEasternDay(cached.candles, FROM_DAY, THROUGH_DAY);
      for (const date of DAY_KEYS) {
        if (!hourlySeriesCoversEasternDay(cached.candles, date)) continue;
        covered.add(date);
        const day = summed[date];
        const current = totals.get(date) ?? { volumeUsd: 0, hours: 0, pools: [] };
        current.volumeUsd += day?.volumeUsd ?? 0;
        current.hours += day?.hours ?? 0;
        current.pools.push(pool);
        totals.set(date, current);
      }
    }
    for (const date of DAY_KEYS) {
      if (dex.get(date)?.has(key)) {
        keptDex += 1;
        continue;
      }
      const total = totals.get(date);
      if (!covered.has(date) || !total) {
        skippedDays += 1;
        skipped.push({ address: asset.address, symbol: asset.symbol, date, reason: "no-hourly-candles" });
        continue;
      }
      filled += 1;
      const rows = byDate.get(date) ?? [];
      rows.push({
        address: asset.address,
        symbol: asset.symbol,
        volumeUsd: Math.round((total.volumeUsd + Number.EPSILON) * 100) / 100,
        hours: total.hours,
        pools: total.pools,
      });
      byDate.set(date, rows);
    }
  }

  const records = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rows]) => ({
      date,
      assets: rows
        .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.address.localeCompare(b.address))
        .map((row) => ({
          address: row.address,
          symbol: row.symbol,
          volume24hUsd: row.volumeUsd,
          source: GECKO_HOURLY_ET_BACKFILL_SOURCE,
          hours: row.hours,
          pools: row.pools,
        })),
    }));

  const body = {
    version: 1,
    source: GECKO_HOURLY_ET_BACKFILL_SOURCE,
    dayKey: "America/New_York",
    candle: "hour",
    from: FROM_DAY,
    through: THROUGH_DAY,
    chainId,
    network: chain.network,
    records,
    skipped,
    poolSkips,
  };
  const out = join(SNAPSHOT_DIR, chain.out);
  const tmp = `${out}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body)}\n`, "utf8");
  await rename(tmp, out);
  return {
    coverage: {
      assets: assets.length,
      assetDays: assets.length * DAY_KEYS.length,
      filled,
      keptDex,
      skippedDays,
      poolsOk,
      poolsFailed,
    },
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
