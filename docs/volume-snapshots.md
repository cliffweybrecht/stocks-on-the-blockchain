# Volume snapshots

Daily desk volume for Solana, Robinhood, BNB, and Base is the sum of GeckoTerminal hourly USD candles whose open falls in that America/New_York day (midnight through the next midnight). Each pool counts once. DexScreener token-pairs plus the known-pools list, and GeckoTerminal token pools for addresses DexScreener does not list, are the pool set. If the candle read fails, that pool keeps its DexScreener all-pools `volume.h24` and the row is tagged. Null volume is omitted, not stored as $0. A day is not left blank when either source reported a number. When the DexScreener and Gecko totals differ by more than 5%, both are stored and the row is tagged.

The row `date` is that Eastern `YYYY-MM-DD`. `t` is unix time for midnight on that date in `America/New_York`.

Routines fire at end of day:

```cron
CRON_TZ=America/New_York
59 23 * * *
```

At 11:59 PM Eastern, UTC is already the next calendar day. The day key is still the Eastern date.

## Writers

| Chain | Command | File |
| --- | --- | --- |
| Solana daily | `SOLANA_MARKET_ENABLED=true npm run snapshot:volume` | `data/volume-snapshots/solana.json` |
| Solana hourly | `HOURLY_TARGET_HOUR=YYYY-MM-DDTHH SOLANA_MARKET_ENABLED=true npm run snapshot:volume:hourly` | `data/volume-snapshots/solana-hourly.json` |
| Base | `BASE_SNAPSHOT_DATE=YYYY-MM-DD npm run snapshot:base-volume` | `data/volume-snapshots/base.json` |
| BNB | `BNB_SNAPSHOT_DATE=YYYY-MM-DD npm run snapshot:bnb-volume` | `data/volume-snapshots/bnb.json` |
| Robinhood | `ROBINHOOD_SNAPSHOT_DATE=YYYY-MM-DD npm run snapshot:robinhood-volume` | `data/volume-snapshots/robinhood.json` |
| Equity perps | `npm run snapshot:perps` | `data/perps-snapshots/perps.json` |
| Lending | `LENDING_SNAPSHOT_DATE=YYYY-MM-DD npm run snapshot:lending` | `data/lending-snapshots/YYYY-MM-DD.json` |

`scripts/snapshot-bnb-volume.py` and `scripts/snapshot-robinhood-volume.py` are on `main`, same as the Base and Solana writers. Nightly runs use those writers, then land only the JSON row. Closed-day rows keep the lane totals and add `assets[]` (address, symbol, issuer when known, instrumentKind, volume24hUsd, displayedLiquidityUsd, pools). Hourly files stay totals only.

Displayed liquidity uses one sanity guard (`src/lib/market/liquidity-sanity.ts`, `scripts/snapshot_asset_rows.py`). Solana applies it in the nightly asset writer. Robinhood and BNB apply it through `assets_for`. A pool is left out of `displayedLiquidityUsd` when its liquidity is above $50M and its 24h volume is below 0.01% of that liquidity. A missing volume counts as no trading. The same helper also drops a pool above 20× the asset's next-largest pool when that pool is also above 10× a known market value, and it uses a GeckoTerminal `reserve_in_usd` when that reserve is under 10% of the reported figure. Excluded pools stay on the asset as `excludedLiquidityPools` (pool id, raw liquidity, reason). Volume is unchanged. When every reported reserve is excluded, `displayedLiquidityUsd` is 0 so a reader does not sum the raw pool instead. Stored rows that were rewritten keep the previous displayed total on the asset `correction`.

Solana's nightly writer calls `captureFullChain` (every token-pairs pool, not a warm light preview) and then GeckoTerminal token pools for addresses DexScreener missed. Robinhood and BNB do the same from their Python writers: token-pairs, the known-pools list, and GeckoTerminal token pools, including PancakeSwap Infinity and Uniswap v4. New pool addresses are written back to `data/volume-known-pools/`. Perps stay out of the spot lanes. The closed day prefers the Eastern candle sum and falls back to DexScreener h24.

Base counts DexScreener `token-pairs/v1/base` plus GeckoTerminal `networks/base/tokens/{token}/pools`. Pools DexScreener does not list, including Uniswap v4, are merged into `data/volume-snapshots/base-pools.json`. That file is the pool-list cache (`geckoPoolsFetchedAt`, reused for seven days) so the nightly run stays on the hourly-candle fetch. A pool with no GeckoTerminal candles keeps that pool's DexScreener `h24` and is listed on `dexscreenerH24Fallbacks`. Rows from the Gecko hourly window carry `windowSource: geckoterminal-hourly-et-day`. A pool quoted in a meme or other non-cash token is kept. A stock-versus-stock pool counts once, on the base token.

BNB still keeps `data/volume-snapshots/bnb-pools.json`. The nightly universe is the bStocks seed (including BNCB), plus every mint already stored for that issuer and lane, plus live discovery. A stock-versus-stock pool counts once. Days 2026-09-23 through 2026-10-08 were rebuilt from GeckoTerminal hourly bars over every pool on the America/New_York day. The replaced dollars stay on `correction`. Days 2026-10-09 through 2026-10-13 keep the rows the cash-quote writer already landed. The 2026-10-11 row still includes the restored BNCB print.

Solana hourly is a rolling h24 total for one Eastern hour, not a closed day. Its job prompt already lands the row. Do not append hourly rows to `solana.json`.

## Landing on main

Snapshot JSON should reach `main` the same night. `npm run snapshot:land` is the path Base, BNB, Robinhood, and Solana daily routines use once it is on `main`.

```bash
npm run snapshot:land -- --chain bnb --push-main
npm run snapshot:land -- --chain base --push-main
npm run snapshot:land -- --chain robinhood --push-main
npm run snapshot:land -- --chain solana --push-main
npm run snapshot:land -- --chain perps --push-main
```

`--push-main` does all of the following:

1. Commit that chain's snapshot JSON when it is dirty (`data/volume-snapshots/<chain>.json`, or `data/perps-snapshots/perps.json` for `--chain perps`). BNB also commits `data/volume-snapshots/bnb-pools.json` when that registry is dirty. Subject: `chore: <Chain> volume snapshot YYYY-MM-DD`. Any other dirty path is refused. The add is `git add -f` because snapshot JSON is gitignored until tracked. Pool registries are snapshot JSON and are not daily rows, so they do not have to be append-only.
2. Refuse the land unless the diff versus `origin/main` is snapshot JSON, every commit subject matches `chore: … volume snapshot YYYY-MM-DD`, and every date already on `main` is unchanged. New days may fill a gap. A PR that only repeats dates already on `main` is refused.
3. Push the branch and open a ready PR (or reuse the open one for that head).
4. Try `origin pr merge`. Origin often rejects the agent token.
5. If that did not put the snapshot commit on `origin/main`: `git checkout main`, `git merge --ff-only origin/main`, `git merge --no-ff <branch>`, `git push origin main`. Never force-push.
6. Comment on the PR with the merge commit SHA and close it.

An already-open snapshot PR (including a draft) can be landed the same way:

```bash
npm run snapshot:land -- --pr 371
```

`--pr` also allows a `src/**/*.test.ts` assertion update in the same diff. It still refuses feature PRs and any edit to a day that is already on `main`.

Check a branch without pushing:

```bash
npm run snapshot:land -- --check
```

Equity perps are a separate file (`data/perps-snapshots/perps.json`, schema `equity-perps-v2`) and a separate desk. The writer is `npm run snapshot:perps`. A stored day is compact: per-venue category buckets (volume, open interest, market count, funding volume), credibility, source, tier, and a fresh/stale/failed mark, plus a capped ticker list, per-venue books for the top names, the equity name set used for listing diffs, and Ostium lifetime by symbol. It does not store the per-market book. A failed venue is kept with a blank volume, not a zero. If the encoded day would pass 140KB, per-venue books are dropped first, then the name set. `equity-perps-v1` rows migrate on read. JSON downloads at `/perps/downloads/daily.json`, `venues.json`, and `tickers.json` mirror the CSVs. `snapshot:land --chain perps` accepts that migration and then appends new days; spot chains stay append-only. Every chain's `git show` and `git diff` writes git stdout to a temporary file, so Node's 1 MiB child-process buffer does not apply. It does not add anything to Solana, Base, BNB, or Robinhood spot totals. Tiers are onchain, major CEX, Binance+Bybit, and long-tail. Long-tail is opt-in on the desk. A venue that fails the volume/OI screen (`credible: false`) is stored and left out of the headline. Older rows without `credible` stay in the headline. Ostium keeps lifetime volume; a daily number is derived only when the previous Eastern date has a snapshot. Hyperliquid hourly candles are base size, not USD, so that venue stays on rolling `dayNtlVlm`. Land with `--chain perps`. The commit subject is still `chore: Perps volume snapshot YYYY-MM-DD`.

Lending is a separate Eastern-day file (`data/lending-snapshots/YYYY-MM-DD.json`, schema `equity-lending-v1`) and a separate desk at `/lending`. The writer is `npm run snapshot:lending`. `LENDING_SNAPSHOT_DATE` (or `SNAPSHOT_DATE` when the lending-specific variable is unset) forces that Eastern day key only. `capturedAt` stays the capture instant. With neither set, the file is the America/New_York date of the capture. It does not add anything to spot or perp totals, and it does not use `snapshot:land`. A source that fails stays null on that row. The command prints nothing when the file is written.

Solana hourly does not use this script (the row key is an hour, and the commit subject is `data: Solana hourly …`). The hourly routine opens a PR, tries `origin pr merge`, then runs the same `git merge --no-ff` / push `main` / comment-and-close fallback. Solana daily can use either that prompt or `snapshot:land --chain solana --push-main`.
