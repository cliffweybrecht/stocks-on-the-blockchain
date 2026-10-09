# Lending snapshots

One America/New_York day per file. The schema is `equity-lending-v1`.

When Morpho or Aave publishes each loan, the row's `loanHealth` stores bucketed health (how much stock crosses the line at each whole-percent drop), not wallets. Kamino, Jupiter, Lista, and Venus do not publish a market-wide loan list, so those rows store `method: "pool"` and the desk says so. Aave's per-token borrowing limit is `maxLtv` on each c-token.

```bash
npm run snapshot:lending
```

Success prints nothing and exits 0. A capture with no amounts is not written and exits 1.

The command needs network access to the venue APIs. No API key is required.

Optional environment:

- `BSC_RPC_URL` — tried first for Lista collateral balances and the Venus log scan. When it is unset, public BSC endpoints are used in order.
- `VENUS_SCAN_BUDGET_MS` — milliseconds the Venus pro-rata scan may run before the previous estimate is kept. The default is 60 minutes, which covers a cold scan from BSC block 104,000,000. A later run reads the cache and only scans blocks after the last finished range.

`venus-holder-cache.json` in this directory (`venus-holder-cache-v1`) stores finished Transfer-log ranges and the holder addresses found in them. It is not a snapshot day. The desk does not read it.

New day files match `YYYY-MM-DD.json` and are gitignored until you force-add them:

```bash
git add -f data/lending-snapshots/YYYY-MM-DD.json
```
