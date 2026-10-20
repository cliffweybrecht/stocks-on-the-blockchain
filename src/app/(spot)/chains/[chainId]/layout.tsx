import type { ReactNode } from "react";
import { DeskVolumeRangeProvider } from "@/components/desk-volume-range";
import { loadEquityCardRangeMetrics } from "@/lib/market/equity-card-range-volume-file";
import { loadOnchainMarketValueHistory } from "@/lib/market/onchain-market-value-file";

export const revalidate = 3600;

/**
 * One range for the volume toggle and the equity cards on every chain desk.
 * Volume totals, closing liquidity, and captured supply × price are read from
 * local snapshot files before the page renders. The read does not write a file.
 */
export default async function ChainDeskLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  const [{ volumes, liquidity }, marketValue] = await Promise.all([
    loadEquityCardRangeMetrics(chainId),
    loadOnchainMarketValueHistory(chainId),
  ]);
  return (
    <DeskVolumeRangeProvider
      volumes={volumes}
      liquidity={liquidity}
      marketValue={marketValue}
      marketValueByChain={{ [chainId]: marketValue }}
    >
      {children}
    </DeskVolumeRangeProvider>
  );
}
