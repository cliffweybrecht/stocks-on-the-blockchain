const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

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
  if (value === 0) return "$0";
  return compactUsd.format(value);
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

export function formatChartClock(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return "";
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Token units as reported. Never derived from USD / price. */
export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function volumeShare(value: number | null, max: number | null): number {
  if (value === null || max === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}
