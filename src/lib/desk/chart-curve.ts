export const DESK_CHART_STROKE = "#B7FF3C";

export type ChartCurvePoint = { x: number; y: number };

function fmt(value: number): string {
  return value.toFixed(2);
}

/**
 * Fritsch–Carlson monotone cubic tangents.
 * The curve passes through every point and does not overshoot a segment's endpoints.
 */
function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const slope = new Array<number>(n).fill(0);
  if (n < 2) return slope;

  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1]! - xs[i]!;
    delta.push(dx === 0 ? 0 : (ys[i + 1]! - ys[i]!) / dx);
  }

  slope[0] = delta[0] ?? 0;
  slope[n - 1] = delta[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    const left = delta[i - 1] ?? 0;
    const right = delta[i] ?? 0;
    slope[i] = left * right <= 0 ? 0 : (left + right) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    const secant = delta[i] ?? 0;
    if (secant === 0) {
      slope[i] = 0;
      slope[i + 1] = 0;
      continue;
    }
    const a = slope[i]! / secant;
    const b = slope[i + 1]! / secant;
    const hypot = a * a + b * b;
    if (hypot > 9) {
      const tau = 3 / Math.sqrt(hypot);
      slope[i] = tau * a * secant;
      slope[i + 1] = tau * b * secant;
    }
  }

  return slope;
}

function curveCommands(xs: readonly number[], ys: readonly number[], slope: readonly number[]): string {
  let commands = "";
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i] ?? 0;
    const y0 = ys[i] ?? 0;
    const x1 = xs[i + 1] ?? x0;
    const y1 = ys[i + 1] ?? y0;
    const dx = x1 - x0;
    if (dx === 0) {
      commands += ` L ${fmt(x1)},${fmt(y1)}`;
      continue;
    }
    const c1x = x0 + dx / 3;
    const c1y = y0 + ((slope[i] ?? 0) * dx) / 3;
    const c2x = x1 - dx / 3;
    const c2y = y1 - ((slope[i + 1] ?? 0) * dx) / 3;
    commands += ` C ${fmt(c1x)},${fmt(c1y)} ${fmt(c2x)},${fmt(c2y)} ${fmt(x1)},${fmt(y1)}`;
  }
  return commands;
}

function usable(points: readonly ChartCurvePoint[]): ChartCurvePoint[] {
  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

/** Smooth line through the points. One point is a move with no segment. */
export function monotoneLinePath(points: readonly ChartCurvePoint[]): string {
  const rows = usable(points);
  if (rows.length === 0) return "";
  const xs = rows.map((point) => point.x);
  const ys = rows.map((point) => point.y);
  const start = `M ${fmt(xs[0] ?? 0)},${fmt(ys[0] ?? 0)}`;
  if (rows.length === 1) return start;
  return start + curveCommands(xs, ys, monotoneTangents(xs, ys));
}

/** Same curve, closed down to a horizontal baseline for the area fill. */
export function monotoneAreaPath(points: readonly ChartCurvePoint[], baselineY: number): string {
  const rows = usable(points);
  if (rows.length < 2 || !Number.isFinite(baselineY)) return "";
  const xs = rows.map((point) => point.x);
  const ys = rows.map((point) => point.y);
  const firstX = xs[0] ?? 0;
  const firstY = ys[0] ?? 0;
  const lastX = xs[xs.length - 1] ?? firstX;
  const commands = curveCommands(xs, ys, monotoneTangents(xs, ys));
  return `M ${fmt(firstX)},${fmt(baselineY)} L ${fmt(firstX)},${fmt(firstY)}${commands} L ${fmt(lastX)},${fmt(baselineY)} Z`;
}
