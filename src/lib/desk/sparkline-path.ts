import type { VolumeHistoryPoint } from "../market/types";

export const SPARKLINE_WIDTH = 240;
export const SPARKLINE_HEIGHT = 56;
export const SPARKLINE_PAD_X = 2;
export const SPARKLINE_PAD_Y = 6;

export function sparklineGeometryFromValues(
  values: readonly number[],
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
): {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
} | null {
  if (values.length < 2) return null;
  if (values.some((value) => !Number.isFinite(value))) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = width - SPARKLINE_PAD_X * 2;
  const innerH = height - SPARKLINE_PAD_Y * 2;
  const step = innerW / (values.length - 1);
  const coords = values.map((value, index) => {
    const x = SPARKLINE_PAD_X + index * step;
    const y = SPARKLINE_PAD_Y + innerH - ((value - min) / span) * innerH;
    return { x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const last = coords[coords.length - 1];
  if (!last) return null;
  const area = `${line} L ${last.x.toFixed(2)} ${height} L ${SPARKLINE_PAD_X.toFixed(2)} ${height} Z`;
  return { line, area, lastX: last.x, lastY: last.y };
}

export function sparklineGeometry(points: readonly VolumeHistoryPoint[]): {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
} | null {
  return sparklineGeometryFromValues(points.map((point) => point.volumeUsd));
}
