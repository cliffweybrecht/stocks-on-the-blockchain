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

`address`, `symbol`, `issuer`, `instrumentKind`, `totalSupplyRaw`, `totalSupplyDecimals`, `totalSupply` (decimal-adjusted), `priceUsd`, `supplyUsd`, `holderCount`, `sources` for supply, supplyUsd, holders, and price, `notes` when a field is null, and `capturedAt`.

`priceUsd` is the desk DexScreener price (`dexMedianPriceUsd`). `supplyUsd` is that price times `circulatingSupply`. That product is the onchain market value. A missing price or supply leaves both `supplyUsd` and the matching lane total null.

`circulatingSupply` is the outstanding supply in the unit that price quotes. It is not a guessed treasury float. On Solana it is `amount / 10^decimals`. On Base, BNB, and Robinhood Chain it is ERC-20 `totalSupply() / 10^decimals`, which is the whole outstanding mint. Unminted supply is not inside `totalSupply`. Burned supply is already out of it. This capture does not subtract issuer-treasury, escrow, or bridge balances it cannot read. Those assets are not given an invented float. A displayed pool reserve under $1 USD means the desk price is not a market price, and `supplyUsd` stays null. A missing reserve is not treated as $0.

The day also stores `publicMarketValueUsd` (equity), `privateMarketValueUsd`, and `etfMarketValueUsd`. Each is the sum of `supplyUsd` in that lane. A lane with no priced supply is null, not zero. `supplyUsd` on the day is the sum across lanes.

Chain `holderCount` is the sum of per-token holder counts. It is not unique wallets. A null token is omitted from the sum, not stored as zero. The same rule applies to `supplyUsd`.

A day that was not captured is an empty chart slot. The change over 24H, 7D, 14D, or 30D adds only pairs of consecutive Eastern days that both have a real snapshot. A gap adds nothing.

The market-value calendar is the volume file's closed Eastern days plus a holder close on a closed Eastern day that volume file does not have. The in-progress day stays out. A volume row is not invented to make the holder day visible.

## Sources

| Chain | Supply | Holders |
| --- | --- | --- |
| Solana | Public RPC `getTokenSupply` (`SOLANA_RPC_URL`, default `https://api.mainnet-beta.solana.com`) | Public RPC `getProgramAccounts` on the mint's owner program |
| Base (8453) | `eth_call` `totalSupply()` and `decimals()` on `https://mainnet.base.org` | GeckoTerminal `holders.count` |
| BNB Chain (56) | `eth_call` on `https://bsc-dataseed.binance.org` | GeckoTerminal `holders.count` |
| Robinhood Chain (4663) | `eth_call` on `https://rpc.mainnet.chain.robinhood.com` | GeckoTerminal `holders.count` |

### Solana supply

`totalSupplyRaw` is the mint `amount`. `totalSupplyDecimals` is `decimals`. `totalSupply` is `uiAmountString`. That string includes a Token-2022 scaled UI multiplier and stays the mint census. `circulatingSupply` is `amount / 10^decimals`. DexScreener `priceUsd` quotes that unscaled unit. Multiplying the UI amount by that price counts the multiplier twice.

Checked against the 2026-10-08 capture and live reads on 2026-10-20:

- NFLXx (`XsEH7w…KmzVpL`) had raw decimal supply about 155,057 and UI supply about 1,550,568. The mint's scaled UI config moved from multiplier 1 to 10 at 2025-11-16 23:55 UTC. Netflix closed at $71.57 on 2026-10-08. The stored desk price was about $707, about 10× the share. UI × that price was about $1.096B. Unscaled supply × that price is about $109.6M, which matches a share-priced token. Jupiter's market cap the same week was about $104M on the UI supply at about $67 a UI token. rwa.xyz lists Solana token supply 155,057 (the unscaled figure) and a much smaller "distributed" circulating supply (about 868 on the public NFLXx page). That distributed figure is not reproducible from the mint account here, so it is not substituted. xStocks' public asset API does not publish supply.
- TQQQx's multiplier was about 2.01 and SPACEX's (PreStocks) was 5. Dividing the desk price by that multiplier lands on Jupiter's price. The same unscaled formula covers them.
- NVDAx's multiplier is about 1.0017. Unscaled and UI differ by that fraction. The old "UI amount is what DexScreener prices" note came from this mint, where the two units are almost the same.
- tOpenAI, BLK, SPCX, and NKE mints ending in `jups`, plus the same ~780,000,000-token Meteora DBC clones ending in `moon` or `bonk` (`3KsvGerr…moon`, `54nTMg3b…moon`, `FiR8RG4J…bonk`) and `6ZnJQLZj…` tOpenAI, had Jupiter `launchpad: met-dbc` and liquidity under $1. Those nine mints were about $3.68B of the stored $6.58B. They are not the official Tessera or Backpack mints (the Backpack BLK mint `BLKK…Z8Nf` was about 115 tokens). RACE (`AmrxhsWi…`) is the same ~780,000,000-token shape and its stored 2026-10-08 pools reported $0 of reserve. A reserve under $1 leaves `supplyUsd` null. Holder counts still include pool token accounts. Those accounts are not added into supply.

The 2026-10-08 row on each chain was restated in place. Solana `supplyUsd` is the captured desk price times `amount/10^decimals`. The captured price is the old `supplyUsd / totalSupply`, because that day's pool rows stored liquidity and not `priceUsd`. A later quote is not filled in. Verified sub-$1 clones are null, as is any mint whose stored deepest pool reserve is under $1. Base, BNB, and Robinhood supplies were already `totalSupply/10^decimals`. BNB POPMTx had a stored PancakeSwap reserve of $0.91, so that asset is null. The previous `supplyUsd` (and the lane totals that sum the previous assets) stay on `correction`. The 2026-10-19 row is not rewritten. Volume files are not rewritten.
- rwa.xyz's xStocks page listed about $417.7M distributed on Solana, against about $1.85B of outstanding xStocks supply × price on 2026-10-19. Redeemed xStocks stay in issuer wallets and still sit in `getTokenSupply`, so that distributed figure is smaller than the mint. This capture does not read those wallets (public `getTokenLargestAccounts` did not answer), and it does not copy the rwa.xyz number. On NFLXx, Jupiter's market cap matched unscaled supply × the DexScreener price. On the DBC clones, Jupiter's circulating supply matched the full mint and liquidity was under $1.

An unreadable UI string leaves `totalSupply` null. An unreadable raw amount or decimals leaves `circulatingSupply` and `supplyUsd` null. The UI amount is not used as a fallback.

### Solana holders

The mint account's owner selects the program: SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` or Token-2022 `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. The call filters with `memcmp` of the mint at offset 0 and `dataSlice` of the 8-byte amount at offset 64. There is no `dataSize` filter, so Token-2022 extension accounts are not dropped. Non-zero amounts are counted. An empty account list is zero. An RPC error is null.

Limits: this is token accounts for that mint, including program-owned accounts, not unique wallets. The public RPC can refuse or time out a large mint. That mint stays null. The census is not copied from Jupiter or from a pool's LP holder count.

### EVM supply

`totalSupplyRaw` is the `totalSupply()` integer. `totalSupply` and `circulatingSupply` are that integer divided by `10^decimals`. There is no Token-2022 UI multiplier on these chains. If `decimals()` is missing, the raw integer is kept and both adjusted supplies are null, so `supplyUsd` is null. Base, BNB, and Robinhood outstanding supplies on 2026-10-08 were share-sized (Coinbase NVDAc about 25,878 tokens, bStocks CRCLB about 1.75M, RHJ SPY about 24,818), not the Solana UI-multiplier or 780M-clone pattern. No public per-token treasury list was available for those chains, so treasury tokens were not subtracted.

### EVM holders

Blockscout is the explorer for Base (`base.blockscout.com`) and the official explorer for Robinhood Chain (`robinhoodchain.blockscout.com`). From the snapshot host those APIs answer with a Cloudflare challenge, not a holder count. Routescan `tokenholdercount` works on chains it indexes (verified on Avalanche C-Chain) and returns `chain not supported` for 8453, 56, and 4663. Public Basescan and Etherscan holder endpoints are paid or also challenged. Those paths are not used.

The count that is stored is GeckoTerminal token-info `holders.count` (`base`, `bsc`, `robinhood`). That is the same integer the asset page already shows. It is an indexer's count, not a fresh enumeration of `Transfer` logs. A missing or non-integer count stays null. Distribution fields on the same payload are ignored.

The public API allows about 30 calls a minute, and this host stays under the limit that actually answers: token-info reads go out one at a time, at least 6.5 seconds apart, and HTTP 429 is retried. A 429 is not stored as a missing count until those retries are exhausted. HTTP 404, and a 200 whose `holders.count` is null, are real nulls.

## Universe

The writer uses the desk's existing loaders and does not add tokens:

- Solana: the live classified desk (`getChain("solana")`), with `SOLANA_MARKET_ENABLED=true`
- Base: `loadBaseChainMarkets`
- BNB Chain: `loadBnbChainMarkets`. When that registry has no bStocks row (Jumper returned 403 on 2026-10-20), the capture also reads `BSTOCKS_SEED` from the volume writer. Those contracts are not given a carried-forward price. DexScreener still has to quote them, and a miss stays null.
- Robinhood Chain: `loadRobinhoodChainMarkets`

Each row keeps that loader's address, symbol, issuer, instrument kind, and DexScreener price.
