import { createHash } from "node:crypto";
import { loadHolderSnapshotFile } from "./holder-snapshot-store";
import {
  holderAddressKey,
  marketValuePrice,
  type HolderSnapshotChainId,
  type HolderSnapshotDay,
  type HolderUniverseAsset,
} from "./holder-snapshots";
import type { FetchLike } from "./solana-http";

/** DexScreener chain slugs for tokens/v1 price batches (holder market value only; never volume). */
const DEX_SLUG: Record<HolderSnapshotChainId, string> = {
  solana: "solana",
  base: "base",
  bnb: "bsc",
  robinhood: "robinhood",
};

/** Holder completeness guard: refuse a day whose asset count drops below this share of the prior day. */
export const HOLDER_MIN_ASSET_RATIO = 0.9;

export async function priorHolderDay(
  chainId: HolderSnapshotChainId,
  date: string,
  dir?: string,
): Promise<HolderSnapshotDay | null> {
  const file = await loadHolderSnapshotFile(chainId, dir);
  const prior = file.records.filter((row) => row.date < date).sort((a, b) => a.date.localeCompare(b.date));
  return prior.length ? prior[prior.length - 1] : null;
}

type DexPair = {
  priceUsd?: string | number | null;
  liquidity?: { usd?: number | null } | null;
  baseToken?: { address?: string } | null;
};

/**
 * Live catalogs miss whole issuers when a registry 403s or an API key is absent (Base Dinari,
 * BNB Ondo / bStocks on 2026-10-28). Every asset on the prior day's record that the live
 * universe lacks is carried in, priced fresh from DexScreener tokens/v1 at capture time
 * (deepest base-side pool, same marketValuePrice rule). A miss stays priceUsd null.
 */
export async function unionWithPriorDay(input: {
  chainId: HolderSnapshotChainId;
  universe: readonly HolderUniverseAsset[];
  prior: HolderSnapshotDay | null;
  fetchImpl?: FetchLike;
  dexBaseUrl?: string;
}): Promise<{ universe: HolderUniverseAsset[]; carried: number }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const have = new Set(input.universe.map((row) => holderAddressKey(row.address)));
  const missing = (input.prior?.assets ?? []).filter((row) => !have.has(holderAddressKey(row.address)));
  if (!missing.length) return { universe: [...input.universe], carried: 0 };
  const base = (input.dexBaseUrl ?? "https://api.dexscreener.com").replace(/\/+$/, "");
  const pairsBy = new Map<string, DexPair[]>();
  for (let i = 0; i < missing.length; i += 30) {
    const batch = missing.slice(i, i + 30).map((row) => row.address);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const res = await fetchImpl(`${base}/tokens/v1/${DEX_SLUG[input.chainId]}/${batch.join(",")}`, {
          headers: { accept: "application/json" },
        });
        if (res.status === 429 || res.status >= 500) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        const body = res.ok ? ((await res.json()) as unknown) : null;
        const pairs = Array.isArray(body) ? (body as DexPair[]) : [];
        for (const pair of pairs) {
          const key = holderAddressKey(pair.baseToken?.address ?? "");
          if (!key) continue;
          const list = pairsBy.get(key) ?? [];
          list.push(pair);
          pairsBy.set(key, list);
        }
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }
  const carried = missing.map((row) => {
    const pools = (pairsBy.get(holderAddressKey(row.address)) ?? []).map((pair) => ({
      priceUsd: pair.priceUsd === null || pair.priceUsd === undefined ? null : Number(pair.priceUsd),
      liquidityUsd: typeof pair.liquidity?.usd === "number" ? pair.liquidity.usd : null,
      baseAddress: pair.baseToken?.address ?? null,
    }));
    const asset: HolderUniverseAsset = {
      address: row.address,
      symbol: row.symbol,
      issuer: row.issuer ?? null,
      instrumentKind: row.instrumentKind,
      priceUsd: null,
      displayedLiquidityUsd: null,
      pools,
    };
    const quote = marketValuePrice(asset);
    return { ...asset, priceUsd: quote.priceUsd, displayedLiquidityUsd: quote.displayedLiquidityUsd };
  });
  return { universe: [...input.universe, ...carried], carried: carried.length };
}

export function holderShardOf(address: string, shards: number): number {
  return createHash("sha1").update(holderAddressKey(address)).digest().readUInt32BE(0) % shards;
}

export function holderGuard(day: Pick<HolderSnapshotDay, "assetCount">, prior: HolderSnapshotDay | null): string | null {
  if (!prior || !prior.assetCount) return null;
  if (day.assetCount < HOLDER_MIN_ASSET_RATIO * prior.assetCount) {
    return `asset count ${day.assetCount} < ${HOLDER_MIN_ASSET_RATIO} x prior ${prior.date} (${prior.assetCount}); row refused`;
  }
  return null;
}
