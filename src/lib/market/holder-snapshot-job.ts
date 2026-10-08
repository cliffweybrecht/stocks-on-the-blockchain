import { mapWithConcurrency } from "./async-pool";
import { loadBaseChainMarkets } from "./base-chain-markets";
import { loadBnbChainMarkets } from "./bnb-chain-markets";
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
  easternSnapshotDate,
  holderSnapshotTotals,
  sortHolderAssets,
  type HolderSnapshotAsset,
  type HolderSnapshotChainId,
  type HolderSnapshotDay,
  type HolderUniverseAsset,
} from "./holder-snapshots";
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
    "supplyUsd is decimal-adjusted total supply times the desk DexScreener price already on the asset. A missing price or supply leaves supplyUsd null. It is not volume.";
  if (chainId === "solana") {
    return [
      "Supply is public Solana RPC getTokenSupply. totalSupplyRaw is the raw amount, totalSupplyDecimals is the mint decimals, and totalSupply is uiAmountString so a Token-2022 scaled UI multiplier is kept. DexScreener prices that UI unit. amount/10^decimals is not substituted when uiAmountString is present.",
      "Holders are public Solana RPC getProgramAccounts on the mint owner (SPL Token or Token-2022), filtered by memcmp of the mint at offset 0, with dataSlice of the u64 amount at offset 64. Non-zero balances are counted. Token-2022 accounts are not dropped for extension size because dataSize is not filtered. A failed call stays null. The chain total sums those per-mint counts and is not unique wallets.",
      price,
    ];
  }
  const native = chainId === "base" ? "8453" : chainId === "bnb" ? "56" : "4663";
  const rpc =
    chainId === "base" ? DEFAULT_BASE_RPC_URL : chainId === "bnb" ? DEFAULT_BNB_RPC_URL : DEFAULT_ROBINHOOD_RPC_URL;
  return [
    `Supply is eth_call totalSupply() and decimals() on ${rpc}. totalSupplyRaw is the integer. totalSupply is raw / 10^decimals. A missing decimals() leaves the adjusted supply null.`,
    `Holders are GeckoTerminal token-info holders.count (network ${EVM_GECKO_NETWORK[chainId]}), the same integer this desk already shows on the asset page. Calls are one at a time, at least 6.5 seconds apart, because a faster pace receives HTTP 429 on this host. HTTP 429 is retried and is not stored as a count. Blockscout's public API for this chain returned a Cloudflare challenge from the snapshot host, and Routescan tokenholdercount does not index chain ${native} (response: chain not supported). A 404 or a payload with no holders.count stays null. The chain total sums per-token counts and is not unique wallets.`,
    price,
  ];
}

function fromSummary(asset: AssetSummary): HolderUniverseAsset | null {
  const address = asset.contractAddress.trim();
  const symbol = asset.symbol.trim();
  if (!address || !symbol) return null;
  const kind: InstrumentKind = asset.instrumentKind;
  return {
    address,
    symbol,
    issuer: asset.issuer?.trim() || null,
    instrumentKind: kind,
    priceUsd:
      typeof asset.dexMedianPriceUsd === "number" && Number.isFinite(asset.dexMedianPriceUsd) && asset.dexMedianPriceUsd > 0
        ? asset.dexMedianPriceUsd
        : null,
  };
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
    return dedupeUniverse(
      [...catalog.assets, ...catalog.etfAssets, ...catalog.privateAssets]
        .map(fromSummary)
        .filter((row): row is HolderUniverseAsset => row !== null),
    );
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
    return buildHolderSnapshotAsset({
      asset,
      totalSupplyRaw: supply?.raw ?? null,
      totalSupplyDecimals: supply?.decimals ?? null,
      totalSupply: supply?.adjusted ?? null,
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
  return `snapshot:holders wrote ${chainId} ${day.date} holders=${day.holderCount ?? "null"} supplyUsd=${day.supplyUsd ?? "null"} assets=${day.assetCount} nullHolders=${nullHolders} nullSupply=${nullSupply} capturedAt=${day.capturedAt} -> ${filePath}`;
}
