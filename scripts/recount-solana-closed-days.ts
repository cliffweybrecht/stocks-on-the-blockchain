/**
 * One-off recount of Solana closed days with the nightly writer.
 * PHASE=capture writes /tmp/solana-capture.json (DexScreener token-pairs).
 * PHASE=candles sums GeckoTerminal hourly candles for 2026-10-15..18.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { GECKO_CACHED_FAILURE } from "../src/lib/market/gecko-fetch";
import { createSolanaMarketDataSource } from "../src/lib/market/factory";
import {
  buildClosedDayTotals,
  isPerpInstrument,
  loadSolanaClosedDayPools,
  readKnownPoolSides,
  type ClosedDayAssetInput,
  type ClosedDayKind,
} from "../src/lib/market/closed-day-capture";
import {
  deskSnapshotAssetsFromSummaries,
  MemoryDeskVolumeSnapshotStore,
  type DeskSnapshotAssetSource,
} from "../src/lib/market/volume-snapshots";

const DAYS = ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];
const CAPTURE_PATH = "/tmp/solana-capture.json";
const OUT_PATH = "/tmp/solana-closed-days.json";
const CACHE_DIR = "/tmp/solana-gecko-cache";
const PROGRESS_LOG = "/tmp/solana-candles-progress.log";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";

function log(line: string) {
  const text = `${line}\n`;
  process.stdout.write(text);
  appendFileSync(PROGRESS_LOG, text);
}

function tokenPoolsUrl(mint: string, page: number): string {
  return `${GECKO_BASE}/networks/solana/tokens/${encodeURIComponent(mint)}/pools?page=${page}`;
}

function ohlcvUrl(pair: string): string {
  return `${GECKO_BASE}/networks/solana/pools/${encodeURIComponent(pair)}/ohlcv/hour?aggregate=1&limit=1000&currency=usd`;
}

function poolAddressesFromTokenBody(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const rows = (body as { data?: unknown }).data;
  if (!Array.isArray(rows)) return [];
  const found: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { id?: unknown; attributes?: { address?: unknown } };
    const address = typeof item.attributes?.address === "string" ? item.attributes.address.trim() : "";
    const ident = typeof item.id === "string" && item.id.includes("_") ? item.id.slice(item.id.indexOf("_") + 1) : "";
    const pair = address || ident;
    if (pair) found.push(pair);
  }
  return found;
}

type SavedAsset = ClosedDayAssetInput & {
  issuer?: string;
  marketValueUsd?: number | null;
};

async function capture() {
  const source = createSolanaMarketDataSource(
    { ...process.env, SOLANA_MARKET_ENABLED: "true", SOLANA_GECKOTERMINAL_ENABLED: "false" },
    {
      backgroundEnrichment: false,
      enableGeckoTerminal: false,
      fullBudgetMs: 30 * 60 * 1000,
      volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    },
  );
  console.log("solana captureFullChain starting", new Date().toISOString());
  const detail = await source.captureFullChain();
  if (!detail) throw new Error("captureFullChain returned null");
  const assets: SavedAsset[] = [];
  for (const asset of [...detail.assets, ...(detail.etfAssets ?? []), ...(detail.privateAssets ?? [])]) {
    if (isPerpInstrument(asset.symbol, asset.name)) continue;
    assets.push({
      contractAddress: asset.contractAddress,
      symbol: asset.symbol,
      name: asset.name,
      issuer: asset.issuer ?? undefined,
      instrumentKind: asset.instrumentKind,
      marketValueUsd: null,
      pools: asset.pools.map((pool) => ({
        pairAddress: pool.pairAddress,
        dexId: pool.dexId,
        volume24hUsd: pool.volume24hUsd,
        liquidityUsd: pool.liquidityUsd,
        baseAddress: pool.baseAddress,
        quoteAddress: pool.quoteAddress,
      })),
    });
  }
  writeFileSync(
    CAPTURE_PATH,
    JSON.stringify(
      {
        generatedAt: detail.provenance.generatedAt,
        assetCount: detail.chain.assetCount,
        reportedPoolCount: detail.chain.reportedPoolCount,
        assets,
      },
      null,
      2,
    ),
  );
  console.log(`solana capture wrote ${assets.length} assets -> ${CAPTURE_PATH}`);
}

function diskFetch(): typeof fetch {
  mkdirSync(CACHE_DIR, { recursive: true });
  let network = 0;
  return async (input, init) => {
    const url = String(input);
    const name = createHash("sha256").update(url).digest("hex") + ".json";
    const path = join(CACHE_DIR, name);
    try {
      const cached = readFileSync(path, "utf8");
      const parsed = JSON.parse(cached) as unknown;
      if (parsed && typeof parsed === "object" && GECKO_CACHED_FAILURE in parsed) {
        const failure = (parsed as { [GECKO_CACHED_FAILURE]?: { status?: number } })[GECKO_CACHED_FAILURE];
        const status = typeof failure?.status === "number" ? failure.status : 404;
        return new Response(cached, {
          status,
          headers: { "content-type": "application/json", "x-gecko-cache": "disk-failure" },
        });
      }
      return new Response(cached, { status: 200, headers: { "content-type": "application/json", "x-gecko-cache": "disk" } });
    } catch {
      // miss
    }
    network += 1;
    if (network % 25 === 0) {
      log(`solana gecko network=${network} ${new Date().toISOString()} ${url.slice(0, 120)}`);
    }
    const response = await fetch(input, init);
    if (!response.ok) {
      // 429 and 5xx stay uncached so the shared client can retry. Terminal misses
      // are written so a restarted day does not pace the same 404 again.
      if (response.status === 404 || (response.status !== 429 && response.status < 500)) {
        const reason = response.status === 404 ? "not-found" : "http-error";
        writeFileSync(
          path,
          JSON.stringify({
            [GECKO_CACHED_FAILURE]: { ok: false, reason, status: response.status, attempts: 1 },
          }),
        );
      }
      return response;
    }
    const text = await response.text();
    writeFileSync(path, text);
    return new Response(text, { status: response.status, headers: { "content-type": "application/json" } });
  };
}

function seedDiskCache(cache: Map<string, unknown>, urls: string[]) {
  let seeded = 0;
  for (const url of urls) {
    if (cache.has(url)) continue;
    const path = join(CACHE_DIR, createHash("sha256").update(url).digest("hex") + ".json");
    try {
      cache.set(url, JSON.parse(readFileSync(path, "utf8")));
      seeded += 1;
    } catch {
      // not fetched yet
    }
  }
  return seeded;
}

async function candles() {
  const captured = JSON.parse(readFileSync(CAPTURE_PATH, "utf8")) as {
    generatedAt: string;
    assetCount: number;
    reportedPoolCount: number;
    assets: SavedAsset[];
  };
  const known = readKnownPoolSides(readFileSync(join(process.cwd(), "data/volume-known-pools/solana.json"), "utf8"));
  const cache = new Map<string, unknown>();
  const tokenUrls: string[] = [];
  for (const asset of captured.assets) {
    const mint = asset.contractAddress.trim();
    if (!mint) continue;
    for (let page = 1; page <= 3; page += 1) tokenUrls.push(tokenPoolsUrl(mint, page));
  }
  const seededTokens = seedDiskCache(cache, tokenUrls);
  const ohlcvUrls: string[] = [];
  const seenPairs = new Set<string>();
  const addPair = (pair: string) => {
    const trimmed = pair.trim();
    if (!trimmed || seenPairs.has(trimmed)) return;
    seenPairs.add(trimmed);
    ohlcvUrls.push(ohlcvUrl(trimmed));
  };
  for (const asset of captured.assets) {
    for (const pool of asset.pools) addPair(pool.pairAddress);
  }
  for (const side of known) addPair(side.pair);
  for (const url of tokenUrls) {
    const body = cache.get(url);
    if (!body || (typeof body === "object" && GECKO_CACHED_FAILURE in body)) continue;
    for (const pair of poolAddressesFromTokenBody(body)) addPair(pair);
  }
  const seededOhlcv = seedDiskCache(cache, ohlcvUrls);
  log(
    `solana cache seeded tokens=${seededTokens}/${tokenUrls.length} ohlcv=${seededOhlcv}/${ohlcvUrls.length} ${new Date().toISOString()}`,
  );
  const fetchImpl = diskFetch();
  let days: Record<string, unknown> = {};
  try {
    const existing = JSON.parse(readFileSync(OUT_PATH, "utf8")) as unknown;
    if (existing && typeof existing === "object" && !Array.isArray(existing)) days = existing as Record<string, unknown>;
  } catch {
    // first run
  }
  for (const day of DAYS) {
    const saved = days[day];
    if (saved && typeof saved === "object" && typeof (saved as { combined24hUsd?: unknown }).combined24hUsd === "number") {
      log(`solana candles ${day} already saved, skipping`);
      continue;
    }
    log(`solana candles ${day} start ${new Date().toISOString()}`);
    const pools = await loadSolanaClosedDayPools({
      assets: captured.assets,
      fetchImpl,
      dayKey: day,
      knownPools: known,
      cache,
    });
    const kinds = new Map(captured.assets.map((asset) => [asset.contractAddress, asset.instrumentKind as ClosedDayKind]));
    const totals = buildClosedDayTotals({ pools, kinds });
    const sources: DeskSnapshotAssetSource[] = captured.assets
      .filter((asset) => asset.instrumentKind === "equity" || asset.instrumentKind === "etf" || asset.instrumentKind === "private")
      .map((asset) => {
        const row = totals.byAddress.get(asset.contractAddress);
        return {
          contractAddress: asset.contractAddress,
          symbol: asset.symbol,
          issuer: asset.issuer ?? null,
          instrumentKind: asset.instrumentKind as "equity" | "etf" | "private",
          volume24hUsd: row?.volumeUsd ?? null,
          displayedLiquidityUsd: null,
          marketValueUsd: asset.marketValueUsd,
          pools: row?.pools.length ? row.pools : [],
        };
      });
    const assets = deskSnapshotAssetsFromSummaries(sources);
    const laneSum = (kind: string) => {
      const rows = assets.filter((asset) => asset.instrumentKind === kind && asset.volume24hUsd !== null);
      if (!rows.length) return null;
      return Math.round(rows.reduce((sum, asset) => sum + (asset.volume24hUsd ?? 0), 0) * 100) / 100;
    };
    days[day] = {
      publicEquity24hUsd: totals.publicEquity24hUsd,
      private24hUsd: totals.private24hUsd,
      etfIndex24hUsd: totals.etfIndex24hUsd,
      combined24hUsd: totals.combined24hUsd,
      assetLaneEquity: laneSum("equity"),
      assetLanePrivate: laneSum("private"),
      assetLaneEtf: laneSum("etf"),
      volumeSource: totals.volumeSource,
      dexCombined24hUsd: totals.dexCombined24hUsd,
      geckoCombined24hUsd: totals.geckoCombined24hUsd,
      crossCheck: totals.crossCheck,
      gapPct: totals.gapPct,
      uncoveredPools: totals.uncoveredPools,
      fallbackCount: totals.dexscreenerH24Fallbacks.length,
      dexscreenerH24Fallbacks: totals.dexscreenerH24Fallbacks,
      assets,
      generatedAt: new Date().toISOString(),
      captureGeneratedAt: captured.generatedAt,
      publicMintCount: captured.assetCount,
      publicPoolCount: captured.reportedPoolCount,
    };
    writeFileSync(OUT_PATH, JSON.stringify(days));
    log(
      `solana candles ${day} combined=${totals.combined24hUsd} gecko=${totals.geckoCombined24hUsd} dex=${totals.dexCombined24hUsd} gap=${totals.gapPct} fallbacks=${totals.dexscreenerH24Fallbacks.length}`,
    );
  }
}

const phase = process.env.PHASE ?? "capture";
if (phase === "candles") {
  candles().catch((error) => {
    console.error(error);
    process.exit(1);
  });
} else {
  capture().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
