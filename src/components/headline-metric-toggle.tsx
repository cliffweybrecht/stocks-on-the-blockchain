"use client";

export type HeadlineMetric = "volume" | "market-value";

/** Compact Volume | Market value control. It sits on the left of the headline card. */
export function HeadlineMetricToggle({
  metric,
  onChange,
}: {
  metric: HeadlineMetric;
  onChange: (metric: HeadlineMetric) => void;
}) {
  return (
    <div
      className="mb-2 inline-flex items-center rounded-full bg-white/5 p-0.5"
      role="group"
      aria-label="Headline metric"
      data-headline-metric-toggle
    >
      {(
        [
          ["volume", "Volume"],
          ["market-value", "Market value"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-headline-metric={id}
          aria-pressed={metric === id}
          onClick={() => onChange(id)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${
            metric === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
