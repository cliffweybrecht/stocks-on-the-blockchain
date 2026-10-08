import { overlayHistoryWithSolanaAssetBackfill } from "@/lib/market/asset-backfill-desk-file";
import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

/**
 * 7D/14D/30D chart revalidate.
 * Closed Eastern days come from `solana.json`. Days with no nightly row are
 * summed from the local `solana-asset-daily.json` file. No DexScreener, no
 * write, no `solana-hourly.json`. The in-progress America/New_York day stays
 * off the series until that date has closed.
 */
export async function GET() {
  try {
    const source = createMarketDataSource();
    const history = await overlayHistoryWithSolanaAssetBackfill(await source.getClosedDeskVolumeHistory());
    return Response.json({ history }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { history: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
