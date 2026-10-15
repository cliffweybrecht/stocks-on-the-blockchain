/** Public BSC endpoints. NowNodes has older logs. The rest are fallbacks when one node drops a call. */
const PUBLIC_BSC_RPCS = [
  "https://public-bsc.nownodes.io",
  "https://bsc.api.pocket.network",
  "https://rpc-bsc.48.club",
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.defibit.io",
  "https://bsc.publicnode.com",
];

export const BSC_LOG_RPC = PUBLIC_BSC_RPCS[1];

/** `BSC_RPC_URL` is tried first when set. The public list is the fallback. */
export function bscRpcUrls(): string[] {
  const preferred = process.env.BSC_RPC_URL?.trim();
  return [...new Set([preferred, ...PUBLIC_BSC_RPCS].filter((url): url is string => Boolean(url)))];
}

/** EIP-1967 beacon slot. */
export const BSTOCK_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

export const SYMBOL_SELECTOR = "0x95d89b41";

export function bscCallRpc(): string {
  return bscRpcUrls()[0] ?? PUBLIC_BSC_RPCS[0];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Try each URL, then try the list again. A dropped call does not fail the scan
 * until every URL has failed twice.
 */
export async function tryEachUrl<T>(
  urls: readonly string[],
  run: (url: string) => Promise<T>,
  options?: { rounds?: number; sleep?: (ms: number) => Promise<void> },
): Promise<T> {
  const rounds = options?.rounds ?? 2;
  const pause = options?.sleep ?? sleep;
  let last = "request failed";
  const list = urls.filter(Boolean);
  if (list.length === 0) throw new Error("No RPC URL is configured.");
  for (let round = 0; round < rounds; round += 1) {
    for (const url of list) {
      try {
        return await run(url);
      } catch (error) {
        last = error instanceof Error ? error.message : last;
      }
    }
    if (round < rounds - 1) await pause(Math.min(1_200, 400 * 2 ** round));
  }
  throw new Error(last);
}

/** Try each public RPC until one batch succeeds. A full miss is retried once. */
export async function bscBatchRotating(
  calls: { method: string; params: unknown[] }[],
  timeoutMs = 60_000,
): Promise<(string | null)[]> {
  return tryEachUrl(bscRpcUrls(), (url) => bscBatch(url, calls, timeoutMs));
}

export function padAddress(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function topicAddress(topic: string): string {
  return `0x${topic.toLowerCase().slice(-40)}`;
}

interface RpcResponse {
  id?: number;
  result?: string;
  error?: { message?: string };
}

export async function bscBatch(url: string, calls: { method: string; params: unknown[] }[], timeoutMs = 60_000): Promise<(string | null)[]> {
  if (calls.length === 0) return [];
  const out: (string | null)[] = [];
  for (let index = 0; index < calls.length; index += 40) {
    const chunk = calls.slice(index, index + 40);
    const body = chunk.map((call, id) => ({ jsonrpc: "2.0", id, method: call.method, params: call.params }));
    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (compatible; StocksOnTheBlockchain/1.0)" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const payload = (await response.json()) as RpcResponse | RpcResponse[];
    const rows = Array.isArray(payload) ? payload : [payload];
    rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    if (rows.length !== chunk.length) throw new Error("BSC batch returned the wrong number of results.");
    for (const row of rows) {
      if (row.error) throw new Error(row.error.message || "BSC call failed");
      out.push(typeof row.result === "string" ? row.result : null);
    }
  }
  return out;
}

export async function readBeacons(addresses: readonly string[], rpc?: string): Promise<Map<string, string | null>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const calls = unique.map((address) => ({ method: "eth_getStorageAt", params: [address, BSTOCK_BEACON_SLOT, "latest"] }));
  const results = rpc ? await bscBatch(rpc, calls) : await bscBatchRotating(calls);
  const map = new Map<string, string | null>();
  unique.forEach((address, index) => {
    const raw = results[index];
    if (!raw || raw === "0x" || /^0x0+$/.test(raw)) {
      map.set(address, null);
      return;
    }
    map.set(address, topicAddress(raw));
  });
  return map;
}

export function decodeAbiString(hex: string | null | undefined): string | null {
  if (!hex || hex === "0x") return null;
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (body.length < 64) return null;
  try {
    if (body.length <= 64) {
      const text = Buffer.from(body, "hex").toString("utf8").replace(/\0+$/g, "").trim();
      return text || null;
    }
    const length = Number(BigInt(`0x${body.slice(64, 128)}`));
    if (!Number.isFinite(length) || length < 0 || length > 256) return null;
    const text = Buffer.from(body.slice(128, 128 + length * 2), "hex").toString("utf8").replace(/\0+$/g, "").trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function readSymbols(addresses: readonly string[], rpc?: string): Promise<Map<string, string>> {
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const map = new Map<string, string>();
  try {
    const calls = unique.map((address) => ({ method: "eth_call", params: [{ to: address, data: SYMBOL_SELECTOR }, "latest"] }));
    const results = rpc ? await bscBatch(rpc, calls) : await bscBatchRotating(calls);
    unique.forEach((address, index) => {
      const symbol = decodeAbiString(results[index]);
      if (symbol) map.set(address, symbol);
    });
  } catch {
    return map;
  }
  return map;
}
