# Holder and supply snapshots

Nightly holder counts and token supply for the tokenized stocks the desk already covers. This file is not volume. A missing number stays null. Nothing is estimated.

The row `date` is the America/New_York calendar date (`YYYY-MM-DD`). `t` is the same civil-date instant the volume files use (`utcInstantForDayKey`). The routine is 11:59 PM Eastern:

```cron
CRON_TZ=America/New_York
59 23 * * *
```

At 11:59 PM Eastern, UTC is already the next calendar day. The day key is still the Eastern date. `HOLDER_SNAPSHOT_DATE=YYYY-MM-DD` forces that key only. It does not invent a count.

Commands and landing are listed in `docs/volume-snapshots.md`.

## What each asset stores

`address`, `symbol`, `issuer`, `instrumentKind`, `totalSupplyRaw`, `totalSupplyDecimals`, `totalSupply` (decimal-adjusted), `supplyUsd`, `holderCount`, `sources` for supply, supplyUsd, holders, and price, `notes` when a field is null, and `capturedAt`.

`supplyUsd` is decimal-adjusted supply times the DexScreener price already on the desk asset (`dexMedianPriceUsd`). A missing price or supply leaves `supplyUsd` null.

Chain `holderCount` is the sum of per-token holder counts. It is not unique wallets. A null token is omitted from the sum, not stored as zero. The same rule applies to `supplyUsd`.

A day that was not captured is an empty chart slot. The change over 24H, 7D, 14D, or 30D adds only pairs of consecutive Eastern days that both have a real snapshot. A gap adds nothing.

## Sources

| Chain | Supply | Holders |
| --- | --- | --- |
| Solana | Public RPC `getTokenSupply` (`SOLANA_RPC_URL`, default `https://api.mainnet-beta.solana.com`) | Public RPC `getProgramAccounts` on the mint's owner program |
| Base (8453) | `eth_call` `totalSupply()` and `decimals()` on `https://mainnet.base.org` | GeckoTerminal `holders.count` |
| BNB Chain (56) | `eth_call` on `https://bsc-dataseed.binance.org` | GeckoTerminal `holders.count` |
| Robinhood Chain (4663) | `eth_call` on `https://rpc.mainnet.chain.robinhood.com` | GeckoTerminal `holders.count` |

### Solana supply

`totalSupplyRaw` is the mint `amount`. `totalSupplyDecimals` is `decimals`. `totalSupply` is `uiAmountString`. That string includes a Token-2022 scaled UI multiplier. DexScreener prices that UI unit, so `amount / 10^decimals` is not used when the string is present. An unreadable string leaves `totalSupply` null.

### Solana holders

The mint account's owner selects the program: SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` or Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. The call filters with `memcmp` of the mint at offset 0 and `dataSlice` of the 8-byte amount at offset 64. There is no `dataSize` filter, so Token-2022 extension accounts are not dropped. Non-zero amounts are counted. An empty account list is zero. An RPC error is null.

Limits: this is token accounts for that mint, including program-owned accounts, not unique wallets. The public RPC can refuse or time out a large mint. That mint stays null. The census is not copied from Jupiter or from a pool's LP holder count.

### EVM supply

`totalSupplyRaw` is the `totalSupply()` integer. `totalSupply` is that integer divided by `10^decimals`. If `decimals()` is missing, the raw integer is kept and the adjusted supply is null, so `supplyUsd` is null.

### EVM holders

Blockscout is the explorer for Base (`base.blockscout.com`) and the official explorer for Robinhood Chain (`robinhoodchain.blockscout.com`). From the snapshot host those APIs answer with a Cloudflare challenge, not a holder count. Routescan `tokenholdercount` works on chains it indexes (verified on Avalanche C-Chain) and returns `chain not supported` for 8453, 56, and 4663. Public Basescan and Etherscan holder endpoints are paid or also challenged. Those paths are not used.

The count that is stored is GeckoTerminal token-info `holders.count` (`base`, `bsc`, `robinhood`). That is the same integer the asset page already shows. It is an indexer's count, not a fresh enumeration of `Transfer` logs. A missing or non-integer count stays null. Distribution fields on the same payload are ignored.

The public API allows about 30 calls a minute, and this host stays under the limit that actually answers: token-info reads go out one at a time, at least 6.5 seconds apart, and HTTP 429 is retried. A 429 is not stored as a missing count until those retries are exhausted. HTTP 404, and a 200 whose `holders.count` is null, are real nulls.

## Universe

The writer uses the desk's existing loaders and does not add tokens:

- Solana: the live classified desk (`getChain("solana")`), with `SOLANA_MARKET_ENABLED=true`
- Base: `loadBaseChainMarkets`
- BNB Chain: `loadBnbChainMarkets`
- Robinhood Chain: `loadRobinhoodChainMarkets`

Each row keeps that loader's address, symbol, issuer, instrument kind, and DexScreener price.
