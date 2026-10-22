"use client";

import type { AssetSortKey } from "@/lib/market/aggregate";
import { isMarketValueHidden } from "@/lib/site/visibility";

export type HeadlineMetric = "volume" | "market-value" | "liquidity";

/** Card sort that follows the headline switch. */
export function headlineMetricSortKey(metric: HeadlineMetric): AssetSortKey {
  if (metric === "liquidity") return "displayedLiquidityUsd";
  if (metric === "market-value") return "marketValueUsd";
  return "volume24hUsd";
}

/**
 * Compact Volume | Market value | Liquidity control.
 * `marketvalue` in NEXT_PUBLIC_HIDE_SECTIONS leaves Volume | Liquidity.
 */
export function HeadlineMetricToggle({
  metric,
  onChange,
}: {
  metric: HeadlineMetric;
  onChange: (metric: HeadlineMetric) => void;
}) {
  const hideMarket = isMarketValueHidden();
  const options: ReadonlyArray<readonly [HeadlineMetric, string]> = hideMarket
    ? [
        ["volume", "Volume"],
        ["liquidity", "Liquidity"],
      ]
    : [
        ["volume", "Volume"],
        ["market-value", "Market value"],
        ["liquidity", "Liquidity"],
      ];
  const selected = hideMarket && metric === "market-value" ? "volume" : metric;
  return (
    <div
      className="mb-2 inline-flex items-center rounded-full bg-white/5 p-0.5"
      role="group"
      aria-label="Headline metric"
      data-headline-metric-toggle
    >
      {options.map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-headline-metric={id}
          aria-pressed={selected === id}
          onClick={() => onChange(id)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
            selected === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
