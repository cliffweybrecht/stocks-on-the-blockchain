import type { VolumeHistoryPoint } from "../market/types";

export const SPARKLINE_WIDTH = 240;
export const SPARKLINE_HEIGHT = 56;
export const SPARKLINE_PAD_X = 2;
export const SPARKLINE_PAD_Y = 6;

export function sparklineGeometry(points: readonly VolumeHistoryPoint[]): {
  line: string;
  area: string;
  lastX: number;
  lastY: number;
} | null {
  if (points.length < 2) return null;
  const values = points.map((point) => point.volumeUsd);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = SPARKLINE_WIDTH - SPARKLINE_PAD_X * 2;
  const innerH = SPARKLINE_HEIGHT - SPARKLINE_PAD_Y * 2;
  const step = innerW / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = SPARKLINE_PAD_X + index * step;
    const y = SPARKLINE_PAD_Y + innerH - ((point.volumeUsd - min) / span) * innerH;
    return { x, y };
  });
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const last = coords[coords.length - 1];
  if (!last) return null;
  const area = `${line} L ${last.x.toFixed(2)} ${SPARKLINE_HEIGHT} L ${SPARKLINE_PAD_X.toFixed(2)} ${SPARKLINE_HEIGHT} Z`;
  return { line, area, lastX: last.x, lastY: last.y };
}
