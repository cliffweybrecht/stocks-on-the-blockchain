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

### Live Solana (xStocks allowlist)

```bash
SOLANA_MARKET_ENABLED=true npm run dev -- --port 43147
```

Uses DexScreener’s public `GET /tokens/v1/solana/{mints}` endpoint (no API key). Only a curated Backed xStock mint list is accepted. Unknown Solana tokens are dropped. If DexScreener errors or returns a non-pair payload, the Solana adapter **fails closed** — no invented volume.

Override the API host only if you have a proxy:

```bash
SOLANA_MARKET_ENABLED=true
SOLANA_DEXSCREENER_BASE_URL=https://api.dexscreener.com
SOLANA_TIMEOUT_MS=15000
```

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
| `SolanaMarketDataSource` | `SOLANA_MARKET_ENABLED=true` | Solana xStocks from DexScreener |
| `CompositeMarketDataSource` | two or more live adapters | Merged, ranked chain list |

Each chain and asset carries `sourceId` / `sourceLabel`. Composite provenance also lists per-adapter failures.

Solana mapping rules:

- Only allowlisted Backed xStock mints (`Xs…` addresses in `src/lib/market/solana-allowlist.ts`)
- Volume = sum of returned pair `volume.h24` (null if none reported)
- Displayed liquidity = sum of returned pair `liquidity.usd`
- Robinhood marks stay null on Solana
- Off-allowlist and non-Solana pairs are ignored

## Trust labeling

- Persistent disclaimer on every page
- **Reported** vs **Interpretive** badges on metrics
- Displayed liquidity is never described as buy capacity
- No arb, profitability, or “you can trade this on Robinhood” copy

## Out of scope

Wallets, signing, trading, bots, continuous agents, news/RAG, edits to Terminal or BotDawg, and a full Solana/L2 indexer.
