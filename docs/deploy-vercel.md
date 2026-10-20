# Deploy on Vercel

Public site: https://stocksontheblockchain.com

Cliff approves merges. This is the build checklist for that project.

## Build

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm run build` (`next build`)
- Node.js: **22.x** (Next.js 16 requires Node `>=20.9.0`)

Set Node.js 22.x in the Vercel project settings. Geist ships in the `geist` package, so the build does not call Google Fonts.

## Environment variables

Set these names in Vercel. Do not commit values.

### Hide Perps and Lending

Leave both unset for local dev (`npm run dev`, port 43147). Unset means those desks stay visible.

Either variable hides them. A change needs a redeploy.

- `NEXT_PUBLIC_HIDE_SECTIONS` — comma-separated list. Use `perps`, `lending`, or `perps,lending`.
- `PUBLIC_SITE` — `1`, `true`, or `yes` hides both desks.

For stocksontheblockchain.com, set one of them so `/perps` and `/lending` 404 and the nav, home card, and sitemap omit those desks.

### Read by the running site

DexScreener and GeckoTerminal do not use an API key. `SOLANA_RPC_URL` and `TERMINAL_BASE_URL` are optional and may embed a provider credential. Names only:

- `SOLANA_MARKET_ENABLED`
- `SOLANA_DEXSCREENER_BASE_URL`
- `SOLANA_TIMEOUT_MS`
- `SOLANA_REQUEST_GAP_MS`
- `SOLANA_MAX_CONCURRENT`
- `SOLANA_CACHE_MS`
- `SOLANA_HOME_BUDGET_MS`
- `SOLANA_FULL_BUDGET_MS`
- `SOLANA_ENRICH_BUDGET_MS`
- `SOLANA_EMPTY_CACHE_MS`
- `SOLANA_VOLUME_HISTORY_CACHE_MS`
- `SOLANA_VOLUME_SNAPSHOT_DIR`
- `SOLANA_CARD_VOLUME_SERIES_MAX`
- `SOLANA_GECKOTERMINAL_ENABLED`
- `SOLANA_GECKOTERMINAL_BASE_URL`
- `SOLANA_XSTOCKS_REGISTRY_ENABLED`
- `SOLANA_XSTOCKS_REGISTRY_URL`
- `SOLANA_ONDO_REGISTRY_ENABLED`
- `SOLANA_ONDO_REGISTRY_URL`
- `SOLANA_TESSERA_REGISTRY_ENABLED`
- `SOLANA_TESSERA_REGISTRY_URL`
- `SOLANA_SUNRISE_REGISTRY_ENABLED`
- `SOLANA_SUNRISE_REGISTRY_URL`
- `SOLANA_SECURITIZE_REGISTRY_ENABLED`
- `SOLANA_SECURITIZE_REGISTRY_URL`
- `SOLANA_JUPITER_TOKEN_LOGOS_ENABLED`
- `SOLANA_JUPITER_TOKEN_URL`
- `SOLANA_JUPITER_HOLDERS_ENABLED`
- `SOLANA_PAIR_HOLDERS_ENABLED`
- `SOLANA_DEXSCREENER_IO_BASE_URL`
- `SOLANA_RPC_URL`
- `SOLANA_MINT_SUPPLY_ENABLED`
- `TERMINAL_BASE_URL`
- `TERMINAL_TIMEOUT_MS`

Unset `SOLANA_MARKET_ENABLED` still serves the committed snapshot JSON. The live adapter is optional.

### Snapshot jobs only

The Vercel site process does not read these. Nightly jobs on a writable checkout do.

- `BSC_RPC_URL`
- `VENUS_SCAN_BUDGET_MS`
- `LENDING_SNAPSHOT_DATE`
- `SNAPSHOT_DATE`
- `HOURLY_TARGET_HOUR`
- `SNAPSHOT_HOUR`
- `GECKO_HOURLY_CACHE`

## What the deploy serves

Pages use `revalidate` of 3600 seconds. A commit of the nightly snapshot files to `main` redeploys and refreshes that data immediately.

The runtime filesystem is read-only. Page loads and API routes read committed JSON under `data/`. They do not write `data/volume-snapshots`, `data/perps-snapshots`, or `data/lending-snapshots`. Optional Gecko progress files under `data/cache/` are gitignored; a failed write is ignored and the page still renders the stored series.

DexScreener and GeckoTerminal fetches abort (`SOLANA_TIMEOUT_MS`, default 12 seconds, plus the same 12 second cap on the Robinhood, Base, and BNB desk calls). Home and chain pages fall back to the last closed snapshot, so a timeout does not blank the page.
