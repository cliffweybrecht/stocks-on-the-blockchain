import { sleep } from "./async-pool";
import { asHolderCount } from "./solana-holders";
import { parseUiAmountString } from "./solana-supply";
import type { FetchLike } from "./solana-http";
import { decimalAdjustedSupply, rawUint } from "./holder-snapshots";

export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const SOLANA_SUPPLY_SOURCE = "solana-rpc:getTokenSupply";
export const SOLANA_HOLDER_SOURCE = "solana-rpc:getProgramAccounts";
export const EVM_SUPPLY_SOURCE = "evm-rpc:eth_call:totalSupply+decimals";
export const EVM_HOLDER_SOURCE = "geckoterminal:holders.count";
export const DEXSCREENER_PRICE_SOURCE = "dexscreener:dexMedianPriceUsd";

/** totalSupply() */
export const ERC20_TOTAL_SUPPLY_DATA = "0x18160ddd";
/** decimals() */
export const ERC20_DECIMALS_DATA = "0x313ce567";

const HEX_WORD = /^0x[0-9a-fA-F]*$/;

export interface SolanaMintSupply {
  raw: string;
  decimals: number;
  /** `uiAmountString` when the RPC sent one. That is the unit DexScreener prices. */
  adjusted: number | null;
  source: string;
}

export interface EvmTokenSupply {
  raw: string;
  decimals: number | null;
  adjusted: number | null;
  source: string;
}

export interface SolanaHolderCensus {
  holderCount: number | null;
  program: "spl-token" | "token-2022" | null;
  source: string | null;
  note: string | null;
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function readJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<unknown | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { signal, cancel } = timeoutSignal(timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal, cache: "no-store" });
      if (response.ok) return (await response.json()) as unknown;
      const retry = response.status === 429 || response.status >= 500;
      if (!retry || attempt === 3) return null;
    } catch {
      if (attempt === 3) return null;
    } finally {
      cancel();
    }
    await sleep(1000 * (attempt + 1));
  }
  return null;
}

export async function postJson(
  url: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<unknown | null> {
  return readJson(
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "stocks-on-the-blockchain/0.1",
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
    fetchImpl,
  );
}

export async function getJson(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<unknown | null> {
  return readJson(
    url,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "stocks-on-the-blockchain/0.1",
      },
    },
    timeoutMs,
    fetchImpl,
  );
}

export function parseHexQuantity(value: unknown): bigint | null {
  if (typeof value !== "string" || !HEX_WORD.test(value.trim())) return null;
  const hex = value.trim().slice(2);
  if (!hex) return null;
  try {
    return BigInt(`0x${hex}`);
  } catch {
    return null;
  }
}

export function parseSolanaMintSupply(payload: unknown): SolanaMintSupply | null {
  if (!payload || typeof payload !== "object") return null;
  if ("error" in (payload as object)) return null;
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const value = (result as { value?: unknown }).value;
  if (!value || typeof value !== "object") return null;
  const row = value as { amount?: unknown; decimals?: unknown; uiAmountString?: unknown; uiAmount?: unknown };
  const raw = typeof row.amount === "string" ? rawUint(row.amount) : null;
  const decimals = typeof row.decimals === "number" && Number.isInteger(row.decimals) ? row.decimals : null;
  if (!raw || decimals === null || decimals < 0 || decimals > 36) return null;
  let adjusted: number | null = null;
  if (row.uiAmountString !== undefined && row.uiAmountString !== null) {
    adjusted = parseUiAmountString(row.uiAmountString);
  } else if (typeof row.uiAmount === "number") {
    adjusted = Number.isFinite(row.uiAmount) && row.uiAmount >= 0 ? row.uiAmount : null;
  } else {
    adjusted = decimalAdjustedSupply(BigInt(raw), decimals);
  }
  return { raw, decimals, adjusted, source: SOLANA_SUPPLY_SOURCE };
}

export function parseEvmSupplyCall(payload: unknown): bigint | null {
  if (!payload || typeof payload !== "object") return null;
  if ("error" in (payload as object)) return null;
  return parseHexQuantity((payload as { result?: unknown }).result);
}

export function parseEvmDecimalsCall(payload: unknown): number | null {
  const raw = parseEvmSupplyCall(payload);
  if (raw === null || raw > BigInt(36)) return null;
  return Number(raw);
}

/**
 * Count token accounts whose sliced amount is a non-zero u64.
 * `dataSlice` offset 64 length 8 is the SPL amount field for both Token and Token-2022.
 * An RPC error is null. An empty account list is a real zero.
 */
export function countNonZeroSplAmounts(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  if ("error" in (payload as object)) return null;
  const result = (payload as { result?: unknown }).result;
  if (!Array.isArray(result)) return null;
  let nonzero = 0;
  for (const row of result) {
    if (!row || typeof row !== "object") continue;
    const data = (row as { account?: { data?: unknown } }).account?.data;
    const encoded = Array.isArray(data) ? data[0] : data;
    if (typeof encoded !== "string" || !encoded) continue;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length < 8) continue;
    const amount = bytes.readBigUInt64LE(0);
    if (amount > BigInt(0)) nonzero += 1;
  }
  return nonzero;
}

export function tokenProgramKind(owner: string | null): "spl-token" | "token-2022" | null {
  if (owner === SPL_TOKEN_PROGRAM_ID) return "spl-token";
  if (owner === TOKEN_2022_PROGRAM_ID) return "token-2022";
  return null;
}

/** GeckoTerminal token info `holders.count`. Same field the asset page already reads. */
export function parseGeckoHolderCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const count = (payload as { data?: { attributes?: { holders?: { count?: unknown } } } }).data?.attributes?.holders
    ?.count;
  return asHolderCount(count);
}

export function parseMintOwner(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as { result?: { value?: { owner?: unknown } | null } }).result?.value;
  if (!value || typeof value !== "object") return null;
  const owner = (value as { owner?: unknown }).owner;
  return typeof owner === "string" && owner.trim() ? owner.trim() : null;
}

export async function fetchSolanaMintSupply(
  mint: string,
  rpcUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<SolanaMintSupply | null> {
  const payload = await postJson(
    rpcUrl,
    { jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] },
    timeoutMs,
    fetchImpl,
  );
  return parseSolanaMintSupply(payload);
}

export async function fetchMintOwner(
  mint: string,
  rpcUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<string | null> {
  const payload = await postJson(
    rpcUrl,
    { jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "base64" }] },
    timeoutMs,
    fetchImpl,
  );
  return parseMintOwner(payload);
}

export async function fetchSolanaHolderCount(
  mint: string,
  programId: string,
  rpcUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<number | null> {
  const payload = await postJson(
    rpcUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "getProgramAccounts",
      params: [
        programId,
        {
          encoding: "base64",
          dataSlice: { offset: 64, length: 8 },
          filters: [{ memcmp: { offset: 0, bytes: mint } }],
        },
      ],
    },
    timeoutMs,
    fetchImpl,
  );
  return countNonZeroSplAmounts(payload);
}

export async function fetchEvmWord(
  rpcUrl: string,
  contract: string,
  data: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<bigint | null> {
  const payload = await postJson(
    rpcUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: contract, data }, "latest"],
    },
    timeoutMs,
    fetchImpl,
  );
  return parseEvmSupplyCall(payload);
}

export async function fetchEvmTokenSupply(
  contract: string,
  rpcUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<EvmTokenSupply | null> {
  const [raw, decimals] = await Promise.all([
    fetchEvmWord(rpcUrl, contract, ERC20_TOTAL_SUPPLY_DATA, timeoutMs, fetchImpl),
    fetchEvmWord(rpcUrl, contract, ERC20_DECIMALS_DATA, timeoutMs, fetchImpl).then((word) => {
      if (word === null || word > BigInt(36)) return null;
      return Number(word);
    }),
  ]);
  if (raw === null) return null;
  return {
    raw: raw.toString(),
    decimals,
    adjusted: decimals === null ? null : decimalAdjustedSupply(raw, decimals),
    source: EVM_SUPPLY_SOURCE,
  };
}

export async function fetchGeckoHolderCount(
  network: string,
  address: string,
  geckoBaseUrl: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
): Promise<number | null> {
  const base = geckoBaseUrl.replace(/\/+$/, "");
  const payload = await getJson(
    `${base}/networks/${encodeURIComponent(network)}/tokens/${address}/info`,
    timeoutMs,
    fetchImpl,
  );
  return parseGeckoHolderCount(payload);
}
