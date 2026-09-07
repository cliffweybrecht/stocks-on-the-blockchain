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

With `TERMINAL_BASE_URL` unset, the **seed adapter** shows four demo chains (Robinhood Chain, Solana, Ethereum, Base) so the drill-down works without any live service.

### Live Terminal

Terminal is one optional, read-only HTTP source. This repo does not modify Terminal.

```bash
TERMINAL_BASE_URL=http://127.0.0.1:3000 npm run dev -- --port 43147
```

The live adapter calls `GET {TERMINAL_BASE_URL}/api/market/liquidity` and maps each row into the multi-chain model as **one honest chain**: `robinhood-chain` (native id `4663`). If Terminal is down or a cold snapshot times out, the UI shows an error instead of fabricating numbers.

Optional per-asset enrichment (best-effort, never required):

- `GET /api/assets/{symbol}/liquidity`
- `GET /api/assets/{symbol}/price`

### Scripts

```bash
npm run dev      # development server
npm run build    # production build
npm run typecheck
npm test
```

## Architecture

`MarketDataSource` is the only way pages load market data:

| Adapter | When | What you see |
| --- | --- | --- |
| `MockMarketDataSource` | `TERMINAL_BASE_URL` empty | Multi-chain demo snapshot |
| `TerminalMarketDataSource` | `TERMINAL_BASE_URL` set | Robinhood Chain only, structured for more adapters later |

Terminal fields consumed from the market-liquidity shape:

- `observedVolume24h`
- `displayedLiquidityUsd`, `usdGLiquidityUsd`
- `poolCount`, `dexCount`
- `robinhoodReferencePriceUsd`, `dexMedianPriceUsd`, `dexLiquidityWeightedPriceUsd`, `premiumDiscountPct`
- contract address, symbol, name
- freshness: `generatedAt`, `refreshStartedAt`, `refreshDurationMs`, `cache`

Chain volume is the sum of reported `observedVolume24h` values. Nulls are skipped, never coerced to `0`.

## Trust labeling

- Persistent disclaimer on every page
- **Reported** vs **Interpretive** badges on metrics
- Displayed liquidity is never described as buy capacity
- No arb, profitability, or “you can trade this on Robinhood” copy

## Out of scope (V1)

Wallets, signing, trading, bots, continuous agents, news/RAG, and any edits to Terminal or BotDawg.
