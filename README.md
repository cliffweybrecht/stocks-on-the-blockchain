# Stocks on the Blockchain

Read-only desk for **tokenized / on-chain stocks**. The path is deliberate:

1. **How much volume each chain is running**
2. **Top stocks on that chain**
3. **One asset**: identity, volume, displayed liquidity, RH vs DEX marks, pools, provenance

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

Uses DexScreener’s public API (no API key) plus the public **xStocks / Backed** asset registry. The Solana adapter is a pipeline, not a mint allowlist:

1. **Discover** candidates from:
   - live `GET https://api.xstocks.fi/api/v2/public/assets?network=Solana` (paginated; not an admission list)
   - DexScreener `GET /latest/dex/search?q=…` (category/issuer probes; search is capped)
2. **Classify** each Solana mint fail-closed as a tokenized public equity
3. **Hydrate** pools in two DexScreener steps:
   - `GET /tokens/v1/solana/{mints}` in batches of 30 to see which discovered mints have any DEX market
   - `GET /token-pairs/v1/solana/{mint}` for each active mint so **every Solana pool** is included (the batch endpoint only returns one primary pair)
4. **Aggregate** those pools into one stock row keyed by mint. Classified mints with no DexScreener pools still appear, with null volume (ranked last)

The historical Backed xStock mint list in `src/lib/market/solana-allowlist.ts` is a **test fixture only**. It is not a production admission gate.

Coverage is **as discoverable from the live xStocks registry + DexScreener search + the classifier**, not a full Solana index. Search results are noisy and capped (~30 pairs per query, no page cursor); the registry is the main way to see beyond that window. Most registry names have **no DexScreener pools** and therefore appear with null volume (ranked last). The registry schema includes `underlying.type` (`Equity` vs `ETF`); live payloads often leave that field null, so name/symbol rules remain the working ETF/commodity filter, and the type is used when present. Ondo and other issuers are included only if they appear in those live sources and pass the classifier (their keyed/private APIs are not used). If discovery or classification yields zero verifiable stocks, or DexScreener hydrate errors, the adapter **fails closed** — no invented volume. If the xStocks registry is down, discovery continues from DexScreener search alone.

Override hosts only if you have a proxy:

```bash
SOLANA_MARKET_ENABLED=true
SOLANA_DEXSCREENER_BASE_URL=https://api.dexscreener.com
SOLANA_TIMEOUT_MS=15000
SOLANA_REQUEST_GAP_MS=200
SOLANA_XSTOCKS_REGISTRY_URL=https://api.xstocks.fi/api/v2
SOLANA_XSTOCKS_REGISTRY_ENABLED=true
```

Set `SOLANA_XSTOCKS_REGISTRY_ENABLED=false` to disable the live registry and use DexScreener search only.

### Terminal + Solana together

```bash
TERMINAL_BASE_URL=http://127.0.0.1:3000
SOLANA_MARKET_ENABLED=true
npm run dev -- --port 43147
```

`CompositeMarketDataSource` merges the two adapters. The home page ranks every returned chain by `volume24hUsd` (nulls last). If Solana is down, Robinhood Chain still renders and provenance lists the Solana failure. If both fail, the desk shows an error instead of fabricating a ranking.

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

Search queries (probes, not an admission list): `xStock`, `xStocks`, `tokenized stock`, `tokenized equity`, `tokenized share`, `tokenised stock`, `backed xstock`, plus single-name probes such as `Tesla xStock` / `Apple xStock` / `Microsoft xStock` / `Robinhood xStock` because DexScreener search is capped and has no pagination. The **xStocks public registry** is the primary way to discover the broader Backed universe (`GET /public/assets?network=Solana`, paginated). Registry `underlying.type` (`Equity` vs `ETF`) is a classifier signal from the issuer, not a mint allowlist. Search remains a fallback and a path for any non-Backed names DexScreener happens to return.

**Admitted** only with a verifiable equity signal, for example:

- Name contains `xStock`
- Phrase like `tokenized stock` / `tokenized equity`
- Explicit equity/stock labels from the source
- Known public-equity issuer keyword (Dinari, dShares, Backed) plus a ticker-like symbol
- Backed mint convention (`Xs…` + `TSLAx`-style symbol)
- Live issuer instrument type `Equity` plus a ticker-like symbol, after the reject rules still pass

**Excluded** (fail closed):

- Ordinary crypto and wrapped natives (SOL, BONK, JUP, …)
- Stablecoins (USDC, USDT, …)
- Commodities (gold, oil, PAXG, …)
- Unrelated RWAs, pre-IPO / PreStocks, private-company names (SpaceX, xAI, OpenAI, …), generic “xStocks” / “Tokenized Equity” baskets, and unverifiable tickers (a token named `Tesla` is not enough)
- Copycat `xStock` names whose mint does not use Backed’s `Xs…` convention
- ETFs and index products (`SPYx`, `QQQx`, `TQQQx`, iShares/Vanguard/VanEck wrappers, leveraged 2x/3x, ultra-short income funds, “Gold xStock”, …) unless a future category explicitly supports them
- Private-company names even when they use xStock branding (SpaceX, SHEIN, xAI, OpenAI, …)

Listed operating companies whose names contain “Gold” or “Real Estate” (Royal Gold, Laopu Gold, Wharf Real Estate, Nasdaq Inc.) can be admitted when they are verifiable xStocks. A token that *is* gold/silver as the product (`Gold xStock`) is still excluded.

Volume = sum of returned pair `volume.h24` for that mint across every Solana pool. A DexScreener pair is never treated as one stock. Duplicate `pairAddress` values are dropped. Null/unknown volume stays null and ranks last; a reported `0` is a real zero.

Different mints for the same ticker (two Tesla issuers) stay **separate** stock rows. Issuer/provider is shown when the classifier can infer it. Each row keeps mint, symbol, name, pool count, per-pool volume/liquidity/price, aggregate 24h volume, displayed liquidity, and provenance.

Robinhood marks stay null on Solana. Off-Solana pairs are ignored. Snapshots are cached briefly (~60s). Requests are spaced (`SOLANA_REQUEST_GAP_MS`) so DexScreener is not hammered.

## Trust labeling

- Persistent disclaimer on every page
- **Reported** vs **Interpretive** badges on metrics
- Displayed liquidity is never described as buy capacity
- No arb, profitability, or “you can trade this on Robinhood” copy

## Out of scope

Wallets, signing, trading, bots, continuous agents, news/RAG, edits to Terminal or BotDawg, merging different mints into one underlying-ticker row, and a full Solana/L2 indexer.
