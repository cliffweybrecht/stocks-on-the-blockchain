import { useId } from "react";
import { sparklineGeometryFromValues } from "@/lib/desk/sparkline-path";
import { volumeSparklineDirection, type VolumeSparklineDirection } from "@/lib/market/volume-history";
import type { VolumeHistoryPoint } from "@/lib/market/types";

const DIRECTION_COLOR: Record<VolumeSparklineDirection, string> = {
  up: "#22c55e",
  down: "#ef4444",
  flat: "#737373",
};

const CARD = { width: 104, height: 32, className: "h-8 w-[104px]", stroke: 1.7, dot: 2.1 } as const;

export function VolumeSparkline({
  points,
  label,
}: {
  points: readonly VolumeHistoryPoint[];
  label?: string;
}) {
  const glowId = `vol-spark-${useId().replace(/:/g, "")}`;
  const direction = volumeSparklineDirection(points);
  const geometry = sparklineGeometryFromValues(
    points.map((point) => point.volumeUsd),
    CARD.width,
    CARD.height,
  );
  if (!direction || !geometry) return null;

  const color = DIRECTION_COLOR[direction];

  return (
    <svg
      viewBox={`0 0 ${CARD.width} ${CARD.height}`}
      preserveAspectRatio="none"
      className={CARD.className}
      role="img"
      aria-label={label ?? `24h volume trend ${direction}`}
    >
      <defs>
        <linearGradient id={glowId} x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={geometry.area} fill={`url(#${glowId})`} />
      <path
        d={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth={CARD.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={geometry.lastX} cy={geometry.lastY} r={CARD.dot} fill={color} />
    </svg>
  );
}
