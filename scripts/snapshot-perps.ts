import { compactPerpsDay, encodeCompactDay } from "../src/lib/market/perps-compact";
import { captureEquityPerpsSnapshot } from "../src/lib/market/perps-fetch";
import { savePerpsDay } from "../src/lib/market/perps-snapshot-file";
import { buildPerpsDeskModel, PERPS_SNAPSHOT_SCHEMA, selectPerpsRange } from "../src/lib/market/perps-snapshot";

const DRY_RUN = process.argv.includes("--dry-run");

const REPORT_VENUES = [
  "Zoomex",
  "XT.COM",
  "Bitunix",
  "Phemex",
  "Arcus",
  "WhiteBIT",
  "BTSE",
  "HTX",
  "Vest",
  "Deribit",
  "Polymarket Perps",
  "BloFin",
  "RISEx",
  "GRVT",
  "edgeX",
  "Kraken Futures",
  "ApeX Omni",
  "GMX V2 (Solana)",
  "GMX V2 (Arbitrum)",
  "Helix",
  "Nado",
  "Crypto.com",
  "Pacifica",
  "Bitstamp",
  "StandX",
  "Bitfinex",
  "Veranta",
  "Drift",
  "LBank",
  "Ourbit",
  "Tapbit",
  "CoinW",
  "OrangeX",
  "BitKan",
  "Antarctic",
  "Deepcoin",
  "BVOX",
  "KCEX",
  "Bitrue",
];

function billions(value: number | null): string {
  if (value === null) return "—";
  return `$${(value / 1e9).toFixed(3)}B`;
}

function millions(value: number | null): string {
  if (value === null) return "—";
  return `$${(value / 1e6).toFixed(3)}M`;
}

captureEquityPerpsSnapshot()
  .then(async (day) => {
    const equityMarkets = day.venues.reduce((sum, venue) => sum + venue.markets.length, 0);
    if (!DRY_RUN && equityMarkets === 0) {
      console.error("No equity perp markets captured. Snapshot not written.");
      for (const venue of day.venues) {
        if (venue.error) console.error(`  ${venue.venue}: ${venue.error}`);
      }
      process.exit(1);
    }
    if (!DRY_RUN) await savePerpsDay(day);
    const model = buildPerpsDeskModel({ schema: PERPS_SNAPSHOT_SCHEMA, records: [day] }, Date.parse(day.capturedAt) / 1000);
    const view = selectPerpsRange(model.days, "24h", false);
    const encodedBytes = Buffer.byteLength(JSON.stringify(encodeCompactDay(compactPerpsDay(day))));
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
    console.log(`Equity perp snapshot ${day.date} captured ${et}${DRY_RUN ? "  DRY RUN (not written)" : ""}`);
    console.log(
      `Headline ${billions(view.headlineUsd)}  onchain ${billions(view.onchainUsd)}  major CEX ${billions(view.cexDirectUsd)}  Binance+Bybit ${billions(view.cexCoingeckoUsd)}  long-tail ${billions(view.longTailUsd)}  unverified ${billions(view.unverifiedUsd)}  excluded ${billions(view.excludedUsd)}`,
    );
    console.log(`Encoded row ${encodedBytes} bytes`);
    console.log(`Venues ${view.venueCount}  markets ${view.marketCount}  pre-IPO ${billions(view.preipoUsd)}`);
    if (day.archive) {
      const binance = day.archive.binance;
      const bybit = day.archive.bybit;
      console.log(
        `Archive ${day.archive.utcDate}  Binance CG ${billions(binance.coingeckoVolumeUsd)} vs dump ${billions(binance.volumeUsd)} (${binance.covered}/${binance.symbols})  Bybit CG ${billions(bybit.coingeckoVolumeUsd)} vs dump ${billions(bybit.volumeUsd)} (${bybit.covered}/${bybit.symbols})${day.archive.note ? `  ${day.archive.note}` : ""}`,
      );
    }
    for (const venue of view.venues) {
      const vol = venue.volumeUsd === null ? "—".padStart(10) : `${(venue.volumeUsd / 1e6).toFixed(1)}M`.padStart(10);
      const flag = venue.error ? `  ERROR ${venue.error}` : venue.credible ? "" : "  EXCLUDED";
      console.log(`  ${venue.tier.padEnd(14)} ${venue.venue.padEnd(32)} ${String(venue.marketCount).padStart(4)} ${vol}${flag}`);
    }
    console.log("Scoped venues");
    for (const name of REPORT_VENUES) {
      const venue = day.venues.find((row) => row.venue === name);
      const row = view.venues.find((item) => item.venue === name);
      if (!venue || !row) {
        console.log(`  ${name}: missing`);
        continue;
      }
      const status = venue.noEquity ? "no-equity" : venue.quality ?? (venue.error ? "failed" : "fresh");
      console.log(
        `  ${name}: ${millions(row.volumeUsd)}  ${status}  tier ${venue.tier}  credible ${venue.credible === false ? "no" : "yes"}${venue.excludeReason ? `  ${venue.excludeReason}` : ""}${venue.error ? `  ${venue.error}` : ""}`,
      );
    }
    const excluded = view.venues.filter((venue) => venue.credible === false);
    console.log(`Excluded ${excluded.length}`);
    for (const venue of excluded) {
      console.log(`  ${venue.venue}: ${venue.excludeReason ?? "excluded"}  ${millions(venue.volumeUsd)}`);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "snapshot:perps failed.");
    process.exit(1);
  });
