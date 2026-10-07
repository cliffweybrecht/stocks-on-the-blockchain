import { lookupBnbChainAsset } from "@/lib/market/bnb-chain-markets";
import { advanceBnbAllMarkets, enrichBnbAssetDetail } from "@/lib/market/bnb-asset-series";
import { emptyAllMarketsVolumeSnapshot, type AssetAllMarketsVolumeSnapshot } from "@/lib/market/types";

export const dynamic = "force-dynamic";

const EMPTY: AssetAllMarketsVolumeSnapshot = emptyAllMarketsVolumeSnapshot();

export async function GET(request: Request) {
  const assetKey = new URL(request.url).searchParams.get("asset")?.trim() ?? "";
  if (!assetKey || assetKey.length > 80) {
    return Response.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const found = await lookupBnbChainAsset(assetKey);
    if (!found) return Response.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
    const enriched = await enrichBnbAssetDetail(found);
    const snapshot = await advanceBnbAllMarkets(enriched.asset);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(EMPTY, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
