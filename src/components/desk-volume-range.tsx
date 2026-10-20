"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import {
  EMPTY_EQUITY_CARD_LIQUIDITY,
  type EquityCardLiquidityHistory,
} from "@/lib/market/equity-card-range-liquidity";
import type { EquityCardRangeVolumeMap } from "@/lib/market/equity-card-range-volume";
import { EMPTY_ONCHAIN_MARKET_VALUE, type OnchainMarketValueHistory } from "@/lib/market/onchain-market-value";

const EMPTY_RANGE_VOLUMES: EquityCardRangeVolumeMap = {};
const EMPTY_BY_CHAIN: Record<string, OnchainMarketValueHistory> = {};

interface DeskVolumeRangeValue {
  range: VolumeChartRangeId;
  setRange: (range: VolumeChartRangeId) => void;
  volumes: EquityCardRangeVolumeMap;
  liquidity: EquityCardLiquidityHistory;
  /** Chain headline series. Home passes the combined history. */
  marketValue: OnchainMarketValueHistory;
  /** Per desk chain id. Home uses this for the Market value column. */
  marketValueByChain: Record<string, OnchainMarketValueHistory>;
}

const DeskVolumeRangeContext = createContext<DeskVolumeRangeValue | null>(null);

/**
 * Shared desk toggle. The volume card and the equity grid are siblings, so the
 * chain layout holds the selected range and the precomputed closed-day totals.
 * Charts rendered outside this provider keep their own range state.
 */
export function DeskVolumeRangeProvider({
  volumes,
  liquidity = EMPTY_EQUITY_CARD_LIQUIDITY,
  marketValue = EMPTY_ONCHAIN_MARKET_VALUE,
  marketValueByChain = EMPTY_BY_CHAIN,
  children,
  initialRange = "7d",
}: {
  volumes: EquityCardRangeVolumeMap;
  /** Closing reserves from nightly per-asset rows. Empty on desks that have none. */
  liquidity?: EquityCardLiquidityHistory;
  marketValue?: OnchainMarketValueHistory;
  marketValueByChain?: Record<string, OnchainMarketValueHistory>;
  children: ReactNode;
  initialRange?: VolumeChartRangeId;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const value = useMemo(
    () => ({ range, setRange, volumes, liquidity, marketValue, marketValueByChain }),
    [range, volumes, liquidity, marketValue, marketValueByChain],
  );
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
  return {
    range,
    setRange,
    volumes: EMPTY_RANGE_VOLUMES,
    liquidity: EMPTY_EQUITY_CARD_LIQUIDITY,
    marketValue: EMPTY_ONCHAIN_MARKET_VALUE,
    marketValueByChain: EMPTY_BY_CHAIN,
  };
}
