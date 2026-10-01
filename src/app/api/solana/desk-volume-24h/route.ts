import { createMarketDataSource } from "@/lib/market/factory";

export const dynamic = "force-dynamic";

/**
 * 24H chart revalidate.
 * Hourly bars come from `solana-hourly.json` (no DexScreener, no `solana.json` write).
 * The headline reuses the in-memory desk snapshot. DexScreener runs only when that
 * cache is past its TTL (5 minutes by default), and that refresh does not persist
 * the closed-day file.
 */
export async function GET() {
  try {
    const source = createMarketDataSource();
    const [hourlyHistory, rolling24h] = await Promise.all([
      source.getEquityHourlyRollingVolumeHistory(),
      source.getLiveDeskRolling24h(),
    ]);
    return Response.json(
      { hourlyHistory, rolling24h },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { hourlyHistory: null, rolling24h: null },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
