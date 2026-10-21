import { mapWithConcurrency } from "./async-pool";
import { loadBaseChainMarkets } from "./base-chain-markets";
import { DEFAULT_BNB_DEX_BASE_URL, loadBnbChainMarkets } from "./bnb-chain-markets";
import { BSTOCKS_SEED } from "./bnb-bstocks-seed";
import { BNB_DEX_CHAIN_SLUG, BSTOCKS_ISSUER_LABEL, buildBnbMarketLanes, type BnbListedToken } from "./bnb-markets";
import { createSolanaMarketDataSource, isSolanaMarketEnabled, type MarketEnv } from "./factory";
import {
  DEXSCREENER_PRICE_SOURCE,
  EVM_HOLDER_SOURCE,
  EVM_SUPPLY_SOURCE,
  SOLANA_HOLDER_SOURCE,
  SOLANA_SUPPLY_SOURCE,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  fetchEvmTokenSupply,
  fetchGeckoHolderRead,
  fetchMintOwner,
  fetchSolanaHolderCount,
  fetchSolanaMintSupply,
  tokenProgramKind,
} from "./holder-snapshot-fetch";
import {
  buildHolderSnapshotAsset,
  decimalAdjustedSupply,
  easternSnapshotDate,
  holderSnapshotTotals,
  marketValuePrice,
  sortHolderAssets,
  type HolderSnapshotAsset,
  type HolderSnapshotChainId,
  type HolderSnapshotDay,
  type HolderUniverseAsset,
} from "./holder-snapshots";
import { chunkValues, DEXSCREENER_TOKEN_BATCH_SIZE } from "./solana-discover";
import { unwrapDexScreenerPairs } from "./map-solana";
import { utcInstantForDayKey } from "./volume-snapshots";
import { DEFAULT_GECKOTERMINAL_BASE_URL } from "./solana-geckoterminal";
import type { FetchLike } from "./solana-http";
import { DEFAULT_SOLANA_RPC_URL } from "./solana-supply";
import { MemoryDeskVolumeSnapshotStore } from "./volume-snapshots";
import { loadRobinhoodChainMarkets } from "./robinhood-chain-markets";
import type { AssetSummary, InstrumentKind } from "./types";

export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
export const DEFAULT_BNB_RPC_URL = "https://bsc-dataseed.binance.org";
export const DEFAULT_ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

const EVM_GECKO_NETWORK: Record<Exclude<HolderSnapshotChainId, "solana">, string> = {
  base: "base",
  bnb: "bsc",
  robinhood: "robinhood",
};

export function holderChainLimits(chainId: HolderSnapshotChainId): string[] {
  const price =
    "supplyUsd is circulating supply times the desk DexScreener price already on the asset. Circulating supply is the outstanding amount in the unit that price quotes. A missing price, a displayed pool reserve under $1, or an unreadable supply leaves supplyUsd null. It is not volume, and it is not a pool's reported market cap. Issuer treasury, escrow, and bridge balances are not subtracted unless this capture read them. Unreadable balances stay null rather than a guessed float.";
  if (chainId === "solana") {
    return [
      "Supply is public Solana RPC getTokenSupply. totalSupplyRaw is the mint amount. totalSupplyDecimals is the mint decimals. totalSupply is uiAmountString, so a Token-2022 scaled UI multiplier stays on the mint census. circulatingSupply is amount/10^decimals. DexScreener priceUsd quotes that unscaled unit: NFLXx's multiplier of 10 made uiAmount about 1,550,568 while the raw decimal supply was about 155,057, and the pair price was about 10× the Netflix share. Market value uses the unscaled supply. amount/10^decimals is not replaced by uiAmountString.",
      "Holders are public Solana RPC getProgramAccounts on the mint owner (SPL Token or Token-2022), filtered by memcmp of the mint at offset 0, with dataSlice of the u64 amount at offset 64. Non-zero balances are counted. Token-2022 accounts are not dropped for extension size because dataSize is not filtered. A failed call stays null. The chain total sums those per-mint counts and is not unique wallets. Pool accounts are included in the holder count. They are not added again into supply.",
      "The price is the deepest pool that quotes this mint as the base token and holds at least $1. A thinner pool is not averaged into a median. CSCOx on 2026-10-20 had a Raydium USDC pool near $115 with about $441 of reserve and a Fluxbeam pool near $38,210 with about $57; the median of those two was about $19,163 and is not used. A reserve under $1 is not a market price. Meteora DBC clones (tOpenAI, BLK, SPCX, NKE mints ending in jups on the 2026-10-08 capture) printed about $1 of reserve against a ~780,000,000 mint and are left null. A missing reserve is not treated as $0.",
      price,
    ];
  }
  const native = chainId === "base" ? "8453" : chainId === "bnb" ? "56" : "4663";
  const rpc =
    chainId === "base" ? DEFAULT_BASE_RPC_URL : chainId === "bnb" ? DEFAULT_BNB_RPC_URL : DEFAULT_ROBINHOOD_RPC_URL;
  return [
    `Supply is eth_call totalSupply() and decimals() on ${rpc}. totalSupplyRaw is the integer. totalSupply and circulatingSupply are raw / 10^decimals. ERC-20 totalSupply is the outstanding mint; this capture does not see a separate unminted cap. A missing decimals() leaves both supplies null. Issuer treasury and bridge vaults are not subtracted, because this host has no published per-token treasury list for the chain. Those balances stay inside outstanding supply rather than a guessed circulating float.`,
    `Holders are GeckoTerminal token-info holders.count (network ${EVM_GECKO_NETWORK[chainId]}), the same integer this desk already shows on the asset page. Calls are one at a time, at least 6.5 seconds apart, because a faster pace receives HTTP 429 on this host. HTTP 429 is retried and is not stored as a count. Blockscout's public API for this chain returned a Cloudflare challenge from the snapshot host, and Routescan tokenholdercount does not index chain ${native} (response: chain not supported). A 404 or a payload with no holders.count stays null. The chain total sums per-token counts and is not unique wallets.`,
    price,
  ];
}

function fromSummary(asset: AssetSummary): HolderUniverseAsset | null {
  const address = asset.contractAddress.trim();
  const symbol = asset.symbol.trim();
  if (!address || !symbol) return null;
  const kind: InstrumentKind = asset.instrumentKind;
  const quote = marketValuePrice({
    address,
    symbol,
    issuer: asset.issuer?.trim() || null,
    instrumentKind: kind,
    priceUsd:
      typeof asset.dexMedianPriceUsd === "number" && Number.isFinite(asset.dexMedianPriceUsd) && asset.dexMedianPriceUsd > 0
        ? asset.dexMedianPriceUsd
        : null,
    displayedLiquidityUsd:
      typeof asset.displayedLiquidityUsd === "number" && Number.isFinite(asset.displayedLiquidityUsd) && asset.displayedLiquidityUsd >= 0
        ? asset.displayedLiquidityUsd
        : null,
    pools: asset.pools.map((pool) => ({
      priceUsd: typeof pool.priceUsd === "number" ? pool.priceUsd : null,
      liquidityUsd: typeof pool.liquidityUsd === "number" ? pool.liquidityUsd : null,
      baseAddress: pool.baseAddress ?? null,
    })),
  });
  return {
    address,
    symbol,
    issuer: asset.issuer?.trim() || null,
    instrumentKind: kind,
    priceUsd: quote.priceUsd,
    displayedLiquidityUsd: quote.displayedLiquidityUsd,
  };
}

/**
 * Jumper's bStocks catalog 403s from this host. When the live registry has
 * no bStocks row, the volume writer's seed is the name list. DexScreener
 * still has to price each contract. A miss stays null.
 */
export function withBstockSeed(
  rows: readonly HolderUniverseAsset[],
  seed: readonly HolderUniverseAsset[],
): HolderUniverseAsset[] {
  if (rows.some((row) => row.issuer === "bStocks")) return dedupeUniverse(rows);
  return dedupeUniverse([...rows, ...seed]);
}

export async function loadBstockSeedUniverse(fetchImpl: FetchLike = fetch): Promise<HolderUniverseAsset[]> {
  const tokens: BnbListedToken[] = BSTOCKS_SEED.map((row) => ({
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    issuer: BSTOCKS_ISSUER_LABEL,
    kind: row.kind,
    logoUrl: null,
  }));
  const dexBase = DEFAULT_BNB_DEX_BASE_URL.replace(/\/+$/, "");
  const pairs = [];
  for (const addresses of chunkValues(
    tokens.map((token) => token.address),
    DEXSCREENER_TOKEN_BATCH_SIZE,
  )) {
    try {
      const response = await fetchImpl(`${dexBase}/tokens/v1/${BNB_DEX_CHAIN_SLUG}/${addresses.join(",")}`, {
        headers: { accept: "application/json" },
      });
      const payload = response.ok ? await response.json() : null;
      pairs.push(...unwrapDexScreenerPairs(payload));
    } catch {
      // That batch stays unpriced. Supply can still be read.
    }
  }
  const lanes = buildBnbMarketLanes(tokens, pairs, { volumeHydrated: pairs.length > 0 });
  return dedupeUniverse(
    [...lanes.assets, ...lanes.etfAssets, ...lanes.privateAssets]
      .map(fromSummary)
      .filter((row): row is HolderUniverseAsset => row !== null),
  );
}

function dedupeUniverse(assets: readonly HolderUniverseAsset[]): HolderUniverseAsset[] {
  const byAddress = new Map<string, HolderUniverseAsset>();
  for (const asset of assets) {
    const key = asset.address.startsWith("0x") || asset.address.startsWith("0X") ? asset.address.toLowerCase() : asset.address;
    if (!key || byAddress.has(key)) continue;
    byAddress.set(key, asset);
  }
  return [...byAddress.values()];
}

export async function loadHolderUniverse(
  chainId: HolderSnapshotChainId,
  env: MarketEnv = process.env,
): Promise<HolderUniverseAsset[]> {
  if (chainId === "solana") {
    if (!isSolanaMarketEnabled(env)) {
      throw new Error("Solana holder snapshot requires SOLANA_MARKET_ENABLED=true so the desk universe is the live one.");
    }
    const source = createSolanaMarketDataSource(env, {
      backgroundEnrichment: false,
      enableJupiterHolders: false,
      enablePairHolders: false,
      enableMintSupply: false,
      volumeSnapshotStore: new MemoryDeskVolumeSnapshotStore(),
    });
    const detail = await source.getChain("solana");
    if (!detail) throw new Error("Solana desk returned no chain.");
    return dedupeUniverse(
      [...detail.assets, ...(detail.etfAssets ?? []), ...(detail.privateAssets ?? [])]
        .map(fromSummary)
        .filter((row): row is HolderUniverseAsset => row !== null),
    );
  }
  if (chainId === "base") {
    const catalog = await loadBaseChainMarkets();
    return dedupeUniverse(
      [...catalog.assets, ...catalog.etfAssets, ...catalog.privateAssets]
        .map(fromSummary)
        .filter((row): row is HolderUniverseAsset => row !== null),
    );
  }
  if (chainId === "bnb") {
    const catalog = await loadBnbChainMarkets();
    const rows = dedupeUniverse(
      [...catalog.assets, ...catalog.etfAssets, ...catalog.privateAssets]
        .map(fromSummary)
        .filter((row): row is HolderUniverseAsset => row !== null),
    );
    if (rows.some((row) => row.issuer === "bStocks")) return rows;
    return withBstockSeed(rows, await loadBstockSeedUniverse());
  }
  const catalog = await loadRobinhoodChainMarkets();
  return dedupeUniverse(
    [...catalog.assets, ...catalog.etfAssets, ...catalog.privateAssets]
      .map(fromSummary)
      .filter((row): row is HolderUniverseAsset => row !== null),
  );
}

export function rpcUrlFor(chainId: HolderSnapshotChainId, env: MarketEnv = process.env): string {
  if (chainId === "solana") return env.SOLANA_RPC_URL?.trim() || DEFAULT_SOLANA_RPC_URL;
  if (chainId === "base") return env.BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
  if (chainId === "bnb") return env.BNB_RPC_URL?.trim() || DEFAULT_BNB_RPC_URL;
  return env.ROBINHOOD_RPC_URL?.trim() || DEFAULT_ROBINHOOD_RPC_URL;
}

async function captureOne(
  chainId: HolderSnapshotChainId,
  asset: HolderUniverseAsset,
  options: {
    rpcUrl: string;
    geckoBaseUrl: string;
    timeoutMs: number;
    holderTimeoutMs: number;
    fetchImpl: FetchLike;
  },
): Promise<HolderSnapshotAsset> {
  const notes: string[] = [];
  if (chainId === "solana") {
    const supply = await fetchSolanaMintSupply(asset.address, options.rpcUrl, options.timeoutMs, options.fetchImpl);
    if (!supply) notes.push("getTokenSupply did not return a mint supply.");
    else if (supply.adjusted === null) notes.push("getTokenSupply ui amount was unreadable, so totalSupply is null.");
    const owner = await fetchMintOwner(asset.address, options.rpcUrl, options.timeoutMs, options.fetchImpl);
    const program = tokenProgramKind(owner);
    let holderCount: number | null = null;
    if (!program) {
      notes.push(
        owner
          ? "Mint owner is not SPL Token or Token-2022, so getProgramAccounts was not used."
          : "Mint account was not found, so holderCount is null.",
      );
    } else {
      const programId = program === "token-2022" ? TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
      holderCount = await fetchSolanaHolderCount(
        asset.address,
        programId,
        options.rpcUrl,
        options.holderTimeoutMs,
        options.fetchImpl,
      );
      if (holderCount === null) notes.push(`getProgramAccounts failed for ${program}.`);
    }
    const unscaled =
      supply && supply.raw ? decimalAdjustedSupply(BigInt(supply.raw), supply.decimals) : null;
    if (supply && unscaled === null) notes.push("amount/10^decimals was unreadable, so circulatingSupply is null.");
    else if (
      supply &&
      supply.adjusted !== null &&
      unscaled !== null &&
      supply.adjusted > 0 &&
      Math.abs(supply.adjusted - unscaled) / supply.adjusted > 0.001
    ) {
      notes.push(
        `Token-2022 scaled UI is ${supply.adjusted} and unscaled decimal supply is ${unscaled}. Market value uses the unscaled supply because DexScreener priceUsd quotes that unit.`,
      );
    }
    return buildHolderSnapshotAsset({
      asset,
      totalSupplyRaw: supply?.raw ?? null,
      totalSupplyDecimals: supply?.decimals ?? null,
      totalSupply: supply?.adjusted ?? null,
      circulatingSupply: unscaled,
      priceUsd: asset.priceUsd,
      holderCount,
      supplySource: SOLANA_SUPPLY_SOURCE,
      holderSource: program ? `${SOLANA_HOLDER_SOURCE}:${program}` : SOLANA_HOLDER_SOURCE,
      priceSource: DEXSCREENER_PRICE_SOURCE,
      notes,
      capturedAt: new Date().toISOString(),
    });
  }

  const network = EVM_GECKO_NETWORK[chainId];
  const [supply, holders] = await Promise.all([
    fetchEvmTokenSupply(asset.address, options.rpcUrl, options.timeoutMs, options.fetchImpl),
    fetchGeckoHolderRead(network, asset.address, options.geckoBaseUrl, options.timeoutMs, options.fetchImpl),
  ]);
  if (!supply) notes.push("eth_call totalSupply() did not return an integer.");
  else if (supply.decimals === null) notes.push("eth_call decimals() did not return a uint8, so totalSupply is null.");
  if (holders.note) notes.push(holders.note);
  return buildHolderSnapshotAsset({
    asset,
    totalSupplyRaw: supply?.raw ?? null,
    totalSupplyDecimals: supply?.decimals ?? null,
    totalSupply: supply?.adjusted ?? null,
    circulatingSupply: supply?.adjusted ?? null,
    priceUsd: asset.priceUsd,
    holderCount: holders.holderCount,
    supplySource: EVM_SUPPLY_SOURCE,
    holderSource: EVM_HOLDER_SOURCE,
    priceSource: DEXSCREENER_PRICE_SOURCE,
    notes,
    capturedAt: new Date().toISOString(),
  });
}

export async function captureHolderSnapshot(input: {
  chainId: HolderSnapshotChainId;
  universe: readonly HolderUniverseAsset[];
  unixSeconds: number;
  /** Eastern YYYY-MM-DD. Defaults to the Eastern calendar date of `unixSeconds`. */
  date?: string;
  fetchImpl?: FetchLike;
  rpcUrl?: string;
  geckoBaseUrl?: string;
  timeoutMs?: number;
  holderTimeoutMs?: number;
  concurrency?: number;
  log?: (message: string) => void;
}): Promise<HolderSnapshotDay> {
  const stamped = easternSnapshotDate(input.unixSeconds);
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : stamped?.date;
  const t = date ? utcInstantForDayKey(date) : 0;
  const stamp = date && t > 0 ? { date, t } : null;
  if (!stamp) throw new Error("Holder snapshot time is not a valid Eastern day.");
  const capturedAt = new Date(input.unixSeconds * 1000).toISOString();
  const fetchImpl = input.fetchImpl ?? fetch;
  const rpcUrl = input.rpcUrl ?? rpcUrlFor(input.chainId);
  const concurrency = input.concurrency ?? (input.chainId === "solana" ? 2 : 4);
  const timeoutMs = input.timeoutMs ?? 20_000;
  const holderTimeoutMs = input.holderTimeoutMs ?? (input.chainId === "solana" ? 90_000 : 20_000);
  const log = input.log ?? (() => undefined);
  let finished = 0;
  let rateLimited = 0;
  const assets = await mapWithConcurrency(input.universe, concurrency, async (asset) => {
    const row = await captureOne(input.chainId, asset, {
      rpcUrl,
      geckoBaseUrl: input.geckoBaseUrl ?? DEFAULT_GECKOTERMINAL_BASE_URL,
      timeoutMs,
      holderTimeoutMs,
      fetchImpl,
    });
    finished += 1;
    if (row.notes.some((note) => note.startsWith("GeckoTerminal rate limit"))) rateLimited += 1;
    if (finished % 25 === 0 || finished === input.universe.length) {
      log(`${input.chainId} ${finished}/${input.universe.length} rateLimited=${rateLimited}`);
    }
    return row;
  });
  const sorted = sortHolderAssets(assets);
  const totals = holderSnapshotTotals(sorted);
  return {
    date: stamp.date,
    t: stamp.t,
    capturedAt,
    ...totals,
    limits: holderChainLimits(input.chainId),
    assets: sorted,
  };
}

export function formatHolderSnapshotLine(chainId: HolderSnapshotChainId, day: HolderSnapshotDay, filePath: string): string {
  const nullHolders = day.assetCount - day.assetsWithHolders;
  const nullSupply = day.assets.filter((asset) => asset.totalSupply === null).length;
  return `snapshot:holders wrote ${chainId} ${day.date} holders=${day.holderCount ?? "null"} supplyUsd=${day.supplyUsd ?? "null"} public=${day.publicMarketValueUsd ?? "null"} private=${day.privateMarketValueUsd ?? "null"} etf=${day.etfMarketValueUsd ?? "null"} assets=${day.assetCount} nullHolders=${nullHolders} nullSupply=${nullSupply} capturedAt=${day.capturedAt} -> ${filePath}`;
}
