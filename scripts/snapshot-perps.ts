import { captureEquityPerpsSnapshot } from "../src/lib/market/perps-fetch";
import { savePerpsDay } from "../src/lib/market/perps-snapshot-file";
import { buildPerpsDeskModel, PERPS_SNAPSHOT_SCHEMA, selectPerpsRange } from "../src/lib/market/perps-snapshot";

function billions(value: number | null): string {
  if (value === null) return "—";
  return `$${(value / 1e9).toFixed(3)}B`;
}

captureEquityPerpsSnapshot()
  .then(async (day) => {
    const equityMarkets = day.venues.reduce((sum, venue) => sum + venue.markets.length, 0);
    if (equityMarkets === 0) {
      console.error("No equity perp markets captured. Snapshot not written.");
      for (const venue of day.venues) {
        if (venue.error) console.error(`  ${venue.venue}: ${venue.error}`);
      }
      process.exit(1);
    }
    await savePerpsDay(day);
    const model = buildPerpsDeskModel({ schema: PERPS_SNAPSHOT_SCHEMA, records: [day] }, Date.parse(day.capturedAt) / 1000);
    const view = selectPerpsRange(model.days, "24h", false);
    const capturedMs = Date.parse(day.capturedAt);
    const et = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(capturedMs));
    console.log(`Equity perp snapshot ${day.date} captured ${et}`);
    console.log(
      `Headline ${billions(view.headlineUsd)}  onchain ${billions(view.onchainUsd)}  major CEX ${billions(view.cexDirectUsd)}  Binance+Bybit ${billions(view.cexCoingeckoUsd)}  long-tail ${billions(view.longTailUsd)}  excluded ${billions(view.excludedUsd)}`,
    );
    console.log(`Venues ${view.venueCount}  markets ${view.marketCount}  pre-IPO ${billions(view.preipoUsd)}`);
    for (const venue of view.venues) {
      const vol = venue.volumeUsd === null ? "—".padStart(10) : `${(venue.volumeUsd / 1e6).toFixed(1)}M`.padStart(10);
      const flag = venue.error ? `  ERROR ${venue.error}` : venue.credible ? "" : "  EXCLUDED";
      console.log(`  ${venue.tier.padEnd(14)} ${venue.venue.padEnd(32)} ${String(venue.marketCount).padStart(4)} ${vol}${flag}`);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "snapshot:perps failed.");
    process.exit(1);
  });
