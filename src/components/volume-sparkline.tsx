import { useId } from "react";
import { sparklineGeometry, SPARKLINE_HEIGHT, SPARKLINE_WIDTH } from "@/lib/desk/sparkline-path";
import type { VolumeHistoryPoint } from "@/lib/market/types";
import { volumeSparklineDirection, type VolumeSparklineDirection } from "@/lib/market/volume-history";

const DIRECTION_COLOR: Record<VolumeSparklineDirection, string> = {
  up: "#22c55e",
  down: "#ef4444",
  flat: "#737373",
};

export function VolumeSparkline({
  points,
  label,
}: {
  points: readonly VolumeHistoryPoint[];
  label?: string;
}) {
  const glowId = `spark-glow-${useId().replace(/:/g, "")}`;
  const direction = volumeSparklineDirection(points);
  const geometry = sparklineGeometry(points);
  if (!direction || !geometry) return null;

  const color = DIRECTION_COLOR[direction];

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-14 w-full"
      role="img"
      aria-label={label ?? `Week volume trend ${direction}`}
    >
      <defs>
        <linearGradient id={glowId} x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="70%" stopColor={color} stopOpacity="0.08" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geometry.area} fill={`url(#${glowId})`} />
      <path
        d={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={geometry.lastX} cy={geometry.lastY} r="3.2" fill={color} />
    </svg>
  );
}
