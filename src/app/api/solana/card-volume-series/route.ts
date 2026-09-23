import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const source = createMarketDataSource();
    const series = await source.getEquityCardDayVolumeSeries();
    return Response.json(
      { series },
      {
        headers: {
          "Cache-Control": "private, max-age=30",
        },
      },
    );
  } catch {
    return Response.json({ series: {} }, { status: 200 });
  }
}
