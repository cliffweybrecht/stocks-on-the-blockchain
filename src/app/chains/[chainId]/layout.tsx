import type { ReactNode } from "react";
import { DeskVolumeRangeProvider } from "@/components/desk-volume-range";
import { loadEquityCardRangeMetrics } from "@/lib/market/equity-card-range-volume-file";

export const dynamic = "force-dynamic";

/**
 * One range for the volume toggle and the equity cards on every chain desk.
 * Volume totals and closing liquidity are read from the local snapshot file
 * before the page renders. The read does not write a tracked file.
 */
export default async function ChainDeskLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  const { volumes, liquidity } = await loadEquityCardRangeMetrics(chainId);
  return (
    <DeskVolumeRangeProvider volumes={volumes} liquidity={liquidity}>
      {children}
    </DeskVolumeRangeProvider>
  );
}
