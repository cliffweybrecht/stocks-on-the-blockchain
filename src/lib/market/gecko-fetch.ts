/**
 * Shared GeckoTerminal fetch for the nightly closed-day writers.
 *
 * The public API allows 30 requests per minute. Calls are spaced at 2.1s
 * (about 28 per minute). HTTP 429, 5xx, timeouts, and network errors retry
 * with exponential backoff and jitter. A 404 is final. DexScreener h24 is
 * only a fallback after retries are exhausted.
 */

export const GECKO_MIN_INTERVAL_MS = 2100;
export const GECKO_MAX_ATTEMPTS = 6;
export const GECKO_TIMEOUT_MS = 30_000;
export const GECKO_BACKOFF_BASE_MS = 1000;
export const GECKO_BACKOFF_CAP_MS = 60_000;
/** Map value wrapper so a later day can skip a terminal miss without pacing. */
export const GECKO_CACHED_FAILURE = "__geckoCachedFailure";

export interface GeckoPace {
  nextAt: number;
}

export type GeckoFetchSuccess = { ok: true; body: unknown; attempts: number; status: number };
export type GeckoFetchFailure = {
  ok: false;
  reason: "not-found" | "retries-exhausted" | "http-error";
  status: number | null;
  attempts: number;
};
export type GeckoFetchResult = GeckoFetchSuccess | GeckoFetchFailure;

export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, GECKO_BACKOFF_CAP_MS);
}

function backoffMs(attempt: number, randomFn: () => number, retryAfter: number | null): number {
  const exp = Math.min(GECKO_BACKOFF_CAP_MS, GECKO_BACKOFF_BASE_MS * 2 ** attempt);
  const jitter = randomFn() * GECKO_BACKOFF_BASE_MS;
  const delay = exp + jitter;
  return retryAfter === null ? delay : Math.max(delay, retryAfter);
}

export async function fetchGeckoJson(input: {
  url: string;
  fetchImpl: typeof fetch;
  pace: GeckoPace;
  cache?: Map<string, unknown>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  maxAttempts?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
}): Promise<GeckoFetchResult> {
  const cached = readGeckoCache(input.cache?.get(input.url));
  if (cached) return cached;

  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const randomFn = input.random ?? Math.random;
  const maxAttempts = input.maxAttempts ?? GECKO_MAX_ATTEMPTS;
  const minIntervalMs = input.minIntervalMs ?? GECKO_MIN_INTERVAL_MS;
  const timeoutMs = input.timeoutMs ?? GECKO_TIMEOUT_MS;
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const wait = input.pace.nextAt - now();
    if (wait > 0) await sleep(wait);
    input.pace.nextAt = now() + minIntervalMs;
    try {
      const response = await input.fetchImpl(input.url, { signal: AbortSignal.timeout(timeoutMs) });
      const status = response.status;
      if (status === 404) {
        return rememberGeckoFailure(input.cache, input.url, {
          ok: false,
          reason: "not-found",
          status,
          attempts: attempt + 1,
        });
      }
      if (status === 429 || status >= 500) {
        lastStatus = status;
        if (attempt + 1 < maxAttempts) {
          const retryAfter = retryAfterMs(response.headers.get("retry-after"));
          const delay = backoffMs(attempt, randomFn, retryAfter);
          await sleep(delay);
          input.pace.nextAt = Math.max(input.pace.nextAt, now() + minIntervalMs);
          continue;
        }
        return rememberGeckoFailure(input.cache, input.url, {
          ok: false,
          reason: "retries-exhausted",
          status,
          attempts: attempt + 1,
        });
      }
      if (!response.ok) {
        return rememberGeckoFailure(input.cache, input.url, {
          ok: false,
          reason: "http-error",
          status,
          attempts: attempt + 1,
        });
      }
      const body = await response.json();
      input.cache?.set(input.url, body);
      return { ok: true, body, attempts: attempt + 1, status };
    } catch {
      lastStatus = null;
      if (attempt + 1 < maxAttempts) {
        const delay = backoffMs(attempt, randomFn, null);
        await sleep(delay);
        input.pace.nextAt = Math.max(input.pace.nextAt, now() + minIntervalMs);
        continue;
      }
      return rememberGeckoFailure(input.cache, input.url, {
        ok: false,
        reason: "retries-exhausted",
        status: lastStatus,
        attempts: attempt + 1,
      });
    }
  }
  return rememberGeckoFailure(input.cache, input.url, {
    ok: false,
    reason: "retries-exhausted",
    status: lastStatus,
    attempts: maxAttempts,
  });
}

function readGeckoCache(cached: unknown): GeckoFetchResult | null {
  if (cached === undefined) return null;
  if (cached && typeof cached === "object" && GECKO_CACHED_FAILURE in cached) {
    return (cached as { [GECKO_CACHED_FAILURE]: GeckoFetchFailure })[GECKO_CACHED_FAILURE];
  }
  return { ok: true, body: cached, attempts: 0, status: 200 };
}

function rememberGeckoFailure(
  cache: Map<string, unknown> | undefined,
  url: string,
  failure: GeckoFetchFailure,
): GeckoFetchFailure {
  cache?.set(url, { [GECKO_CACHED_FAILURE]: failure });
  return failure;
}
