import { createMarketDataSource } from "@/lib/market/factory";
import { emptyAllMarketsVolumeSnapshot, type AssetAllMarketsVolumeSnapshot } from "@/lib/market/types";

export const dynamic = "force-dynamic";

const EMPTY: AssetAllMarketsVolumeSnapshot = emptyAllMarketsVolumeSnapshot();

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  if (!symbol || symbol.length > 32) {
    return Response.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const source = createMarketDataSource();
    const snapshot = await source.getAssetAllMarketsVolumeSnapshot("solana", symbol);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(EMPTY, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
