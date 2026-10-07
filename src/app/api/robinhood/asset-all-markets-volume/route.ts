import { lookupRobinhoodChainAsset } from "@/lib/market/robinhood-chain-markets";
import { advanceRobinhoodAllMarkets, enrichRobinhoodAssetDetail } from "@/lib/market/robinhood-asset-series";
import { emptyAllMarketsVolumeSnapshot, type AssetAllMarketsVolumeSnapshot } from "@/lib/market/types";

export const dynamic = "force-dynamic";

const EMPTY: AssetAllMarketsVolumeSnapshot = emptyAllMarketsVolumeSnapshot();

export async function GET(request: Request) {
  const assetKey = new URL(request.url).searchParams.get("asset")?.trim() ?? "";
  if (!assetKey || assetKey.length > 80) {
    return Response.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const found = await lookupRobinhoodChainAsset(assetKey);
    if (!found) return Response.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
    const enriched = await enrichRobinhoodAssetDetail(found);
    const snapshot = await advanceRobinhoodAllMarkets(enriched.asset);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(EMPTY, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
