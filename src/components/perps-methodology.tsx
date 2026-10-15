import Link from "next/link";
import { perpsArchiveVariance, type PerpsArchiveCheck, type PerpsArchiveVenueCheck } from "@/lib/market/perps-archive";
import { PERPS_CSV_FILES } from "@/lib/market/perps-csv";
import { PERPS_JSON_ATTRIBUTION, PERPS_JSON_FILES, PERPS_JSON_SCHEMA } from "@/lib/market/perps-json";
import { formatUsdCompact } from "@/lib/market/format";
import {
  PERPS_INDEX_LABELS,
  PERPS_LEVERAGED_ETF_UNDERLYINGS,
  PERPS_LEVERAGED_SUFFIX_MIN_LENGTH,
  PERPS_PREIPO_UNDERLYINGS,
  PERPS_ZERO_FEE_VENUES,
  perpCategoryLabel,
  type PerpsCategory,
} from "@/lib/market/perps-classify";
import { PERPS_FUNDING_CAP, PERPS_TICKER_CAP } from "@/lib/market/perps-compact";
import { HIP3_BUILDERS, PERP_PLACES } from "@/lib/market/perps-meta";
import {
  CG_OI_MARKETS,
  DIRECT_CG_MARKETS,
  PERPS_BINANCE_ARCHIVE_SOURCE,
  PERPS_BYBIT_ARCHIVE_SOURCE,
  PERPS_COINGECKO_NAMED_SKIP,
  PERPS_HELD_OUT,
  PERPS_PRICE_BAND_MAX,
  PERPS_PRICE_BAND_MIN,
  PERPS_SNAPSHOT_CLOCK,
  coingeckoMarketsNotFetched,
  listPerpsSourceCatalog,
  type PerpsCatalogRow,
} from "@/lib/market/perps-sources";
import {
  PERPS_THIN_OI_USD,
  PERPS_THIN_VOLUME_USD,
  PERPS_VOL_OI_LIMIT,
  perpsTierLabel,
  type PerpsTier,
  type PerpsVolumeWindow,
} from "@/lib/market/perps-snapshot";

const TIERS: { tier: PerpsTier; inHeadline: boolean; detail: string }[] = [
  {
    tier: "onchain",
    inHeadline: true,
    detail: "Onchain and hybrid books, including HIP-3 builder dexes. Each dex is its own venue.",
  },
  {
    tier: "cex-coingecko",
    inHeadline: true,
    detail: "Binance and Bybit. Both are CoinGecko rows because those hosts block the direct route.",
  },
  {
    tier: "cex-direct",
    inHeadline: true,
    detail: "Other major centralized exchanges with a direct public API.",
  },
  {
    tier: "long-tail",
    inHeadline: false,
    detail: "CoinGecko-only venues. Stored, and left out of the headline until the desk opts in.",
  },
];

const CATEGORIES: PerpsCategory[] = ["stock", "etf", "leveraged-etf", "index"];

function windowLabel(window: PerpsVolumeWindow | null): string {
  switch (window) {
    case "rolling-24h":
      return "Rolling 24h";
    case "et-day":
      return "Eastern day";
    case "lifetime":
      return "Lifetime";
    case "unavailable":
      return "No 24h volume";
    default:
      return "—";
  }
}

function place(venue: string) {
  return PERP_PLACES.find((row) => row.venue === venue) ?? null;
}

export function PerpsMethodology({
  archive,
}: {
  /** Latest stored cross-check. Null until a snapshot written by this writer exists. */
  archive?: { date: string; check: PerpsArchiveCheck } | null;
}) {
  const catalog = listPerpsSourceCatalog();
  const catalogNames = new Set(catalog.map((row) => row.venue));
  const unfetched = PERP_PLACES.filter((row) => !catalogNames.has(row.venue)).map((row) => row.venue);
  const notFetchedMarkets = coingeckoMarketsNotFetched();
  const hip3 = place("Hyperliquid HIP-3");
  const orderly = place("Orderly");
  const lighter = catalog.find((row) => row.venue === "Lighter");
  const lighterRh = catalog.find((row) => row.venue === "Lighter on Robinhood Chain");
  const ostium = catalog.find((row) => row.venue === "Ostium");
  const avantis = catalog.find((row) => row.venue === "Avantis");
  const binance = catalog.find((row) => row.venue === "Binance");
  const bybit = catalog.find((row) => row.venue === "Bybit");
  const weex = catalog.find((row) => row.venue === "WEEX");
  const coinbase = catalog.find((row) => row.venue === "Coinbase International");
  const preipo = [...PERPS_PREIPO_UNDERLYINGS].sort((a, b) => a.localeCompare(b));
  const indexes = Object.entries(PERPS_INDEX_LABELS).sort((a, b) => a[0].localeCompare(b[0]));
  const graveyard = HIP3_BUILDERS.filter((builder) => !builder.live);

  return (
    <div className="space-y-8" data-perps-methodology>
      <header className="space-y-2">
        <p className="text-[10px] font-medium tracking-wide text-primary">EQUITY PERPS</p>
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Methodology</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          How the perps desk decides what is an equity perpetual, which venue it counts, and when the number
          was captured. The venue table below is the same catalog the snapshot writer uses.{" "}
          <Link href="/perps" className="text-primary underline-offset-2 hover:underline">
            Back to the desk
          </Link>
          .
        </p>
      </header>

      <section className="space-y-3" data-perps-method-universe>
        <h3 className="font-heading text-lg font-medium">What counts as an equity perp</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A synthetic, oracle-priced perpetual on a single stock, an equity ETF, a leveraged or inverse equity
          ETF, or an equity index. Tokenized stock spot is a different desk and is not added here. Commodities,
          FX, rates, and vol are dropped. ETFs whose exposure is commodity, bonds, crypto, or volatility are
          dropped. Pre-IPO is stored as a side stat and stays out of the headline.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((category) => (
            <div key={category} className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
              <p className="font-medium">{perpCategoryLabel(category)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Stored category {category}. Included in the headline.</p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Venues with an equity flag seed a reference price. A venue without that flag keeps a ticker only when
          the normalized symbol is in that universe and the mark is between {PERPS_PRICE_BAND_MIN}× and{" "}
          {PERPS_PRICE_BAND_MAX}× the median price from the tagged venues. Index aliases match on the ticker.
          Index levels are not compared across contract multipliers. {indexes.length} aliases collapse to one
          label, so US500 and SPX500 are both {PERPS_INDEX_LABELS.US500}.
        </p>
      </section>

      <section className="space-y-3" data-perps-method-tiers>
        <h3 className="font-heading text-lg font-medium">How venues are tiered</h3>
        <div className="grid gap-2">
          {TIERS.map((row) => (
            <div key={row.tier} className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10" data-perps-method-tier={row.tier}>
              <p className="font-medium">{perpsTierLabel(row.tier)}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {row.detail} {row.inHeadline ? "In the default headline." : "Opt-in."}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3" data-perps-method-screen>
        <h3 className="font-heading text-lg font-medium">Volume / open-interest screen</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          A venue that trips either rule is stored with credible set to false and left out of the headline. Open
          interest counts only when every equity market that reported volume also reported open interest. A
          partial open-interest feed is treated as missing, so it does not trip the screen. Older rows keep the
          credible flag they were stored with. Rows with no credible field stay in the headline.
        </p>
        <ul className="max-w-3xl list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Volume is more than {PERPS_VOL_OI_LIMIT}× open interest.</li>
          <li>
            Open interest is under ${PERPS_THIN_OI_USD.toLocaleString("en-US")} and volume is over $
            {PERPS_THIN_VOLUME_USD.toLocaleString("en-US")}.
          </li>
        </ul>
      </section>

      <section className="space-y-3" data-perps-method-handling>
        <h3 className="font-heading text-lg font-medium">Leveraged ETFs and pre-IPO</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Leveraged and inverse equity ETFs stay inside the equity universe. The desk can hide them. A name in
          the explicit list ({PERPS_LEVERAGED_ETF_UNDERLYINGS.size} tickers), or a name of at least{" "}
          {PERPS_LEVERAGED_SUFFIX_MIN_LENGTH} characters ending in 2L, 3L, 2S, or 3S, is a leveraged
          ETF. Hiding them removes that volume from the headline. The category mix can still show it.
        </p>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Pre-IPO names are {preipo.join(", ")}. They are stored on the venue as a pre-IPO bucket and shown as a
          side stat. They are not in the headline and not in the per-ticker history. Extended Pre-market and
          Phemex PreMarket are forced to pre-IPO when classification would otherwise call them a stock. On the
          HIP-3 io book, ANTH and OAI are forced to pre-IPO.
        </p>
      </section>

      <section className="space-y-3" data-perps-method-double-count>
        <h3 className="font-heading text-lg font-medium">Double counting</h3>
        <div className="grid gap-2">
          <Rule title="HIP-3 builders, not front ends" body={hip3?.chain ?? "Each builder dex is one book."} />
          <Rule title="Orderly once" body={orderly?.chain ?? "One shared book."} />
          <Rule
            title="Lighter mainnet and Robinhood Chain"
            body={`Separate books. ${lighter?.source ?? "Lighter"} and ${lighterRh?.source ?? "Robinhood Chain"}.`}
          />
          <Rule
            title="CoinGecko Hyperliquid is not added"
            body={`Skipped by name: ${[...PERPS_COINGECKO_NAMED_SKIP].join(", ")}. HIP-3 volume comes from the Hyperliquid info API, one row per builder dex.`}
          />
          <Rule
            title="Direct books are not added again from CoinGecko"
            body={`${DIRECT_CG_MARKETS.size} CoinGecko market names are on the skip list, including WEEX. A name on that list does not become a second volume row.`}
          />
        </div>
        <p className="text-[11px] text-muted-foreground" data-perps-method-graveyard>
          Delisted HIP-3 builders at the last research pass: {graveyard.map((builder) => `${builder.name} (${builder.dex})`).join(", ")}.
        </p>
      </section>

      <section className="space-y-3" data-perps-method-sources>
        <h3 className="font-heading text-lg font-medium">Data source per venue</h3>
        <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
          Direct API or CoinGecko, from the writer catalog. HIP-3 substitutes the builder dex into the info
          call. The desk venue table shows the source and capture time stored on that day.
        </p>
        <CatalogTable rows={catalog} />
      </section>

      <section className="space-y-3" data-perps-method-timing>
        <h3 className="font-heading text-lg font-medium">Snapshot timing</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          The nightly capture runs at {PERPS_SNAPSHOT_CLOCK}. The row date is that America/New_York calendar
          day. At 11:59 PM Eastern, UTC is already the next calendar day. Venue 24h figures are rolling windows
          at capture time, except where a venue has no 24h field. Hyperliquid hourly candles are base size, not
          USD, so that row stays on rolling dayNtlVlm. The in-progress Eastern day is shown on 24H and left out
          of 7D, 14D, and 30D until the day has closed.
        </p>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Stored ticker history keeps the top {PERPS_TICKER_CAP} names for each headline toggle, plus every
          Ostium name. Funding is stored for names that can reach the {PERPS_FUNDING_CAP}-name table. A ticker
          page for a name outside that set says so, and does not invent volume. Zero-fee or points venues:{" "}
          {[...PERPS_ZERO_FEE_VENUES].sort((a, b) => a.localeCompare(b)).join(", ")}.
        </p>
      </section>

      <section className="space-y-3" data-perps-method-gaps>
        <h3 className="font-heading text-lg font-medium">Known gaps</h3>
        <div className="grid gap-2">
          <Rule title="Binance and Bybit via CoinGecko" body={`${binance?.note ?? ""} ${bybit?.note ?? ""}`.trim()} />
          <Rule title="Avantis has no volume" body={avantis?.note ?? "No public 24h volume."} />
          <Rule title="Ostium is a lifetime difference" body={ostium?.note ?? "Daily volume is the difference between consecutive Eastern snapshots."} />
          <Rule title="WEEX uses the direct ticker" body={weex?.note ?? "Direct v3 quote volume. The CoinGecko WEEX row is not added."} />
          <Rule
            title="Coinbase International is $0 while paused"
            body={coinbase?.note ?? "Paused equity instruments are stored at $0, not omitted."}
          />
          {PERPS_HELD_OUT.length > 0 ? (
            <Rule title="Held out of the snapshot" body={PERPS_HELD_OUT.map((row) => `${row.venue}: ${row.reason}`).join(" ")} />
          ) : null}
          <Rule
            title="CoinGecko open interest fills a blank"
            body={`These direct venues do not get a second volume row. Open interest is filled from CoinGecko when the venue feed left it blank: ${Object.keys(CG_OI_MARKETS).sort((a, b) => a.localeCompare(b)).join(", ")}.`}
          />
          <Rule
            title="Skip-list markets with no equity fetcher"
            body={
              notFetchedMarkets.length > 0
                ? `${notFetchedMarkets.join(", ")} ${notFetchedMarkets.length === 1 ? "is" : "are"} on the CoinGecko skip list and ${notFetchedMarkets.length === 1 ? "is" : "are"} not fetched another way.`
                : "Every CoinGecko skip-list market is either fetched directly or held out on purpose."
            }
          />
          <Rule
            title="Place map without a snapshot fetcher"
            body={
              unfetched.length > 0
                ? `${unfetched.join(", ")} ${unfetched.length === 1 ? "is" : "are"} on the where-it-runs map and ${unfetched.length === 1 ? "has" : "have"} no snapshot row.`
                : "Every place-map venue has a snapshot row or a held-out entry."
            }
          />
        </div>
      </section>

      <section className="space-y-3" data-perps-archive>
        <h3 className="font-heading text-lg font-medium">CoinGecko versus official archives</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Binance and Bybit stay on CoinGecko for the rolling 24h headline. Each snapshot also reads the prior
          UTC day from the official archives and stores that comparison on the row. If the prior UTC day is not
          published yet, the writer steps back one UTC day. The symbol list is the equity contracts already kept
          from CoinGecko, because the exchange info hosts block this environment.{" "}
          {PERPS_BINANCE_ARCHIVE_SOURCE}. Bybit sums size × price from {PERPS_BYBIT_ARCHIVE_SOURCE}. Binance open
          interest is the last metrics row of that UTC day (sum_open_interest_value), not a sum of the intraday
          rows. Bybit&apos;s trade file has no open interest. www.binance.com and api.bybit.com are not used.
        </p>
        {archive ? (
          <ArchiveTable date={archive.date} check={archive.check} />
        ) : (
          <p className="max-w-3xl text-sm text-muted-foreground" data-perps-archive-empty>
            No archive cross-check is stored yet. The next nightly snapshot records it. Until then the Binance
            and Bybit headline numbers are CoinGecko only.
          </p>
        )}
      </section>

      <section className="space-y-3" data-perps-method-quality>
        <h3 className="font-heading text-lg font-medium">Fresh, stale, and failed</h3>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Each venue row is fresh when that capture returned a book, failed when the request errored and no
          earlier good row exists, and stale when the request errored but an earlier day succeeded. A failed or
          stale venue stays on the table. Its volume and open interest are blank. They are not stored as zero
          and they are not added to the headline. Stale does not reuse yesterday&apos;s numbers. Last good is the
          earlier capture time. Rows written before this field existed are fresh when they have no error, and
          failed when they recorded one.
        </p>
      </section>

      <section className="space-y-3" data-perps-method-downloads>
        <h3 className="font-heading text-lg font-medium">Downloads</h3>
        <p className="max-w-3xl text-[11px] leading-snug text-muted-foreground">
          CSV and JSON from the stored equity-perps-v2 file. JSON schema {PERPS_JSON_SCHEMA}. {PERPS_JSON_ATTRIBUTION}{" "}
          Headline is onchain plus major CEX plus Binance and Bybit, with leveraged ETFs included and long-tail
          left out. Null cells are unreported. Venue rows include quality and last good time. Ticker rows include
          a per-venue book only when that day stored one. The top names keep that split. Older days leave it blank.
        </p>
        <div className="flex flex-wrap gap-2">
          {PERPS_JSON_FILES.map((file) => (
            <a
              key={file.id}
              href={file.href}
              data-perps-json={file.id}
              className="rounded-full px-2.5 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border hover:text-foreground"
            >
              {file.label}
            </a>
          ))}
          {PERPS_CSV_FILES.map((file) => (
            <a
              key={file.id}
              href={file.href}
              data-perps-csv={file.id}
              className="rounded-full px-2.5 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border hover:text-foreground"
            >
              {file.label}
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function varianceLabel(coingeckoUsd: number | null, archiveUsd: number | null): string {
  const ratio = perpsArchiveVariance(coingeckoUsd, archiveUsd);
  if (ratio === null) return "—";
  const pct = ratio * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function ArchiveCells({ row }: { row: PerpsArchiveVenueCheck }) {
  return (
    <>
      <p className="num text-xs">{formatUsdCompact(row.coingeckoVenueUsd)}</p>
      <p className="num text-xs">{formatUsdCompact(row.coingeckoVolumeUsd)}</p>
      <p className="num text-xs">{formatUsdCompact(row.volumeUsd)}</p>
      <p className="num text-xs">{varianceLabel(row.coingeckoVolumeUsd, row.volumeUsd)}</p>
      <p className="num text-xs">{formatUsdCompact(row.openInterestUsd)}</p>
      <p className="num text-xs">
        {row.covered}/{row.symbols}
      </p>
    </>
  );
}

function ArchiveTable({ date, check }: { date: string; check: PerpsArchiveCheck }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground" data-perps-archive-date>
        Snapshot {date}. Archive UTC day {check.utcDate}. Variance is CoinGecko rolling 24h on the covered
        symbols minus the archive total, divided by the archive total. The headline still uses the full
        CoinGecko venue total.
        {check.note ? ` ${check.note}` : ""}
      </p>
      <div className="overflow-x-auto">
        <div className="grid w-full min-w-[64rem] grid-cols-[10rem_repeat(6,minmax(7rem,1fr))] gap-x-3 gap-y-2">
          {["Venue", "CoinGecko venue", "CoinGecko covered", "Archive volume", "Variance", "Archive OI", "Covered"].map(
            (label) => (
              <div key={label} className="px-1 text-xs text-muted-foreground">
                {label}
              </div>
            ),
          )}
          <div className="col-span-full grid grid-cols-subgrid items-center rounded-xl bg-card px-3 py-2.5 ring-1 ring-foreground/10" data-perps-archive-venue="Binance">
            <p className="text-sm font-medium">Binance</p>
            <ArchiveCells row={check.binance} />
          </div>
          <div className="col-span-full grid grid-cols-subgrid items-center rounded-xl bg-card px-3 py-2.5 ring-1 ring-foreground/10" data-perps-archive-venue="Bybit">
            <p className="text-sm font-medium">Bybit</p>
            <ArchiveCells row={check.bybit} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Rule({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function CatalogTable({ rows }: { rows: readonly PerpsCatalogRow[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid w-full min-w-[72rem] grid-cols-[minmax(12rem,0.8fr)_7rem_7rem_8rem_minmax(16rem,1.2fr)_minmax(16rem,1.3fr)] gap-x-3 gap-y-2">
        {["Venue", "Tier", "Feed", "Window", "Source", "Note"].map((label) => (
          <div key={label} className="px-1 text-xs text-muted-foreground">
            {label}
          </div>
        ))}
        {rows.map((row) => (
          <div
            key={row.venue}
            className="col-span-full grid grid-cols-subgrid items-start rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-foreground/10"
            data-perps-method-venue={row.venue}
          >
            <p className="font-medium">{row.venue}</p>
            <p className="text-xs text-muted-foreground">{row.tier ? perpsTierLabel(row.tier) : "—"}</p>
            <p className="text-xs">{row.feed}</p>
            <p className="text-xs text-muted-foreground">{windowLabel(row.volumeWindow)}</p>
            <p className="text-xs leading-snug break-all text-muted-foreground">{row.source}</p>
            <p className="text-xs leading-snug text-muted-foreground">
              {row.note}
              {row.oiFromCoinGecko ? " Open interest can be filled from CoinGecko." : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
