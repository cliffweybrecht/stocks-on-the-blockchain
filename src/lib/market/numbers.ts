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

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function compareNullableDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}
