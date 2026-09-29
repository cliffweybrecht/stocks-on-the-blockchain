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

Uses DexScreener’s public API (no API key) plus the public **xStocks / Backed** asset registry, the public **Ondo GM mint list**, the public **Tessera T-Token mint list**, the public **Sunrise token list** (Backpack Securities candidates), and public **GeckoTerminal** pool search. The Solana adapter is a pipeline, not a mint allowlist:

1. **Discover** candidates from:
   - live `GET https://api.xstocks.fi/api/v2/public/assets?network=Solana` (paginated; not an admission list)
   - public Ondo GM constants (`ondoprotocol/gm-solana-simulator` `GM_TOKENS`; not an admission list; Ondo’s keyed `api.gm.ondo.finance` is **not** used)
   - public Tessera on-chain-programs docs (`docs.tessera.pe` T-Token mint table; not an admission list)
   - public Sunrise `GET https://api.sunrise.xyz/v1/tokens` (paginated; stock / Backpack Securities rows only; not an admission list)
   - DexScreener `GET /latest/dex/search?q=…` (category/issuer/ticker probes; search is capped)
   - GeckoTerminal `GET /api/v2/search/pools?network=solana` (a few public queries; 429s are skipped; **volume still comes from DexScreener**)
2. **Classify** each Solana mint fail-closed as a tokenized public equity, a separate ETF/index product, **or** a separate private-market / PreStocks / Tessera T-Token name
3. **Hydrate** pools in two DexScreener steps, with bounded concurrency, 429 retries, and a time budget that starts **after** discovery:
   - Seed volume from DexScreener **search pairs** immediately (so a spent budget cannot render 0/0 after classify)
   - `GET /tokens/v1/solana/{mints}` in batches of 30 for remaining registry/Ondo mints, **search-known / Gecko-known / previously-pooled mints first**
   - Skip mints recently **confirmed empty** on DexScreener so refresh budget is not spent re-proving the index ceiling
   - `GET /token-pairs/v1/solana/{mint}` for each active mint on the chain page so **every Solana pool** is included
   - Background enrichment continues after the first snapshot (default 3 minutes) until pending mints are checked
4. **Aggregate** those pools into one stock row keyed by mint. Classified mints with no DexScreener pools still appear, with **null** volume (ranked last) and an explicit coverage reason. Unfinished mints are labeled **still hydrating**, not zero, and keep filling the process cache in the background.
5. **Asset stats** (asset page only) read outstanding supply from Solana `getTokenSupply` and compute market cap / FDV in-process. See [Supply, market cap, and FDV](#supply-market-cap-and-fdv).

The historical Backed xStock mint list in `src/lib/market/solana-allowlist.ts` is a **test fixture only**. It is not a production admission gate.

Process-level snapshot cache (default 5 minutes) is shared across home / chain / asset requests so a warm home load is milliseconds, not a full discovery. Home uses search-seeded + light primary-pair volume; the Solana chain page upgrades to every-pool aggregation. If DexScreener is slow, the adapter **returns a partial snapshot** (`M with volume so far`, `K still hydrating`) rather than hanging or showing 0 volume after classify. Null volume is never coerced to zero. Subsequent requests reuse and enrich that cache — with-volume counts rise instead of staying stuck at 0.

Coverage is **as discoverable from the live xStocks registry + public Ondo GM mint list + public Tessera T-Token mint list + public Sunrise token list + DexScreener search + public GeckoTerminal search + the classifier**, not a full Solana index. Search results are noisy and capped (~30 pairs per query, no page cursor).

**Tessera V prop-AMM (negative, measured 2026-09-09):** no per-mint stock volume is added from this venue.

- DefiLlama Tessera V Solana ~$149M 24h is **protocol-level only** (`hasLabelBreakdown: false`). The public Volumes API has no pair/token split.
- Tessera V TVL tokens can include SPCX (~$369k) among mostly SOL/USDC/memes. **TVL ≠ attributable stock volume.**
- Backpack/Sunrise SPCX already has large DexScreener Solana legs (Raydium/Orca/Meteora, ~$0.7M+ in a sample). That is DexScreener pool volume, not Tessera V.
- GeckoTerminal Solana dex list / search: **no Tessera V dex**. Text search for “tessera” returns meme TESS / Tesseract pairs.
- DexScreener stock-pair samples: raydium / orca / meteora only — no `tessera` dexId.

GeckoTerminal ZeroFi / HumidiFi / Byreal pools exist for some stock mints, but mixing that 24h into the DexScreener desk total would be a second indexer with a different methodology. The desk does **not** invent Tessera V (or other prop-AMM) stock volume.

**DexScreener index ceiling (measured 2026-09-07):** a full `/tokens/v1` pass over **1,169** unique xStocks-registry + Ondo GM Solana mints found **54 with at least one DexScreener pair and 1,115 with none** (0 batch failures). After fail-closed ETF / commodity / private-name filters that is about **48 public equities with DexScreener pools** — matching the live desk. Extra public candidate lists (CoinGecko `coins/list?include_platform=true`, Solflare token-list search) added names DexScreener also does not index. So most **Confirmed no pools** rows are **never listed on DexScreener**, not “hydrate never reached.” The desk still hydrates every *new* mint and re-checks empties after `SOLANA_EMPTY_CACHE_MS`.

| Issuer / source | In this desk | Notes |
| --- | --- | --- |
| Backed / xStocks | Yes, when the public registry or DexScreener/GeckoTerminal search returns them and the classifier admits | Primary live equity universe on Solana today |
| Ondo Stocks | Yes, from the **public** GM mint list + DexScreener/GeckoTerminal names that pass the classifier | Keyed Ondo API is out (403 without a key). Most Ondo mints have no DexScreener pools |
| GeckoTerminal search | Candidate + hydrate priority only | Public, no key, tight rate limits. Volume is still DexScreener. Not a Tessera V feed |
| Tessera V (Wintermute prop-AMM) | **No** | Protocol-level DefiLlama 24h only; no per-mint split. Not invented |
| Tessera PE T-Tokens | Yes, private-market lane | Official docs mint list + `T-SpaceX` / `tSpaceX` naming. Pump.fun copycats fail closed. Not Tessera V |
| Backpack Securities | Yes, when the on-chain name includes `Backpack Securities` | Public names (MU, NKE, SHOP, BA, …) go equity; SPCX stays private; Roundhill Memory ETF (`DRAM`) stays ETF. Candidates come from the public Sunrise token list plus DexScreener/Gecko ticker probes. Pump.fun copycats fail closed. Sunrise is a listing gateway, not a DEX to sum. Backpack CEX / RFQ volume is still out |
| Jupiter Tokens API `tag=stocks` | No | Requires `x-api-key`; unauthenticated calls return 400 |
| tokens.xyz curated stocks | No | Requires API key (`UnauthorizedError`) |
| CoinGecko tokenized-stock / `coins/list` | Not a live candidate source | Public list overlaps xStocks+Ondo; extras had no additional DexScreener pools (and per-coin lookups 429) |
| Solflare UTL search | Not a live candidate source | Public, but long-tail xStock hits were not DexScreener-indexed; would inflate classified without volume |
| Dinari / dShares | No | Not a live public Solana source in this adapter |
| PreStocks / private names | Separate **Private market** tab | Fail-closed (SpaceX, OpenAI, SHEIN, Anduril, …). Not mixed into public ranking. Reported 24h is labeled on the Solana card and added to the Daily Volume headline and DexScreener snapshot history |
| ETF / index xStocks and Ondo ETFs | Separate **ETF / index** tab only | Never mixed into equity ranking |

The registry schema includes `underlying.type` (`Equity` vs `ETF`); live payloads often leave that field null, so name/symbol rules remain the working ETF/commodity filter, and the type is used when present. If discovery or classification yields zero verifiable stocks, the adapter **fails closed** — no invented volume. If the xStocks registry, Ondo list, Tessera docs, or Sunrise list are down, discovery continues from whatever sources still work.

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
SOLANA_TESSERA_REGISTRY_ENABLED=true
SOLANA_TESSERA_REGISTRY_URL=https://docs.tessera.pe/technicals/on-chain-programs.md
SOLANA_SUNRISE_REGISTRY_ENABLED=true
SOLANA_SUNRISE_REGISTRY_URL=https://api.sunrise.xyz
SOLANA_GECKOTERMINAL_ENABLED=true
SOLANA_GECKOTERMINAL_BASE_URL=https://api.geckoterminal.com/api/v2
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_MINT_SUPPLY_ENABLED=true
SOLANA_VOLUME_SNAPSHOT_DIR=data/volume-snapshots
SOLANA_VOLUME_HISTORY_CACHE_MS=1800000
```

Set `SOLANA_XSTOCKS_REGISTRY_ENABLED=false`, `SOLANA_ONDO_REGISTRY_ENABLED=false`, `SOLANA_TESSERA_REGISTRY_ENABLED=false`, or `SOLANA_SUNRISE_REGISTRY_ENABLED=false` to disable those candidate sources. Set `SOLANA_MINT_SUPPLY_ENABLED=false` to leave asset-page supply, market cap, and FDV blank.

### Supply, market cap, and FDV

On the asset page, **circulating supply** and **total supply** are the Solana mint's `getTokenSupply` UI amount (`uiAmountString`). That figure already includes the Token-2022 scaled-UI multiplier, which is the unit DEX prices quote. Raw `amount / 10^decimals` is not used — it drops the multiplier (NVDAx raw was about 321,272 tokens vs UI supply about 321,819).

An SPL mint reports one outstanding supply, and this desk has no lockup indexer, so circulating and total are that same UI amount. For Backed xStocks, Jupiter's circulating and total supplies match this UI amount.

**Market cap** = DEX median price × circulating supply. **FDV** = DEX median price × total supply. The arithmetic is local. DexScreener pair `marketCap` / `fdv` are ignored: liquid NVDAx pools report about price × 1,000 (about $225K) while mint UI supply × the ~$225 DEX price is on the order of $70M. If the mint supply call fails, or the DEX price is missing, the matching stat stays blank. Liquidity and volume are never turned into a market cap. Holder counts are unchanged.

The chain and home lists do not call the RPC. Override the endpoint with `SOLANA_RPC_URL` (default `https://api.mainnet-beta.solana.com`).

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

Search queries (probes, not an admission list): `xStock`, `xStocks`, `tokenized stock`, plus ticker probes such as `Circle xStock` / `Palantir xStock` / `Apple (Ondo Tokenized)` / `PreStocks` / `OpenAI PreStocks` / `Backpack Securities` / `BA - Backpack Securities` … `SNAP - Backpack Securities` / `Nike - Backpack Securities` / `T-SpaceX` because DexScreener search is capped and has no pagination. The generic `Backpack Securities` probe still finds older listed names (NKE, MU, SPCX, …). The **xStocks public registry** is the primary way to discover the broader Backed universe. The **public Ondo GM mint list** is the way to see Ondo mints without a key. The **public Tessera T-Token mint list** is the way to see official Tessera PE mints without a key. The **public Sunrise token list** is the way to see official Backpack Securities mints without relying on capped search (IBM is Sunrise `BMKdM4yU…`, not a DexScreener lookalike). **GeckoTerminal search** is a hydrate hint for names DexScreener text search misses (especially Ondo / Backpack / T-Tokens). Volume stays DexScreener.

**Admitted as equity** only with a verifiable equity signal, for example:

- Name contains `xStock` and a Backed `Xs…` mint
- Phrase like `tokenized stock` / `tokenized equity`
- Explicit equity/stock labels from the source
- Known public-equity issuer keyword (Dinari, dShares, Backed, **Backpack Securities**) plus a ticker-like symbol
- Backed mint convention (`Xs…` + `TSLAx`-style symbol)
- Ondo mint convention (`…ondo` + `TSLAon`-style symbol) or `NVIDIA (Ondo Tokenized)` with that mint suffix
- Live issuer instrument type `Equity` plus a ticker-like symbol, after the reject rules still pass

**Admitted as ETF / index** (separate tab, not the equity ranking) when the same issuer conventions hold and the product is an ETF/index (`SPYx`, `QQQx`, `SPYon`, iShares/Vanguard/VanEck wrappers, leveraged 2x/3x, …).

**Admitted as private market** (separate tab, not the public-equity ranking; reported 24h is in the Daily Volume headline and DexScreener snapshot history) when a private / pre-IPO / PreStocks-style name has a verifiable issuer convention, for example:

- `OpenAI PreStocks` / `SpaceX PreStocks` on a `Pre…` mint
- Private-company xStocks or Ondo wrappers (`SHEINx`, `SPCXx`, `SPCXon`) with the matching mint convention
- Official Tessera T-Tokens (`T-SpaceX` / `tSpaceX` on a non-pump mint)
- Backpack Securities private names (`SpaceX - Backpack Securities` / `SPCX`)
- A generic `PreStocks` basket, a token merely named `SpaceX`, or a copycat PreStocks / T-Token brand on a pump mint is still rejected

**Excluded** (fail closed):

- Ordinary crypto and wrapped natives (SOL, BONK, JUP, …)
- Stablecoins (USDC, USDT, USDY, …)
- Commodities (gold, oil, PAXG, …)
- Unrelated RWAs, generic “xStocks” / “Tokenized Equity” / “PreStocks” baskets, and unverifiable tickers (a token named `Tesla` or `SpaceX` is not enough)
- Copycat `xStock` / Ondo / PreStocks / `Backpack Securities` names whose mint does not use the issuer convention (including pump.fun Backpack copycats)

Listed operating companies whose names contain “Gold” or “Real Estate” (Royal Gold, Laopu Gold, Wharf Real Estate, Nasdaq Inc.) can be admitted when they are verifiable xStocks. A token that *is* gold/silver as the product (`Gold xStock`) is still excluded.

Volume = sum of returned pair `volume.h24` for that mint across every Solana pool on the chain page. Home may show DexScreener primary-pair volume until that full snapshot is cached. A DexScreener pair is never treated as one stock. Duplicate `pairAddress` values are dropped. Null/unknown volume stays null and ranks last; a reported `0` is a real zero. Tessera V protocol-wide Dex volume is not a stock series.

The UI says **why** volume is missing: no indexed pools, pools without reported 24h volume, fetch failure, or hydrate still running.

Different mints for the same ticker (Tesla xStock vs Tesla Ondo) stay **separate** stock rows. Issuer/provider is shown when the classifier can infer it. Each row keeps mint, symbol, name, pool count, per-pool volume/liquidity/price, aggregate 24h volume, displayed liquidity, and provenance.

Robinhood marks stay null on Solana. Off-Solana pairs are ignored.

## Daily volume

**Daily Volume** is per-day USD volume, not a running total and not TVL.

| | |
| --- | --- |
| **Definition** | Closed desk **DexScreener 24h snapshots** only (public + private + ETF/index, `sumNullable`; null omitted, not zero). The Total Daily Tokenized Stock Volume series does not add a live rolling-24h tip for the in-progress Eastern day. Headline sums are the plotted snapshot days |
| **Universe** | Same fail-closed classifier as the rest of the desk. Public ranking stays public-equity only. The Daily Volume series is the combined public + private + ETF/index 24h |
| **Why snapshots** | DexScreener’s public API is snapshot-only (no pair history). Each recorded day is the America/New_York calendar date of that snapshot window. Days before snapshots began have **no series** — past DexScreener totals are not invented from GeckoTerminal |
| **Honesty** | Gap days are omitted, not plotted as **$0**. A source-reported `0` is kept. Null DexScreener 24h is never coerced to zero. The in-progress America/New_York day is omitted until that date has closed — a rolling 24h row written during the day is not a closed snapshot, and a UTC date that New York has not reached is never plotted. A seed adapter with no snapshots yields an **empty chart**, never invented nonzero points |
| **Coverage** | One combined point per Eastern calendar day this desk recorded (`data/volume-snapshots/solana.json` by default). GeckoTerminal remains a candidate source and per-asset **price** candles only |

Daily cron / agent should run `SOLANA_MARKET_ENABLED=true npm run snapshot:volume` (same DexScreener all-pools desk 24h; no Gecko backfill).

The seed adapter does **not** draw a demo series.

## Trust labeling

- Persistent disclaimer in the site footer only (no gold trust card; provenance on pages is a thin source · time line)
- Home / Solana chain: **Daily Volume** chart (title + series + range chips + one definition line). No Key Metrics row
- Solana coverage is a single muted line; table chips still filter All / with-volume / confirmed-no-pools / pinned, plus **issuer** (`?issuer=ondo`, case-insensitive, derived from the current lane). Rank # is the current filtered view.
- Solana desk jump (`/` or ⌘K) searches symbol, name, issuer, and mint with collision-safe deep links. Stars pin mints in `localStorage` (`sotb.solana.favoriteMints.v1`); pinned rows float to the top, or filter with `?pinned=1`. Two or more pins open a compare strip. Export CSV downloads the current filtered+sorted lane (null volume stays blank). TSLAx and TSLAon stay separate.
- Solana chain list defaults to **With volume**, ranked by coverage tier then aggregate 24h volume (nulls last). Click column headers to change sort. Warm navigations show skeletons instead of an empty table.
- **Reported** vs **Interpretive** badges on metrics
- Displayed liquidity is never described as buy capacity
- No arb, profitability, or “you can trade this on Robinhood” copy

## Out of scope

Wallets, signing, trading, bots, continuous agents, news/RAG, edits to Terminal or BotDawg, merging different mints into one underlying-ticker row, and a full Solana/L2 indexer.
