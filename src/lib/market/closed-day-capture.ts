import { easternDayKey, easternMidnightUnix } from "./volume-snapshots";

/** Pools quieter than this are left on the DexScreener sample. Their h24 is dust. */
export const CLOSED_DAY_MIN_H24_USD = 100;

/** DexScreener vs Gecko totals above this fraction are tagged on the row. */
export const CLOSED_DAY_GAP_FRACTION = 0.05;

export type ClosedDayKind = "equity" | "etf" | "private";

export interface ClosedDayPool {
  pairAddress: string;
  dexId: string;
  baseAddress: string;
  quoteAddress: string;
  dexVolumeUsd: number | null;
  liquidityUsd: number | null;
  geckoVolumeUsd: number | null;
  geckoOk: boolean;
  /** False for pools that came from GeckoTerminal rather than DexScreener. */
  includeInDexSample?: boolean;
}

export interface ClosedDayAssetVolume {
  volumeUsd: number | null;
  pools: { pairAddress: string; dexId: string; volume24hUsd: number | null; liquidityUsd: number | null; source: string }[];
}

export interface ClosedDayTotals {
  byAddress: Map<string, ClosedDayAssetVolume>;
  publicEquity24hUsd: number | null;
  private24hUsd: number | null;
  etfIndex24hUsd: number | null;
  combined24hUsd: number | null;
  dexCombined24hUsd: number | null;
  geckoCombined24hUsd: number | null;
  volumeSource: string;
  crossCheck: string | null;
  gapPct: number | null;
  uncoveredPools: number;
}

/** Spot snapshots do not include perp markets. Perplexity is a company, not a perp. */
export function isPerpInstrument(symbol: string, name = ""): boolean {
  if (symbol.toUpperCase().endsWith("PERP")) return true;
  const blob = `${symbol} ${name}`;
  if (/perplexity/i.test(blob)) return false;
  return /\b(?:perp|perps|perpetual)\b/i.test(blob);
}

export function sumHourlyCandlesOnEasternDay(
  candles: readonly { t: number; volumeUsd: number }[],
  dayKey: string,
): { volumeUsd: number | null; covered: boolean } {
  const byOpen = new Map<number, number>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.t) || candle.t <= 0) continue;
    if (!Number.isFinite(candle.volumeUsd) || candle.volumeUsd < 0) continue;
    byOpen.set(Math.trunc(candle.t), candle.volumeUsd);
  }
  if (byOpen.size === 0) return { volumeUsd: null, covered: false };
  const start = easternMidnightUnix(dayKey);
  const nextKey = easternDayKey(start + 26 * 3600);
  const end = easternMidnightUnix(nextKey);
  if (start <= 0 || end <= start) return { volumeUsd: null, covered: false };
  let oldest = Infinity;
  let newest = -Infinity;
  for (const t of byOpen.keys()) {
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
  }
  const truncated = byOpen.size >= 990 && oldest > start;
  if (newest < start || oldest >= end || truncated) return { volumeUsd: null, covered: false };
  let total = 0;
  for (const [t, volume] of byOpen) {
    if (t >= start && t < end) total += volume;
  }
  return { volumeUsd: roundUsd(total), covered: true };
}

/** Count the pool once. Both desk tokens: the base token only. */
export function recipientForPool(base: string, quote: string, universe: ReadonlySet<string>): string | null {
  if (base && universe.has(base)) return base;
  if (quote && universe.has(quote)) return quote;
  return null;
}

export function buildClosedDayTotals(input: {
  pools: readonly ClosedDayPool[];
  kinds: ReadonlyMap<string, ClosedDayKind>;
}): ClosedDayTotals {
  const universe = new Set(input.kinds.keys());
  const byAddress = new Map<string, ClosedDayAssetVolume>();
  for (const address of universe) byAddress.set(address, { volumeUsd: null, pools: [] });
  const seen = new Set<string>();
  const dexParts: number[] = [];
  const geckoParts: number[] = [];
  const sources = new Set<string>();
  let uncoveredPools = 0;

  for (const pool of input.pools) {
    const pair = pool.pairAddress.trim();
    if (!pair || seen.has(pair)) continue;
    const owner = recipientForPool(pool.baseAddress, pool.quoteAddress, universe);
    if (!owner) continue;
    seen.add(pair);
    if (pool.dexVolumeUsd !== null && pool.includeInDexSample !== false) dexParts.push(pool.dexVolumeUsd);
    if (pool.geckoOk && pool.geckoVolumeUsd !== null) geckoParts.push(pool.geckoVolumeUsd);
    const chosen = pool.geckoOk && pool.geckoVolumeUsd !== null ? pool.geckoVolumeUsd : pool.dexVolumeUsd;
    const source =
      pool.geckoOk && pool.geckoVolumeUsd !== null
        ? "geckoterminal-hourly-et"
        : pool.dexVolumeUsd !== null && pool.includeInDexSample === false
          ? "geckoterminal-h24-fallback"
          : pool.dexVolumeUsd !== null
            ? "dexscreener-h24-fallback"
            : "uncovered";
    if (chosen === null) {
      uncoveredPools += 1;
      continue;
    }
    sources.add(source);
    const row = byAddress.get(owner);
    if (!row) continue;
    row.volumeUsd = row.volumeUsd === null ? chosen : row.volumeUsd + chosen;
    row.pools.push({
      pairAddress: pair,
      dexId: pool.dexId || "unknown",
      volume24hUsd: roundUsd(chosen),
      liquidityUsd: pool.liquidityUsd,
      source,
    });
  }

  for (const row of byAddress.values()) {
    if (row.volumeUsd !== null) row.volumeUsd = roundUsd(row.volumeUsd);
  }

  const lane = (kind: ClosedDayKind): number | null => {
    let total = 0;
    let any = false;
    for (const [address, row] of byAddress) {
      if (input.kinds.get(address) !== kind || row.volumeUsd === null) continue;
      any = true;
      total += row.volumeUsd;
    }
    return any ? roundUsd(total) : null;
  };
  const publicEquity24hUsd = lane("equity");
  const private24hUsd = lane("private");
  const etfIndex24hUsd = lane("etf");
  const parts = [publicEquity24hUsd, private24hUsd, etfIndex24hUsd];
  const combined24hUsd = parts.some((part) => part !== null)
    ? roundUsd(parts.reduce<number>((sum, part) => sum + (part ?? 0), 0))
    : null;
  const dexCombined24hUsd = dexParts.length ? roundUsd(dexParts.reduce((sum, part) => sum + part, 0)) : null;
  const geckoCombined24hUsd = geckoParts.length ? roundUsd(geckoParts.reduce((sum, part) => sum + part, 0)) : null;
  const sourceOrder = [
    "geckoterminal-hourly-et",
    "geckoterminal-h24-fallback",
    "dexscreener-h24-fallback",
  ];
  const volumeSource = sourceOrder.filter((source) => sources.has(source)).join("+") || "uncovered";
  const gapPct = gapPercent(dexCombined24hUsd, geckoCombined24hUsd);
  return {
    byAddress,
    publicEquity24hUsd,
    private24hUsd,
    etfIndex24hUsd,
    combined24hUsd,
    dexCombined24hUsd,
    geckoCombined24hUsd,
    volumeSource,
    crossCheck: gapPct !== null && gapPct > CLOSED_DAY_GAP_FRACTION * 100 ? "dex-gecko-gap" : null,
    gapPct,
    uncoveredPools,
  };
}

export function parseGeckoOhlcvCandles(payload: unknown): { t: number; volumeUsd: number }[] {
  if (!payload || typeof payload !== "object") return [];
  const list = (
    (payload as { data?: { attributes?: { ohlcv_list?: unknown } } }).data?.attributes?.ohlcv_list
  );
  if (!Array.isArray(list)) return [];
  const candles: { t: number; volumeUsd: number }[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const t = Number(row[0]);
    const volumeUsd = Number(row[5]);
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(volumeUsd) || volumeUsd < 0) continue;
    candles.push({ t, volumeUsd });
  }
  return candles;
}

export interface ClosedDayAssetInput {
  contractAddress: string;
  symbol: string;
  name: string;
  instrumentKind: string;
  pools: readonly {
    pairAddress: string;
    dexId: string;
    volume24hUsd: number | null;
    liquidityUsd: number | null;
    baseAddress?: string | null;
    quoteAddress?: string | null;
  }[];
}

const GECKO_GAP_MS = 3200;

export interface KnownPoolSide {
  pair: string;
  base: string;
  quote: string;
}

/** Pool addresses DexScreener token-pairs can miss, with the side that receives the volume. */
export function readKnownPoolSides(raw: string): KnownPoolSide[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const sides = (payload as { poolSides?: unknown }).poolSides;
  if (!sides || typeof sides !== "object") return [];
  const found: KnownPoolSide[] = [];
  for (const row of Object.values(sides as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const item = row as { pair?: unknown; base?: unknown; quote?: unknown };
    const pair = typeof item.pair === "string" ? item.pair.trim() : "";
    if (!pair) continue;
    found.push({
      pair,
      base: typeof item.base === "string" ? item.base.trim() : "",
      quote: typeof item.quote === "string" ? item.quote.trim() : "",
    });
  }
  return found;
}

export async function loadSolanaClosedDayPools(input: {
  assets: readonly ClosedDayAssetInput[];
  fetchImpl: typeof fetch;
  dayKey: string;
  geckoBaseUrl?: string;
  minH24?: number;
  knownPools?: readonly KnownPoolSide[];
}): Promise<ClosedDayPool[]> {
  const geckoBase = (input.geckoBaseUrl ?? "https://api.geckoterminal.com/api/v2").replace(/\/+$/, "");
  const minH24 = input.minH24 ?? CLOSED_DAY_MIN_H24_USD;
  const desk = new Set(input.assets.map((asset) => asset.contractAddress));
  const pools = new Map<string, ClosedDayPool>();
  const candleAnyway = new Set<string>();

  for (const asset of input.assets) {
    if (isPerpInstrument(asset.symbol, asset.name)) continue;
    for (const pool of asset.pools) {
      const pair = pool.pairAddress.trim();
      if (!pair || pools.has(pair)) continue;
      pools.set(pair, {
        pairAddress: pair,
        dexId: pool.dexId,
        baseAddress: pool.baseAddress?.trim() || asset.contractAddress,
        quoteAddress: pool.quoteAddress?.trim() || "",
        dexVolumeUsd: pool.volume24hUsd,
        liquidityUsd: pool.liquidityUsd,
        geckoVolumeUsd: null,
        geckoOk: false,
        includeInDexSample: true,
      });
    }
  }

  for (const known of input.knownPools ?? []) {
    const pair = known.pair.trim();
    if (!pair || pools.has(pair)) continue;
    if (!known.base && !known.quote) continue;
    candleAnyway.add(pair);
    pools.set(pair, {
      pairAddress: pair,
      dexId: "geckoterminal",
      baseAddress: known.base,
      quoteAddress: known.quote,
      dexVolumeUsd: null,
      liquidityUsd: null,
      geckoVolumeUsd: null,
      geckoOk: false,
      includeInDexSample: false,
    });
  }

  let nextAt = 0;
  const geckoGet = async (url: string): Promise<unknown> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wait = nextAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      nextAt = Date.now() + GECKO_GAP_MS;
      try {
        const response = await input.fetchImpl(url);
        if (response.status === 429 && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 15_000 * (attempt + 1)));
          continue;
        }
        if (!response.ok) return null;
        return await response.json();
      } catch {
        return null;
      }
    }
    return null;
  };

  for (const asset of input.assets) {
    if (isPerpInstrument(asset.symbol, asset.name)) continue;
    for (let page = 1; page <= 3; page += 1) {
      const payload = await geckoGet(
        `${geckoBase}/networks/solana/tokens/${encodeURIComponent(asset.contractAddress)}/pools?page=${page}`,
      );
      const rows = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        const parsed = parseGeckoPoolRow(row);
        if (!parsed || pools.has(parsed.pairAddress)) continue;
        const signal = Math.max(parsed.h24 ?? 0, parsed.reserve ?? 0);
        if (signal < minH24) continue;
        const base = parsed.baseAddress || asset.contractAddress;
        const quote = parsed.quoteAddress;
        if (!desk.has(base) && !desk.has(quote) && base !== asset.contractAddress) continue;
        candleAnyway.add(parsed.pairAddress);
        pools.set(parsed.pairAddress, {
          pairAddress: parsed.pairAddress,
          dexId: parsed.dexId,
          baseAddress: base,
          quoteAddress: quote,
          dexVolumeUsd: parsed.h24,
          liquidityUsd: parsed.reserve,
          geckoVolumeUsd: null,
          geckoOk: false,
          includeInDexSample: false,
        });
      }
      if (rows.length < 20) break;
    }
  }

  for (const pool of pools.values()) {
    const signal = Math.max(pool.dexVolumeUsd ?? 0, pool.liquidityUsd ?? 0);
    if (signal < minH24 && !candleAnyway.has(pool.pairAddress)) continue;
    const payload = await geckoGet(
      `${geckoBase}/networks/solana/pools/${encodeURIComponent(pool.pairAddress)}/ohlcv/hour?aggregate=1&limit=1000&currency=usd`,
    );
    const summed = sumHourlyCandlesOnEasternDay(parseGeckoOhlcvCandles(payload), input.dayKey);
    pool.geckoOk = summed.covered;
    pool.geckoVolumeUsd = summed.volumeUsd;
  }
  return [...pools.values()];
}

function parseGeckoPoolRow(row: unknown): {
  pairAddress: string;
  baseAddress: string;
  quoteAddress: string;
  h24: number | null;
  reserve: number | null;
  dexId: string;
} | null {
  if (!row || typeof row !== "object") return null;
  const item = row as {
    id?: unknown;
    attributes?: { address?: unknown; reserve_in_usd?: unknown; volume_usd?: { h24?: unknown } };
    relationships?: {
      base_token?: { data?: { id?: unknown } };
      quote_token?: { data?: { id?: unknown } };
      dex?: { data?: { id?: unknown } };
    };
  };
  const address = typeof item.attributes?.address === "string" ? item.attributes.address.trim() : "";
  const ident = typeof item.id === "string" && item.id.includes("_") ? item.id.slice(item.id.indexOf("_") + 1) : "";
  const pairAddress = address || ident;
  if (!pairAddress) return null;
  const side = (id: unknown) => {
    const text = typeof id === "string" ? id : "";
    return text.includes("_") ? text.slice(text.indexOf("_") + 1) : "";
  };
  const rawH24 = item.attributes?.volume_usd?.h24;
  const h24 = typeof rawH24 === "number" || typeof rawH24 === "string" ? Number(rawH24) : null;
  const rawReserve = item.attributes?.reserve_in_usd;
  const reserve = typeof rawReserve === "number" || typeof rawReserve === "string" ? Number(rawReserve) : null;
  return {
    pairAddress,
    baseAddress: side(item.relationships?.base_token?.data?.id),
    quoteAddress: side(item.relationships?.quote_token?.data?.id),
    h24: h24 !== null && Number.isFinite(h24) && h24 >= 0 ? h24 : null,
    reserve: reserve !== null && Number.isFinite(reserve) && reserve >= 0 ? reserve : null,
    dexId: typeof item.relationships?.dex?.data?.id === "string" ? item.relationships.dex.data.id : "geckoterminal",
  };
}

function gapPercent(dex: number | null, gecko: number | null): number | null {
  if (dex === null || gecko === null) return null;
  const base = Math.max(Math.abs(dex), Math.abs(gecko), 1);
  return Math.round((Math.abs(dex - gecko) / base) * 10000) / 100;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
