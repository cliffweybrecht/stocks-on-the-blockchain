# Volume snapshots

Daily desk volume is a DexScreener `volume.h24` sample taken near the end of the America/New_York calendar day. It is not a trade-level sum and not a GeckoTerminal daily bar. Null volume is omitted, not stored as $0. A missing day stays a gap.

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
| Lending | `npm run snapshot:lending` | `data/lending-snapshots/YYYY-MM-DD.json` |

`scripts/snapshot-bnb-volume.py` and `scripts/snapshot-robinhood-volume.py` are on `main`, same as the Base and Solana writers. Nightly runs use those writers, then land only the JSON row. Closed-day rows keep the lane totals and add `assets[]` (address, symbol, issuer when known, instrumentKind, volume24hUsd, displayedLiquidityUsd, pools). Hourly files stay totals only.

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

1. Commit only that chain's snapshot JSON when it is dirty (`data/volume-snapshots/<chain>.json`, or `data/perps-snapshots/perps.json` for `--chain perps`). Subject: `chore: <Chain> volume snapshot YYYY-MM-DD`. Any other dirty path is refused. The add is `git add -f` because snapshot JSON is gitignored until tracked.
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

Equity perps are a separate file (`data/perps-snapshots/perps.json`, schema `equity-perps-v1`) and a separate desk. The writer is `npm run snapshot:perps`. It stores per-venue, per-market 24h volume, open interest, and funding when a feed reports it, for single stocks, equity ETFs, leveraged ETFs, equity indices, and pre-IPO (pre-IPO stays out of the headline). It does not add anything to Solana, Base, BNB, or Robinhood spot totals. Tiers are onchain, major CEX, Binance+Bybit, and long-tail. Long-tail is opt-in on the desk. A venue that fails the volume/OI screen (`credible: false`) is stored and left out of the headline. Older rows without `credible` stay in the headline. The schema id does not change, so `snapshot:land` still treats a new Eastern day as an append. Ostium keeps lifetime volume; a daily number is derived only when the previous Eastern date has a snapshot. Hyperliquid hourly candles are base size, not USD, so that venue stays on rolling `dayNtlVlm`. Land with `--chain perps`. The commit subject is still `chore: Perps volume snapshot YYYY-MM-DD`.

Lending is a separate Eastern-day file (`data/lending-snapshots/YYYY-MM-DD.json`, schema `equity-lending-v1`) and a separate desk at `/lending`. The writer is `npm run snapshot:lending`. It does not add anything to spot or perp totals, and it does not use `snapshot:land`. A source that fails stays null on that row. The command prints nothing when the file is written.

Solana hourly does not use this script (the row key is an hour, and the commit subject is `data: Solana hourly …`). The hourly routine opens a PR, tries `origin pr merge`, then runs the same `git merge --no-ff` / push `main` / comment-and-close fallback. Solana daily can use either that prompt or `snapshot:land --chain solana --push-main`.
