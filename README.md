# Stocks on the Blockchain

Read-only desk for **tokenized / on-chain stocks**. The path is deliberate:

1. **How much volume each chain is running**
2. **Top stocks on that chain**
3. **One asset**: identity, volume, displayed liquidity, RH vs DEX marks, pools, provenance

Home (and the Solana chain page) open with **Daily Volume** — a dark area chart of per-day Solana equity USD volume, no Key Metrics row. See [Daily volume](#daily-volume).

This is not a wallet, trading venue, bot, or executable-liquidity engine. Robinhood vs DEX numbers are observed marks from separate sources. Premium/discount is labeled **interpretive**. Missing values stay missing — a dash is not zero.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 43147
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

With no live adapters configured, the **seed adapter** shows four demo chains so the drill-down works without any network.

### Live Terminal (Robinhood Chain)

```bash
TERMINAL_BASE_URL=http://127.0.0.1:3000 npm run dev -- --port 43147
```

Calls `GET {TERMINAL_BASE_URL}/api/market/liquidity` and maps rows to **one honest chain**: `robinhood-chain`. This repo does not modify Terminal.

### Live Solana (discovered tokenized stocks)

```bash
SOLANA_MARKET_ENABLED=true npm run dev -- --port 43147
```

Uses DexScreener’s public API (no API key) plus the public **xStocks / Backed** asset registry, the public **Ondo GM mint list**, and public **GeckoTerminal** pool search (candidate + hydrate hint only). The Solana adapter is a pipeline, not a mint allowlist:

1. **Discover** candidates from:
   - live `GET https://api.xstocks.fi/api/v2/public/assets?network=Solana` (paginated; not an admission list)
   - public Ondo GM constants (`ondoprotocol/gm-solana-simulator` `GM_TOKENS`; not an admission list; Ondo’s keyed `api.gm.ondo.finance` is **not** used)
   - DexScreener `GET /latest/dex/search?q=…` (category/issuer/ticker probes; search is capped)
   - GeckoTerminal `GET /api/v2/search/pools?network=solana` (a few public queries; 429s are skipped; **volume still comes from DexScreener**)
2. **Classify** each Solana mint fail-closed as a tokenized public equity, a separate ETF/index product, **or** a separate private-market / PreStocks name
3. **Hydrate** pools in two DexScreener steps, with bounded concurrency, 429 retries, and a time budget that starts **after** discovery:
   - Seed volume from DexScreener **search pairs** immediately (so a spent budget cannot render 0/0 after classify)
   - `GET /tokens/v1/solana/{mints}` in batches of 30 for remaining registry/Ondo mints, **search-known / Gecko-known / previously-pooled mints first**
   - Skip mints recently **confirmed empty** on DexScreener so refresh budget is not spent re-proving the index ceiling
   - `GET /token-pairs/v1/solana/{mint}` for each active mint on the chain page so **every Solana pool** is included
   - Background enrichment continues after the first snapshot (default 3 minutes) until pending mints are checked
4. **Aggregate** those pools into one stock row keyed by mint. Classified mints with no DexScreener pools still appear, with **null** volume (ranked last) and an explicit coverage reason. Unfinished mints are labeled **still hydrating**, not zero, and keep filling the process cache in the background.

The historical Backed xStock mint list in `src/lib/market/solana-allowlist.ts` is a **test fixture only**. It is not a production admission gate.

Process-level snapshot cache (default 5 minutes) is shared across home / chain / asset requests so a warm home load is milliseconds, not a full discovery. Home uses search-seeded + light primary-pair volume; the Solana chain page upgrades to every-pool aggregation. If DexScreener is slow, the adapter **returns a partial snapshot** (`M with volume so far`, `K still hydrating`) rather than hanging or showing 0 volume after classify. Null volume is never coerced to zero. Subsequent requests reuse and enrich that cache — with-volume counts rise instead of staying stuck at 0.

Coverage is **as discoverable from the live xStocks registry + public Ondo GM mint list + DexScreener search + public GeckoTerminal search + the classifier**, not a full Solana index. Search results are noisy and capped (~30 pairs per query, no page cursor).

**DexScreener index ceiling (measured 2026-09-07):** a full `/tokens/v1` pass over **1,169** unique xStocks-registry + Ondo GM Solana mints found **54 with at least one DexScreener pair and 1,115 with none** (0 batch failures). After fail-closed ETF / commodity / private-name filters that is about **48 public equities with DexScreener pools** — matching the live desk. Extra public candidate lists (CoinGecko `coins/list?include_platform=true`, Solflare token-list search) added names DexScreener also does not index. So most **Confirmed no pools** rows are **never listed on DexScreener**, not “hydrate never reached.” The desk still hydrates every *new* mint and re-checks empties after `SOLANA_EMPTY_CACHE_MS`.

| Issuer / source | In this desk | Notes |
| --- | --- | --- |
| Backed / xStocks | Yes, when the public registry or DexScreener/GeckoTerminal search returns them and the classifier admits | Primary live equity universe on Solana today |
| Ondo Stocks | Yes, from the **public** GM mint list + DexScreener/GeckoTerminal names that pass the classifier | Keyed Ondo API is out (403 without a key). Most Ondo mints have no DexScreener pools |
| GeckoTerminal search | Candidate + hydrate priority only | Public, no key, tight rate limits. Volume is still DexScreener |
| Jupiter Tokens API `tag=stocks` | No | Requires `x-api-key`; unauthenticated calls return 400 |
| tokens.xyz curated stocks | No | Requires API key (`UnauthorizedError`) |
| CoinGecko tokenized-stock / `coins/list` | Not a live candidate source | Public list overlaps xStocks+Ondo; extras had no additional DexScreener pools (and per-coin lookups 429) |
| Solflare UTL search | Not a live candidate source | Public, but long-tail xStock hits were not DexScreener-indexed; would inflate classified without volume |
| Dinari / dShares | No | Not a live public Solana source in this adapter |
| PreStocks / private names | Separate **Private market** tab | Fail-closed (SpaceX, OpenAI, SHEIN, Anduril, …). Not mixed into public ranking or the Gecko chart series. Reported 24h is labeled on the Solana card and added to the Daily Volume headline |
| ETF / index xStocks and Ondo ETFs | Separate **ETF / index** tab only | Never mixed into equity ranking |

The registry schema includes `underlying.type` (`Equity` vs `ETF`); live payloads often leave that field null, so name/symbol rules remain the working ETF/commodity filter, and the type is used when present. If discovery or classification yields zero verifiable stocks, the adapter **fails closed** — no invented volume. If the xStocks registry or Ondo list is down, discovery continues from whatever sources still work.

Override hosts only if you have a proxy:

```bash
SOLANA_MARKET_ENABLED=true
SOLANA_DEXSCREENER_BASE_URL=https://api.dexscreener.com
SOLANA_TIMEOUT_MS=12000
SOLANA_REQUEST_GAP_MS=50
SOLANA_MAX_CONCURRENT=6
SOLANA_CACHE_MS=300000
SOLANA_HOME_BUDGET_MS=25000
SOLANA_FULL_BUDGET_MS=60000
SOLANA_ENRICH_BUDGET_MS=180000
SOLANA_EMPTY_CACHE_MS=1800000
SOLANA_XSTOCKS_REGISTRY_URL=https://api.xstocks.fi/api/v2
SOLANA_XSTOCKS_REGISTRY_ENABLED=true
SOLANA_ONDO_REGISTRY_ENABLED=true
SOLANA_ONDO_REGISTRY_URL=https://raw.githubusercontent.com/ondoprotocol/gm-solana-simulator/main/constants.rs
SOLANA_GECKOTERMINAL_ENABLED=true
SOLANA_GECKOTERMINAL_BASE_URL=https://api.geckoterminal.com/api/v2
SOLANA_VOLUME_HISTORY_BUDGET_MS=45000
SOLANA_VOLUME_HISTORY_CACHE_MS=1800000
SOLANA_VOLUME_HISTORY_MAX_POOLS=64
```

Set `SOLANA_XSTOCKS_REGISTRY_ENABLED=false` or `SOLANA_ONDO_REGISTRY_ENABLED=false` to disable those candidate sources.

### Terminal + Solana together

```bash
TERMINAL_BASE_URL=http://127.0.0.1:3000
SOLANA_MARKET_ENABLED=true
npm run dev -- --port 43147
```

`CompositeMarketDataSource` merges the two adapters. The home page ranks every returned chain by `volume24hUsd` (nulls last). If Solana is down, Robinhood Chain still renders and provenance lists the Solana failure. If Terminal is down while Solana loaded, Solana coverage stays primary and Terminal is a quiet secondary note — not a red error that dominates the desk. If both fail, the desk shows an error instead of fabricating a ranking.

### Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
```

## Architecture

`MarketDataSource` is the only way pages load market data.

| Adapter | When | What you see |
| --- | --- | --- |
| `MockMarketDataSource` | no live env flags | Multi-chain demo snapshot |
| `TerminalMarketDataSource` | `TERMINAL_BASE_URL` set | Robinhood Chain only |
| `SolanaMarketDataSource` | `SOLANA_MARKET_ENABLED=true` | Discovered Solana tokenized stocks from DexScreener |
| `CompositeMarketDataSource` | two or more live adapters | Merged, ranked chain list |

Each chain and asset carries `sourceId` / `sourceLabel`. Composite provenance also lists per-adapter failures.

### Solana discovery + classifier

Search queries (probes, not an admission list): `xStock`, `xStocks`, `tokenized stock`, plus ticker probes such as `Circle xStock` / `Palantir xStock` / `Apple (Ondo Tokenized)` / `PreStocks` / `OpenAI PreStocks` because DexScreener search is capped and has no pagination. The **xStocks public registry** is the primary way to discover the broader Backed universe. The **public Ondo GM mint list** is the way to see Ondo mints without a key. **GeckoTerminal search** is a hydrate hint for names DexScreener text search misses (especially Ondo).

**Admitted as equity** only with a verifiable equity signal, for example:

- Name contains `xStock` and a Backed `Xs…` mint
- Phrase like `tokenized stock` / `tokenized equity`
- Explicit equity/stock labels from the source
- Known public-equity issuer keyword (Dinari, dShares, Backed) plus a ticker-like symbol
- Backed mint convention (`Xs…` + `TSLAx`-style symbol)
- Ondo mint convention (`…ondo` + `TSLAon`-style symbol) or `NVIDIA (Ondo Tokenized)` with that mint suffix
- Live issuer instrument type `Equity` plus a ticker-like symbol, after the reject rules still pass

**Admitted as ETF / index** (separate tab, not the equity ranking) when the same issuer conventions hold and the product is an ETF/index (`SPYx`, `QQQx`, `SPYon`, iShares/Vanguard/VanEck wrappers, leveraged 2x/3x, …).

**Admitted as private market** (separate tab, not the public-equity ranking or Gecko chart series; reported 24h is in the Daily Volume headline) when a private / pre-IPO / PreStocks-style name has a verifiable issuer convention, for example:

- `OpenAI PreStocks` / `SpaceX PreStocks` on a `Pre…` mint
- Private-company xStocks or Ondo wrappers (`SHEINx`, `SPCXx`, `SPCXon`) with the matching mint convention
- A generic `PreStocks` basket, a token merely named `SpaceX`, or a copycat PreStocks brand on a pump mint is still rejected

**Excluded** (fail closed):

- Ordinary crypto and wrapped natives (SOL, BONK, JUP, …)
- Stablecoins (USDC, USDT, USDY, …)
- Commodities (gold, oil, PAXG, …)
- Unrelated RWAs, generic “xStocks” / “Tokenized Equity” / “PreStocks” baskets, and unverifiable tickers (a token named `Tesla` or `SpaceX` is not enough)
- Copycat `xStock` / Ondo / PreStocks names whose mint does not use the issuer convention

Listed operating companies whose names contain “Gold” or “Real Estate” (Royal Gold, Laopu Gold, Wharf Real Estate, Nasdaq Inc.) can be admitted when they are verifiable xStocks. A token that *is* gold/silver as the product (`Gold xStock`) is still excluded.

Volume = sum of returned pair `volume.h24` for that mint across every Solana pool on the chain page. Home may show DexScreener primary-pair volume until that full snapshot is cached. A DexScreener pair is never treated as one stock. Duplicate `pairAddress` values are dropped. Null/unknown volume stays null and ranks last; a reported `0` is a real zero.

The UI says **why** volume is missing: no indexed pools, pools without reported 24h volume, fetch failure, or hydrate still running.

Different mints for the same ticker (Tesla xStock vs Tesla Ondo) stay **separate** stock rows. Issuer/provider is shown when the classifier can infer it. Each row keeps mint, symbol, name, pool count, per-pool volume/liquidity/price, aggregate 24h volume, displayed liquidity, and provenance.

Robinhood marks stay null on Solana. Off-Solana pairs are ignored.

## Daily volume

**Daily Volume** is per-day USD volume, not a running total and not TVL.

| | |
| --- | --- |
| **Definition** | Historical days: same-day sum of **GeckoTerminal daily USD volume** (`/networks/solana/pools/{pool}/ohlcv/day?currency=usd`) across Solana pools of **classified public equities**. Latest chart point: the **DexScreener 24h public-equity rollup** (rolling 24h, not a UTC calendar day). Headline / Solana card: **public + private + ETF/index** DexScreener 24h (`sumNullable`; null omitted, not zero) |
| **Universe** | Same fail-closed classifier as the rest of the desk. Headline and Solana card include **public + private + ETF/index** 24h. Chart series and public ranking stay public-equity only — the headline universe is broader than the chart |
| **Why two sources** | DexScreener’s public API is snapshot-only (no pair history). Calendar-day GeckoTerminal candles cannot equal a rolling 24h desk total, so the latest point is the desk number on purpose |
| **Honesty** | Missing calendar days are plotted as **$0** (no candle / no activity). A source-reported `0` is kept. Null DexScreener 24h is never coerced to zero. A 429 / disabled GeckoTerminal / seed adapter with no desk 24h yields an **empty chart**, never invented nonzero points |
| **Coverage** | Highest-volume classified equity pools with a reported DexScreener 24h first, capped (`SOLANA_VOLUME_HISTORY_MAX_POOLS`, default 64) with concurrency ≤ 2 and ≥ 400ms pacing. The muted line under the chart states how many fetched pools have a series vs classified equity pools in the snapshot |

The seed adapter does **not** draw a demo series.

## Trust labeling

- Persistent disclaimer in the site footer only (no gold trust card; provenance on pages is a thin source · time line)
- Home / Solana chain: **Daily Volume** chart (title + series + range chips + one definition line). No Key Metrics row
- Solana coverage is a single muted line; table chips still filter classified / with-volume / still-hydrating / confirmed-no-pools, plus **issuer** (`?issuer=ondo`, case-insensitive, derived from the current lane). Rank # is the current filtered view.
- Solana desk jump (`/` or ⌘K) searches symbol, name, issuer, and mint with collision-safe deep links. Stars pin mints in `localStorage` (`sotb.solana.favoriteMints.v1`); pinned rows float to the top, or filter with `?pinned=1`. Two or more pins open a compare strip. Export CSV downloads the current filtered+sorted lane (null volume stays blank). TSLAx and TSLAon stay separate.
- Solana chain list defaults to **With volume**, ranked by coverage tier then aggregate 24h volume (nulls last). Click column headers to change sort. Warm navigations show skeletons instead of an empty table.
- **Reported** vs **Interpretive** badges on metrics
- Displayed liquidity is never described as buy capacity
- No arb, profitability, or “you can trade this on Robinhood” copy

## Out of scope

Wallets, signing, trading, bots, continuous agents, news/RAG, edits to Terminal or BotDawg, merging different mints into one underlying-ticker row, and a full Solana/L2 indexer.
