import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const source = createMarketDataSource();
    const snapshot = await source.getEquityCardDayVolumeSeriesSnapshot();
    return Response.json(snapshot, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ series: {}, pending: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
