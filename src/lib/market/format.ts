/**
 * Compact USD without Intl. Node and Chrome disagree on trailing zeros
 * (`$9.0M` vs `$9M`), which breaks hydration in client components.
 * One decimal at every scale, including a trailing zero, matches the
 * previous Node compact output.
 */
function formatStableUsd(value: number): string {
  if (value === 0) return "$0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const units: readonly [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [unit, suffix] of units) {
    if (abs >= unit) return `${sign}$${(abs / unit).toFixed(1)}${suffix}`;
  }
  return `${sign}$${abs.toFixed(1)}`;
}

const fullUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const priceUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatUsdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return formatStableUsd(value);
}

export function formatUsdFull(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return fullUsd.format(value);
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return priceUsd.format(value);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return integer.format(value);
}

const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/** Compact count for Markets-style tables. Missing stays a dash — never coerced to 0. */
export function formatCountCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return compactCount.format(value);
  return integer.format(value);
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatAddress(address: string | null | undefined): string {
  if (!address) return "—";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const TOKEN_AGE_MINUTE_MS = 60_000;
const TOKEN_AGE_HOUR_MS = 60 * TOKEN_AGE_MINUTE_MS;
const TOKEN_AGE_DAY_MS = 24 * TOKEN_AGE_HOUR_MS;
/** Compact months are 30-day units. This is a label, not a calendar date. */
const TOKEN_AGE_MONTH_MS = 30 * TOKEN_AGE_DAY_MS;
const TOKEN_AGE_YEAR_MS = 365 * TOKEN_AGE_DAY_MS;

/**
 * Compact age from a pair creation timestamp.
 * Floors into one unit (45m, 5h, 3d, 2mo, 1y). A missing or future timestamp stays a dash.
 * A clock skew of under a minute still reads as under a minute.
 */
export function formatTokenAge(createdAtMs: number | null | undefined, nowMs: number): string {
  if (typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs)) return "—";
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return "—";
  const ageMs = nowMs - createdAtMs;
  if (ageMs < -TOKEN_AGE_MINUTE_MS) return "—";
  if (ageMs < TOKEN_AGE_MINUTE_MS) return "<1m";
  if (ageMs < TOKEN_AGE_HOUR_MS) return `${Math.floor(ageMs / TOKEN_AGE_MINUTE_MS)}m`;
  if (ageMs < TOKEN_AGE_DAY_MS) return `${Math.floor(ageMs / TOKEN_AGE_HOUR_MS)}h`;
  if (ageMs < TOKEN_AGE_MONTH_MS) return `${Math.floor(ageMs / TOKEN_AGE_DAY_MS)}d`;
  if (ageMs < TOKEN_AGE_YEAR_MS) return `${Math.floor(ageMs / TOKEN_AGE_MONTH_MS)}mo`;
  return `${Math.floor(ageMs / TOKEN_AGE_YEAR_MS)}y`;
}

/** Age as of this render. The clock read stays outside the React component. */
export function formatTokenAgeNow(createdAtMs: number | null | undefined): string {
  return formatTokenAge(createdAtMs, Date.now());
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 90) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)} min`;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const deltaSec = Math.round((Date.now() - then) / 1000);
  if (Math.abs(deltaSec) < 10) return "just now";
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(-Math.sign(deltaSec) * abs, "second");
  if (abs < 3600) return rtf.format(-Math.sign(deltaSec) * Math.round(abs / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.sign(deltaSec) * Math.round(abs / 3600), "hour");
  return rtf.format(-Math.sign(deltaSec) * Math.round(abs / 86400), "day");
}

export function formatChartDate(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "—";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatChartTick(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function formatChartDay(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * 24H asset-chart clock. The unix instant is unchanged; the label is the
 * America/New_York wall time (EDT or EST). Calendar-day axes stay on
 * formatChartDay, which labels the UTC day key of that Eastern date.
 */
export function formatChartClock(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** Token units as reported. Never derived from USD / price. */
/** Token count. Compact from 1,000 up, trailing zeros stripped. Missing stays a dash. */
export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs === 0) return "0";
  const units: readonly [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [unit, suffix] of units) {
    if (abs >= unit) return `${sign}${(abs / unit).toFixed(2).replace(/\.?0+$/, "")}${suffix}`;
  }
  if (abs >= 100) return `${sign}${abs.toFixed(0)}`;
  return `${sign}${abs.toFixed(2).replace(/\.?0+$/, "")}`;
}

export function volumeShare(value: number | null, max: number | null): number {
  if (value === null || max === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
