import { sleep } from "./async-pool";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFINITIVE_MISS_STATUS = new Set([400, 404, 410, 422]);

export class SourceRequestError extends Error {
  readonly status: number | null;
  readonly retryAfterHeader: string | null;

  constructor(message: string, status: number | null, retryAfterHeader: string | null) {
    super(message);
    this.name = "SourceRequestError";
    this.status = status;
    this.retryAfterHeader = retryAfterHeader;
  }
}

export function responseStatusFromError(error: unknown): number | null {
  if (error instanceof SourceRequestError && error.status !== null) return error.status;
  if (!(error instanceof Error)) return null;
  const match = error.message.match(/ (\d{3})$/);
  return match ? Number(match[1]) : null;
}

/** Pool is gone or the path is rejected. Not a rate-limit miss to retry later. */
export function isDefinitiveFetchMiss(error: unknown): boolean {
  const status = responseStatusFromError(error);
  return status !== null && DEFINITIVE_MISS_STATUS.has(status);
}

function errorStatus(error: Error): number | null {
  return responseStatusFromError(error);
}

export async function fetchJsonOrText(
  url: string,
  timeoutMs: number,
  fetchImpl: FetchLike,
  sourceLabel: string,
  retries = 2,
): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json, text/plain",
          "user-agent": "stocks-on-the-blockchain/0.1",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        const error = new SourceRequestError(
          `${sourceLabel} ${response.status}`,
          response.status,
          response.headers.get("retry-after"),
        );
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = error;
          const retryAfter = Number(response.headers.get("retry-after"));
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
          await sleep(waitMs);
          continue;
        }
        throw error;
      }
      const text = await response.text();
      const trimmed = text.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return JSON.parse(trimmed) as unknown;
      }
      return text;
    } catch (error) {
      const wrapped =
        error instanceof Error && error.name === "AbortError"
          ? new Error(`${sourceLabel} timed out after ${Math.round(timeoutMs / 1000)}s.`)
          : error instanceof Error
            ? error
            : new Error(`${sourceLabel} failed.`);
      const status = errorStatus(wrapped);
      if (status !== null && !RETRYABLE_STATUS.has(status)) {
        throw wrapped;
      }
      lastError = wrapped;
      if (attempt < retries) {
        await sleep(400 * 2 ** attempt);
        continue;
      }
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`${sourceLabel} failed.`);
}
