import { sleep } from "./async-pool";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function errorStatus(error: Error): number | null {
  const match = error.message.match(/ (\d{3})$/);
  return match ? Number(match[1]) : null;
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
        const error = new Error(`${sourceLabel} ${response.status}`);
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
