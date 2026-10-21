import { DATE_AXIS_LABEL_BASELINE } from "@/lib/desk/date-axis";

/**
 * Closed-day labels on one row. Callers pass the ticks chosen by
 * selectDateAxisLabelTicks. 24H clock labels can use this too; they already
 * sit on one row and this does not thin them.
 */
export function DateAxisLabels({
  ticks,
  x,
  chartHeight,
  label,
  tickAttr = "data-date-axis-tick",
}: {
  ticks: readonly number[];
  x: (unixSeconds: number) => number;
  chartHeight: number;
  label: (unixSeconds: number) => string;
  /** Extra attribute so existing chart tests can read the same labels. */
  tickAttr?: string;
}) {
  const y = chartHeight - DATE_AXIS_LABEL_BASELINE;
  return ticks.map((tick, index) => {
    const text = label(tick);
    return (
      <text
        key={`${tick}-${index}`}
        x={x(tick)}
        y={y}
        textAnchor="middle"
        className="fill-muted-foreground"
        fontSize="10"
        data-date-axis-tick={text}
        {...{ [tickAttr]: text }}
      >
        {text}
      </text>
    );
  });
}
