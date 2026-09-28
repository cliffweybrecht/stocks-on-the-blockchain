import { asNonEmptyString } from "./numbers";
import type { FetchLike } from "./solana-http";

/** Public Solana RPC. Override with SOLANA_RPC_URL when a proxy is required. */
export const DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

/**
 * Plain decimal UI amount. Rejects blanks, signs, exponents, and thousands separators
 * so a malformed RPC field cannot become a supply.
 */
const UI_AMOUNT_STRING = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export interface MintValuationFields {
  dexMedianPriceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
}

export interface SupplyValuation {
  circulatingSupply: number | null;
  totalSupply: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
}

/** Finite supply ≥ 0. Null, NaN, and negatives stay missing — they are not coerced to 0. */
export function nonNegativeSupply(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function positivePrice(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Price × supply. Either side missing, or a non-finite product, stays missing. */
export function priceTimesSupply(priceUsd: number | null | undefined, supply: number | null | undefined): number | null {
  const price = positivePrice(priceUsd);
  const units = nonNegativeSupply(supply);
  if (price === null || units === null) return null;
  const product = price * units;
  return Number.isFinite(product) ? product : null;
}

/**
 * Market cap is price × circulating supply. FDV is price × total supply.
 * Liquidity, volume, and any aggregator cap are not inputs.
 */
export function valuationFromSupply(input: {
  priceUsd: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
}): SupplyValuation {
  const circulatingSupply = nonNegativeSupply(input.circulatingSupply);
  const totalSupply = nonNegativeSupply(input.totalSupply);
  return {
    circulatingSupply,
    totalSupply,
    marketCapUsd: priceTimesSupply(input.priceUsd, circulatingSupply),
    fdvUsd: priceTimesSupply(input.priceUsd, totalSupply),
  };
}

export function parseUiAmountString(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!UI_AMOUNT_STRING.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return nonNegativeSupply(parsed);
}

/**
 * `getTokenSupply` value. Prefer `uiAmountString` — it is the human supply the RPC
 * already scaled (Token-2022 scaled UI multiplier included). Do not recompute
 * `amount / 10^decimals`: that drops the multiplier, and DEX prices quote the UI unit.
 * If the string is present but unreadable, do not fall back to raw fields.
 * `uiAmount` is used only when the string was omitted.
 */
export function parseGetTokenSupply(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const result = (payload as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const value = (result as { value?: unknown }).value;
  if (!value || typeof value !== "object") return null;
  const row = value as { uiAmountString?: unknown; uiAmount?: unknown };
  if (row.uiAmountString !== undefined && row.uiAmountString !== null) {
    return parseUiAmountString(row.uiAmountString);
  }
  return nonNegativeSupply(typeof row.uiAmount === "number" ? row.uiAmount : null);
}

/**
 * One outstanding mint supply fills both circulating and total.
 * An SPL mint has no unminted max above `getTokenSupply`, and this desk has no
 * lockup indexer. xStocks report the same number for both (Jupiter circ = total =
 * UI supply). Callers that later learn a smaller float can pass the two supplies
 * separately to `valuationFromSupply`.
 */
export function applyOutstandingMintSupply<T extends MintValuationFields>(asset: T, mintUiSupply: number | null): T {
  const valuation = valuationFromSupply({
    priceUsd: asset.dexMedianPriceUsd,
    circulatingSupply: mintUiSupply,
    totalSupply: mintUiSupply,
  });
  return {
    ...asset,
    circulatingSupply: valuation.circulatingSupply,
    totalSupply: valuation.totalSupply,
    marketCapUsd: valuation.marketCapUsd,
    fdvUsd: valuation.fdvUsd,
  };
}

export async function fetchMintUiSupply(
  mint: string,
  options: { rpcUrl: string; timeoutMs: number; fetchImpl: FetchLike },
): Promise<number | null> {
  const address = asNonEmptyString(mint);
  if (!address) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetchImpl(options.rpcUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "user-agent": "stocks-on-the-blockchain/0.1",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenSupply",
        params: [address],
      }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as unknown;
    return parseGetTokenSupply(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
