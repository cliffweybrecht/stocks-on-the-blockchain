/** Sum finite numbers; null if nothing reported. A reported 0 is a real 0. */
export function sumNullable(values: readonly (number | null | undefined)[]): number | null {
  let sum = 0;
  let any = false;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      any = true;
    }
  }
  return any ? sum : null;
}

export function maxNullable(values: readonly (number | null | undefined)[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      max = max === null ? value : Math.max(max, value);
    }
  }
  return max;
}

export function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Finite number from a JSON number or numeric string. Missing / NaN stays missing. */
export function asReportedNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Non-negative reported metric. Negatives are dropped, not clamped. */
export function asNonNegativeNumber(value: unknown): number | null {
  const parsed = asReportedNumber(value);
  if (parsed === null || parsed < 0) return null;
  return parsed;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Accept only http(s) URLs. Never invent or pass through javascript:/data: schemes. */
export function asHttpUrl(value: unknown): string | null {
  const raw = asNonEmptyString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Human token count from a raw base-unit integer.
 * Eight fractional digits are kept. A negative amount stays missing.
 */
export function tokenCountFromBaseUnits(raw: bigint, decimals: number): number | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (raw < BigInt(0)) return null;
  if (decimals === 0) {
    const whole = Number(raw);
    return Number.isFinite(whole) ? whole : null;
  }
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  const digits = BigInt(8);
  const fractionNumber = Number((fraction * BigInt(10) ** digits) / scale) / 1e8;
  const wholeNumber = Number(whole);
  if (!Number.isFinite(wholeNumber) || !Number.isFinite(fractionNumber)) return null;
  return wholeNumber + fractionNumber;
}

/**
 * Token count from a raw base-unit integer (bigint, safe integer, or all-digit string).
 * A decimal string is not a raw amount and stays missing.
 */
export function tokenCountFromRaw(amount: unknown, decimals: number): number | null {
  if (typeof amount === "bigint") return tokenCountFromBaseUnits(amount, decimals);
  if (typeof amount === "string" && /^\d+$/.test(amount.trim())) return tokenCountFromBaseUnits(BigInt(amount.trim()), decimals);
  if (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0) return tokenCountFromBaseUnits(BigInt(amount), decimals);
  return null;
}

export function compareNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
