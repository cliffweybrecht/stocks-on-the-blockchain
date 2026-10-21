"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { HeadlineMetric } from "@/components/headline-metric-toggle";
import type { VolumeChartRangeId } from "@/lib/market/daily-volume-view";
import {
  EMPTY_EQUITY_CARD_LIQUIDITY,
  type EquityCardLiquidityHistory,
} from "@/lib/market/equity-card-range-liquidity";
import { EMPTY_EQUITY_CARD_PRICE, type EquityCardPriceHistory } from "@/lib/market/equity-card-range-price";
import {
  EMPTY_EQUITY_CARD_VOLUME_SERIES,
  type EquityCardRangeVolumeMap,
  type EquityCardVolumeHistory,
} from "@/lib/market/equity-card-range-volume";
import { EMPTY_ONCHAIN_MARKET_VALUE, type OnchainMarketValueHistory } from "@/lib/market/onchain-market-value";

const EMPTY_RANGE_VOLUMES: EquityCardRangeVolumeMap = {};
const EMPTY_BY_CHAIN: Record<string, OnchainMarketValueHistory> = {};

interface DeskVolumeRangeValue {
  range: VolumeChartRangeId;
  setRange: (range: VolumeChartRangeId) => void;
  volumes: EquityCardRangeVolumeMap;
  liquidity: EquityCardLiquidityHistory;
  /** Daily volume points for the card sparkline. */
  volumeSeries: EquityCardVolumeHistory;
  /** Captured DEX closes for the card price and range move. */
  prices: EquityCardPriceHistory;
  /** Chain headline series. Home passes the combined history. */
  marketValue: OnchainMarketValueHistory;
  /** Per desk chain id. Home uses this for the Market value column. */
  marketValueByChain: Record<string, OnchainMarketValueHistory>;
  /** Volume, market value, or liquidity. Shared by the chart and the cards. */
  metric: HeadlineMetric;
  setMetric: (metric: HeadlineMetric) => void;
  /** True when the chart and the cards share one switch. */
  headlineShared: boolean;
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
  volumeSeries = EMPTY_EQUITY_CARD_VOLUME_SERIES,
  prices = EMPTY_EQUITY_CARD_PRICE,
  marketValue = EMPTY_ONCHAIN_MARKET_VALUE,
  marketValueByChain = EMPTY_BY_CHAIN,
  children,
  initialRange = "7d",
  initialMetric = "volume",
}: {
  volumes: EquityCardRangeVolumeMap;
  /** Closing reserves from nightly per-asset rows. Empty on desks that have none. */
  liquidity?: EquityCardLiquidityHistory;
  volumeSeries?: EquityCardVolumeHistory;
  prices?: EquityCardPriceHistory;
  marketValue?: OnchainMarketValueHistory;
  marketValueByChain?: Record<string, OnchainMarketValueHistory>;
  children: ReactNode;
  initialRange?: VolumeChartRangeId;
  initialMetric?: HeadlineMetric;
}) {
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const [metric, setMetric] = useState<HeadlineMetric>(initialMetric);
  const value = useMemo(
    () => ({
      range,
      setRange,
      volumes,
      liquidity,
      volumeSeries,
      prices,
      marketValue,
      marketValueByChain,
      metric,
      setMetric,
      headlineShared: true,
    }),
    [range, volumes, liquidity, volumeSeries, prices, marketValue, marketValueByChain, metric],
  );
  return <DeskVolumeRangeContext.Provider value={value}>{children}</DeskVolumeRangeContext.Provider>;
}

/**
 * Inside the chain layout, the toggle and the cards share one range.
 * `initialRange` applies only when no provider is mounted (home chart, tests).
 */
export function useDeskVolumeRange(
  initialRange: VolumeChartRangeId = "7d",
  initialMetric: HeadlineMetric = "volume",
): DeskVolumeRangeValue {
  const shared = useContext(DeskVolumeRangeContext);
  const [range, setRange] = useState<VolumeChartRangeId>(initialRange);
  const [metric, setMetric] = useState<HeadlineMetric>(initialMetric);
  if (shared) return shared;
  return {
    range,
    setRange,
    volumes: EMPTY_RANGE_VOLUMES,
    liquidity: EMPTY_EQUITY_CARD_LIQUIDITY,
    volumeSeries: EMPTY_EQUITY_CARD_VOLUME_SERIES,
    prices: EMPTY_EQUITY_CARD_PRICE,
    marketValue: EMPTY_ONCHAIN_MARKET_VALUE,
    marketValueByChain: EMPTY_BY_CHAIN,
    metric,
    setMetric,
    headlineShared: false,
  };
}
