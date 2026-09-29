import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

/**
 * Starts the detail-page work before navigation finishes.
 * The response is empty. Holder, supply, and Gecko calls stay on the shared source
 * so the asset route joins them instead of starting a second waterfall.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim() ?? "";
  if (!symbol || symbol.length > 64) {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  const source = createMarketDataSource();
  await Promise.allSettled([
    source.getAsset("solana", symbol),
    source.getAssetPriceHistory("solana", symbol),
  ]);
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
