"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import type { EquityCardRangeVolumeMap } from "@/lib/market/equity-card-range-volume";

const EMPTY_RANGE_VOLUMES: EquityCardRangeVolumeMap = {};

interface DeskVolumeRangeValue {
  range: VolumeChartRangeId;
  setRange: (range: VolumeChartRangeId) => void;
  volumes: EquityCardRangeVolumeMap;
}

const DeskVolumeRangeContext = createContext<DeskVolumeRangeValue | null>(null);

/**
 * Shared desk toggle. The volume card and the equity grid are siblings, so the
 * chain layout holds the selected range and the precomputed closed-day totals.
 * Charts rendered outside this provider keep their own range state.
 */
export function DeskVolumeRangeProvider({
  volumes,
  children,
  initialRange = "7d",
}: {
  volumes: EquityCardRangeVolumeMap;
  children: ReactNode;
  initialRange?: VolumeChartRangeId;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const value = useMemo(() => ({ range, setRange, volumes }), [range, volumes]);
  return <DeskVolumeRangeContext.Provider value={value}>{children}</DeskVolumeRangeContext.Provider>;
}

/**
 * Inside the chain layout, the toggle and the cards share one range.
 * `initialRange` applies only when no provider is mounted (home chart, tests).
 */
export function useDeskVolumeRange(initialRange: VolumeChartRangeId = "7d"): DeskVolumeRangeValue {
  const shared = useContext(DeskVolumeRangeContext);
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  if (shared) return shared;
  return { range, setRange, volumes: EMPTY_RANGE_VOLUMES };
}
