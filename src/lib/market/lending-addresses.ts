import { centrifugeBaseShareTokens, isEvmAddress, parseAnchoredTokenDocs, parseBackedAssets, parseCoinbaseTokenizedStocks, parseDinariStocksonchain, parseSt0xTokenList } from "./base-markets";
import { xStocksAssetsHasNextPage } from "./bnb-markets";
import { asNonEmptyString } from "./numbers";
import { parseRhjRegistry } from "./robinhood-markets";

const SOLANA_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface EquityAddressBook {
  /** Case-sensitive Solana mints. */
  solana: Set<string>;
  /** Chain id → lowercased EVM addresses. */
  evm: Map<number, Set<string>>;
}

export interface EquityAddressPayloads {
  xstocksPages?: readonly unknown[];
  stocksonchain?: unknown;
  rhj?: unknown;
  coinbase?: unknown;
  st0x?: unknown;
  backed?: unknown;
  dinari?: unknown;
  anchoredMarkdown?: string | null;
}

export function emptyEquityAddressBook(): EquityAddressBook {
  return { solana: new Set(), evm: new Map() };
}

/**
 * Map a registry network name onto a chain this desk lends on.
 * Unknown networks are ignored. Symbol is never used as a key.
 */
export function equityChainIdFromNetwork(network: unknown): "solana" | number | null {
  const raw = asNonEmptyString(network);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "solana") return "solana";
  if (key === "ethereum" || key === "eth" || key === "1") return 1;
  if (key === "base" || key === "8453") return 8453;
  if (key === "hyperevm" || key === "hyperliquid" || key === "999") return 999;
  if (key === "binancesmartchain" || key === "bnb" || key === "bsc" || key === "bnbchain" || key === "56") return 56;
  if (key === "robinhoodchain" || key === "robinhood" || key === "4663") return 4663;
  if (/^\d+$/.test(key)) {
    const id = Number(key);
    if (id === 1 || id === 8453 || id === 999 || id === 56 || id === 4663) return id;
  }
  return null;
}

export function evmChainKey(chainId: number): string | null {
  if (chainId === 1) return "ethereum";
  if (chainId === 8453) return "base";
  if (chainId === 999) return "hyperevm";
  if (chainId === 56) return "bnb";
  if (chainId === 4663) return "robinhood-chain";
  return null;
}

function addSolana(book: EquityAddressBook, address: unknown) {
  const mint = asNonEmptyString(address);
  if (!mint || !SOLANA_MINT.test(mint)) return;
  book.solana.add(mint);
}

function addEvm(book: EquityAddressBook, chainId: number, address: unknown) {
  const value = asNonEmptyString(address);
  if (!value || !isEvmAddress(value)) return;
  const set = book.evm.get(chainId) ?? new Set<string>();
  set.add(value.toLowerCase());
  book.evm.set(chainId, set);
}

function addListed(book: EquityAddressBook, chain: "solana" | number, address: unknown) {
  if (chain === "solana") addSolana(book, address);
  else addEvm(book, chain, address);
}

/** xStocks public assets API. Token address and wrappers only — not the nested stablecoins. */
export function addXStocksDeployments(book: EquityAddressBook, payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const nodes = (payload as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const deployments = (node as { deployments?: unknown }).deployments;
    if (!Array.isArray(deployments)) continue;
    for (const deployment of deployments) {
      if (!deployment || typeof deployment !== "object") continue;
      const dep = deployment as { network?: unknown; address?: unknown; wrapperAddress?: unknown; wrapperAddressV2?: unknown };
      const chain = equityChainIdFromNetwork(dep.network);
      if (chain === null) continue;
      addListed(book, chain, dep.address);
      addListed(book, chain, dep.wrapperAddress);
      addListed(book, chain, dep.wrapperAddressV2);
    }
  }
}

/** Stocks On Chain listings. The same records the chain desks already treat as verified. */
export function addStocksonchainListings(book: EquityAddressBook, payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const stocks = (payload as { stocks?: unknown }).stocks;
  if (!Array.isArray(stocks)) return;
  for (const stock of stocks) {
    if (!stock || typeof stock !== "object") continue;
    const listings = (stock as { listings?: unknown }).listings;
    if (!Array.isArray(listings)) continue;
    for (const listing of listings) {
      if (!listing || typeof listing !== "object") continue;
      const row = listing as { chain?: unknown; address?: unknown };
      const chain = equityChainIdFromNetwork(row.chain);
      if (chain === null) continue;
      addListed(book, chain, row.address);
    }
  }
}

export function buildEquityAddressBook(payloads: EquityAddressPayloads): EquityAddressBook {
  const book = emptyEquityAddressBook();
  for (const page of payloads.xstocksPages ?? []) addXStocksDeployments(book, page);
  if (payloads.stocksonchain) addStocksonchainListings(book, payloads.stocksonchain);
  for (const token of parseRhjRegistry(payloads.rhj)) addEvm(book, 4663, token.address);
  for (const token of parseCoinbaseTokenizedStocks(payloads.coinbase)) addEvm(book, 8453, token.address);
  for (const token of parseSt0xTokenList(payloads.st0x)) addEvm(book, 8453, token.address);
  for (const token of parseBackedAssets(payloads.backed)) addEvm(book, 8453, token.address);
  for (const token of parseDinariStocksonchain(payloads.dinari ?? payloads.stocksonchain)) addEvm(book, 8453, token.address);
  if (payloads.anchoredMarkdown) {
    for (const token of parseAnchoredTokenDocs(payloads.anchoredMarkdown)) addEvm(book, 8453, token.address);
  }
  for (const token of centrifugeBaseShareTokens()) addEvm(book, 8453, token.address);
  return book;
}

export function xstocksPageHasNext(payload: unknown): boolean {
  return xStocksAssetsHasNextPage(payload);
}

export function bookHasChain(book: EquityAddressBook, chainId: number): boolean {
  return (book.evm.get(chainId)?.size ?? 0) > 0;
}
