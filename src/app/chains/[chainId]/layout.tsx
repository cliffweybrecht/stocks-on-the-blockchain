import type { ReactNode } from "react";
import { DeskVolumeRangeProvider } from "@/components/desk-volume-range";
import { loadEquityCardRangeVolumes } from "@/lib/market/equity-card-range-volume-file";

export const dynamic = "force-dynamic";

/**
 * One range for the volume toggle and the equity cards on every chain desk.
 * Totals are read from the local snapshot file before the page renders.
 */
export default async function ChainDeskLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ chainId: string }>;
}) {
  const { chainId } = await params;
  const volumes = await loadEquityCardRangeVolumes(chainId);
  return <DeskVolumeRangeProvider volumes={volumes}>{children}</DeskVolumeRangeProvider>;
}
