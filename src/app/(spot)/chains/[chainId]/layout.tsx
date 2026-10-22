import type { ReactNode } from "react";
import { DeskVolumeRangeProvider } from "@/components/desk-volume-range";
import { loadEquityCardRangeMetrics } from "@/lib/market/equity-card-range-volume-file";
import { loadOnchainMarketValueHistory } from "@/lib/market/onchain-market-value-file";

export const revalidate = 3600;

/**
 * One range for the volume toggle and the equity cards on every chain desk.
 * Volume totals, closing liquidity, captured closes, and supply × price are
 * read from local snapshot files before the page renders. The read does not write a file.
 */
export default async function ChainDeskLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  const [{ volumes, liquidity, volumeSeries, prices }, marketValue] = await Promise.all([
    loadEquityCardRangeMetrics(chainId),
    loadOnchainMarketValueHistory(chainId),
  ]);
  return (
    <DeskVolumeRangeProvider
      volumes={volumes}
      liquidity={liquidity}
      volumeSeries={volumeSeries}
      prices={prices}
      marketValue={marketValue}
      marketValueByChain={{ [chainId]: marketValue }}
    >
      {children}
    </DeskVolumeRangeProvider>
  );
}
