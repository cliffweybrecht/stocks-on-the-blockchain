import type { ReactNode } from "react";
import { DeskVolumeRangeProvider } from "@/components/desk-volume-range";
import { loadEquityCardRangeVolumes } from "@/lib/market/equity-card-range-volume-file";
import { loadOnchainMarketValueHistory } from "@/lib/market/onchain-market-value-file";

export const dynamic = "force-dynamic";

/**
 * One range for the volume toggle and the equity cards on every chain desk.
 * Volume totals and onchain market value are read from local snapshot files.
 * The read does not write a tracked file.
 */
export default async function ChainDeskLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  const [volumes, marketValue] = await Promise.all([
    loadEquityCardRangeVolumes(chainId),
    loadOnchainMarketValueHistory(chainId),
  ]);
  return (
    <DeskVolumeRangeProvider volumes={volumes} marketValue={marketValue} marketValueByChain={{ [chainId]: marketValue }}>
      {children}
    </DeskVolumeRangeProvider>
  );
}
