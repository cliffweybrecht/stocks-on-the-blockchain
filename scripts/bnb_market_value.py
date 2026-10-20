"""On-chain market value for the BNB tokenized-stock snapshot.

Market value is ERC-20 totalSupply / 10^decimals, read from a public BSC RPC,
times a USD price. Price preference is DexScreener priceUsd on the mint's
highest-liquidity cash-quote pool that passes the liquidity sanity guard, then
a GeckoTerminal token price, then null. A missing supply or a missing price
stays null. It is not stored as zero. A price that disagrees with that pool's
own 24h move, and a single-token value above $10B, are null and warned. They
are not counted. Pool token balances are not a price: concentrated-liquidity
reserves are skewed and are not used.
"""

from __future__ import annotations

import json
import math
import time
import urllib.error
import urllib.request
from typing import Any, Callable

from bnb_volume_universe import CHAIN_ID, CHAIN_SLUG
from snapshot_asset_rows import apply_liquidity_sanity

# Cash quotes for the price pool. DAI, BTCB, and ETH count as volume quotes
# and are not a USD price for this figure.
CASH_PRICE_QUOTES = frozenset(
    {
        "0x55d398326f99059ff775485246999027b3197955",  # USDT
        "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",  # USDC
        "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",  # WBNB
        "0xe9e7cea3dedca5984780bafc599bd69add087d56",  # BUSD
        "0xc5f0f7b66764f6ec8c8dff7ba683102295e16409",  # FDUSD
        "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",  # USD1
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",  # native BNB
        "0x0000000000000000000000000000000000000000",
    }
)
TOTAL_SUPPLY_SELECTOR = "0x18160ddd"
DECIMALS_SELECTOR = "0x313ce567"
# One tokenized stock above this is a broken print, not a market.
MAX_TOKEN_MARKET_VALUE_USD = 10_000_000_000.0
# Spot vs the pool's own 24h-ago price beyond this is not used.
PRICE_HISTORY_MAX_RATIO = 10.0
MARKET_VALUE_SOURCE = "bsc-erc20-totalSupply x dexscreener-cash-pool-else-geckoterminal"
DEFAULT_BUDGET_S = 360.0
# Public BSC nodes rate-limit eth_call batches above about 20 calls.
# Two calls per mint (totalSupply and decimals) keeps a batch at that cap.
RPC_BATCH = 10
GECKO_PRICE_BATCH = 30
GECKO_PRICE_URL = "https://api.geckoterminal.com/api/v2/simple/networks/bsc/token_price/{addrs}"
DEFAULT_BSC_RPCS = (
    "https://bsc.publicnode.com",
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/",
)

PostFn = Callable[[str, Any], Any]
ClockFn = Callable[[], float]
FetchFn = Callable[[str], Any]


def reported_number(raw: Any) -> float | None:
    """Finite number, including negatives. Missing, bool, and non-finite stay null."""
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
    elif isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        try:
            value = float(text)
        except ValueError:
            return None
    else:
        return None
    if not math.isfinite(value):
        return None
    return value


def round_supply(value: float) -> float:
    if value == 0:
        return 0.0
    return float(format(value, ".12g"))


def round_price(value: float) -> float:
    return float(format(value, ".12g"))


def bsc_rpc_urls(preferred: str | None = None) -> list[str]:
    urls: list[str] = []
    if preferred and preferred.strip():
        urls.append(preferred.strip())
    urls.extend(DEFAULT_BSC_RPCS)
    seen: set[str] = set()
    out: list[str] = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        out.append(url)
    return out


def pair_on_bnb(chain_id: Any) -> bool:
    if chain_id is None:
        return True
    if isinstance(chain_id, str) and not chain_id.strip():
        return True
    if isinstance(chain_id, bool):
        return False
    if isinstance(chain_id, int):
        return chain_id == CHAIN_ID
    return str(chain_id).strip().lower() in {CHAIN_SLUG, "bsc", "56", "bnb", "bnb-chain", "binancesmartchain"}


def _decode_uint(raw: Any) -> int | None:
    if not isinstance(raw, str) or not raw.startswith("0x"):
        return None
    hexpart = raw[2:]
    if not hexpart or len(hexpart) > 64:
        return None
    try:
        return int(hexpart, 16)
    except ValueError:
        return None


def _batch_error(payload: Any) -> str | None:
    """A node that rejects the whole batch returns one error and a null id."""
    row = None
    if isinstance(payload, dict) and payload.get("error") and "result" not in payload:
        row = payload
    elif isinstance(payload, list) and len(payload) == 1 and isinstance(payload[0], dict):
        item = payload[0]
        if item.get("error") and "result" not in item and item.get("id") is None:
            row = item
    if row is None:
        return None
    err = row.get("error")
    if isinstance(err, dict) and err.get("message"):
        return str(err["message"])
    return "rpc batch failed"


def _rpc_results(payload: Any) -> dict[int, Any]:
    """Per-call results. A batch-level rate limit is a failure, not an empty read."""
    message = _batch_error(payload)
    if message:
        raise RuntimeError(message)
    rows = payload if isinstance(payload, list) else [payload]
    found: dict[int, Any] = {}
    for row in rows:
        if not isinstance(row, dict) or "id" not in row:
            continue
        try:
            call_id = int(row["id"])
        except (TypeError, ValueError):
            continue
        found[call_id] = row
    if not found:
        raise RuntimeError("rpc batch returned no results")
    return found


def read_token_supplies(
    addresses: list[str],
    *,
    post: PostFn,
    rpcs: list[str],
    budget_s: float,
    clock: ClockFn = time.monotonic,
) -> tuple[dict[str, float | None], list[str], set[str]]:
    """totalSupply / 10^decimals. A failed or unread token stays null.

    `unread` is the set we did not finish before the time budget. Those stay
    null; they are not zero.
    """
    ordered: list[str] = []
    seen: set[str] = set()
    for address in addresses:
        if not isinstance(address, str) or not address.startswith("0x") or len(address) != 42:
            continue
        key = address.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered.append(address)
    supplies: dict[str, float | None] = {addr.lower(): None for addr in ordered}
    warnings: list[str] = []
    if not ordered:
        return supplies, warnings, set()
    if not rpcs:
        warnings.append("market value supply skipped: no BSC RPC")
        return supplies, warnings, {addr.lower() for addr in ordered}

    deadline = clock() + max(0.0, budget_s)
    pending = list(ordered)
    attempts: dict[str, int] = {addr.lower(): 0 for addr in ordered}
    raw_supply: dict[str, int | None] = {}
    raw_decimals: dict[str, int | None] = {}

    while pending:
        if clock() >= deadline:
            warnings.append(f"market value supply stopped: time budget ({len(pending)} unread)")
            break
        batch = pending[:RPC_BATCH]
        calls: list[dict[str, Any]] = []
        index: list[tuple[str, str]] = []
        for addr in batch:
            for selector, kind in ((TOTAL_SUPPLY_SELECTOR, "supply"), (DECIMALS_SELECTOR, "decimals")):
                calls.append(
                    {
                        "jsonrpc": "2.0",
                        "id": len(calls),
                        "method": "eth_call",
                        "params": [{"to": addr, "data": selector}, "latest"],
                    }
                )
                index.append((addr.lower(), kind))
        parsed: dict[int, Any] | None = None
        last_error = "rpc failed"
        for rpc in rpcs:
            if clock() >= deadline:
                break
            try:
                parsed = _rpc_results(post(rpc, calls))
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                parsed = None
        if parsed is None:
            for addr in batch:
                attempts[addr.lower()] = attempts.get(addr.lower(), 0) + 1
            retry = [addr for addr in batch if attempts[addr.lower()] < 2]
            pending = retry + pending[len(batch) :]
            if not retry:
                warnings.append(f"market value supply batch failed: {last_error}")
            continue
        for call_id, (key, kind) in enumerate(index):
            row = parsed.get(call_id)
            if not isinstance(row, dict) or row.get("error"):
                continue
            value = _decode_uint(row.get("result"))
            if value is None:
                continue
            if kind == "supply":
                raw_supply[key] = value
            elif 0 <= value <= 36:
                raw_decimals[key] = value
        still: list[str] = []
        for addr in batch:
            key = addr.lower()
            if key in raw_supply and key in raw_decimals:
                continue
            attempts[key] = attempts.get(key, 0) + 1
            if attempts[key] < 2:
                still.append(addr)
        pending = pending[len(batch) :] + still

    unread: set[str] = set()
    for addr in ordered:
        key = addr.lower()
        if key in raw_supply and key in raw_decimals:
            decimals = raw_decimals[key]
            assert decimals is not None
            total = raw_supply.get(key)
            if total is None:
                continue
            supplies[key] = round_supply(total / float(10**decimals))
        elif key not in raw_supply and key not in raw_decimals and attempts.get(key, 0) == 0:
            unread.add(key)
        elif attempts.get(key, 0) > 0 and clock() >= deadline and key not in raw_supply:
            unread.add(key)
    return supplies, warnings, unread


def index_cash_price_candidates(pairs: list[Any], mints: set[str]) -> dict[str, list[dict]]:
    """DexScreener-shaped pairs where the mint is the base and the quote is cash.

    priceUsd is the base token's price. A pool that quotes the stock in cash
    on the other side is not a price for this mint.
    """
    wanted = {addr.lower() for addr in mints}
    best: dict[tuple[str, str], dict] = {}
    for pair in pairs:
        if not isinstance(pair, dict) or not pair_on_bnb(pair.get("chainId")):
            continue
        base = str(((pair.get("baseToken") or {}).get("address") or "")).lower()
        quote = str(((pair.get("quoteToken") or {}).get("address") or "")).lower()
        if base not in wanted or quote not in CASH_PRICE_QUOTES:
            continue
        pair_address = str(pair.get("pairAddress") or "").strip()
        if not pair_address.startswith("0x"):
            continue
        liquidity_raw = pair.get("liquidity") if isinstance(pair.get("liquidity"), dict) else {}
        liquidity = reported_number(liquidity_raw.get("usd"))
        if liquidity is not None and liquidity < 0:
            liquidity = None
        volume = reported_number((pair.get("volume") or {}).get("h24") if isinstance(pair.get("volume"), dict) else None)
        if volume is not None and volume < 0:
            volume = None
        price = reported_number(pair.get("priceUsd"))
        if price is not None and price <= 0:
            price = None
        native = reported_number(pair.get("priceNative"))
        if native is not None and native <= 0:
            native = None
        change = reported_number((pair.get("priceChange") or {}).get("h24") if isinstance(pair.get("priceChange"), dict) else None)
        candidate = {
            "pairAddress": pair_address,
            "liquidityUsd": liquidity,
            "volume24hUsd": volume,
            "priceUsd": None if price is None else round_price(price),
            "priceNative": native,
            "priceChangeH24": change,
            "baseReserve": reported_number(liquidity_raw.get("base")),
            "quoteReserve": reported_number(liquidity_raw.get("quote")),
            "quote": quote,
            "base": base,
        }
        slot = (base, pair_address.lower())
        current = best.get(slot)
        if current is None or (candidate["liquidityUsd"] or -1) > (current["liquidityUsd"] or -1):
            best[slot] = candidate
    grouped: dict[str, list[dict]] = {addr: [] for addr in wanted}
    for (mint, _pair), candidate in best.items():
        grouped.setdefault(mint, []).append(candidate)
    return grouped


def price_rejection_reason(candidate: dict) -> str | None:
    """Null when this pool's priceUsd can be used. Otherwise a warning reason."""
    price = candidate.get("priceUsd")
    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
        return None
    change = candidate.get("priceChangeH24")
    if isinstance(change, (int, float)) and not isinstance(change, bool):
        factor = 1 + float(change) / 100.0
        if factor <= 0 or factor > PRICE_HISTORY_MAX_RATIO or factor < 1 / PRICE_HISTORY_MAX_RATIO:
            return "price-far-from-pool-history"
    return None


def _history_anchor(candidate: dict) -> float | None:
    """Yesterday's price when the 24h move itself is inside 10×.

    A move outside that range is not a usable anchor. Gecko is then accepted
    on its own, still subject to the $10B cap. Token balances are not a price.
    """
    price = candidate.get("priceUsd")
    change = candidate.get("priceChangeH24")
    if not isinstance(price, (int, float)) or isinstance(price, bool) or price <= 0:
        return None
    if not isinstance(change, (int, float)) or isinstance(change, bool):
        return None
    factor = 1 + float(change) / 100.0
    if factor <= 0 or factor > PRICE_HISTORY_MAX_RATIO or factor < 1 / PRICE_HISTORY_MAX_RATIO:
        return None
    anchor = float(price) / factor
    if math.isfinite(anchor) and anchor > 0:
        return anchor
    return None


def _far_from_anchor(price: float, anchor: float | None) -> bool:
    if anchor is None or anchor <= 0:
        return False
    ratio = price / anchor
    return ratio > PRICE_HISTORY_MAX_RATIO or ratio < 1 / PRICE_HISTORY_MAX_RATIO


def _guard_excluded(candidates: list[dict], extra_pools: list[dict], market_value: float | None) -> set[str]:
    pools: list[dict] = []
    seen: set[str] = set()
    for candidate in candidates:
        pair = str(candidate.get("pairAddress") or "")
        key = pair.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        pools.append(
            {
                "poolId": pair,
                "liquidityUsd": candidate.get("liquidityUsd"),
                "volume24hUsd": candidate.get("volume24hUsd"),
            }
        )
    for pool in extra_pools:
        if not isinstance(pool, dict):
            continue
        pair = str(pool.get("pairAddress") or pool.get("poolId") or "")
        key = pair.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        pools.append(
            {
                "poolId": pair,
                "liquidityUsd": pool.get("liquidityUsd"),
                "volume24hUsd": pool.get("volume24hUsd"),
            }
        )
    sanity = apply_liquidity_sanity(pools, market_value)
    excluded: set[str] = set()
    for row in sanity.get("excludedLiquidityPools") or []:
        if not isinstance(row, dict) or "replacementLiquidityUsd" in row:
            continue
        excluded.add(str(row.get("poolId") or "").lower())
    return excluded


def _positive_liquidity(candidate: dict) -> bool:
    liquidity = candidate.get("liquidityUsd")
    return isinstance(liquidity, (int, float)) and not isinstance(liquidity, bool) and liquidity > 0


def select_dex_price(
    candidates: list[dict],
    *,
    supply: float | None,
    extra_pools: list[dict] | None = None,
) -> tuple[dict | None, list[tuple[str, dict]]]:
    """Highest-liquidity cash pool that passes the guard and the price checks.

    Returns the chosen candidate and the guard-passing pools that were rejected.
    """
    ranked = sorted(
        [row for row in candidates if _positive_liquidity(row) and row.get("priceUsd")],
        key=lambda row: (-(float(row["liquidityUsd"])), str(row.get("pairAddress") or "").lower()),
    )
    extras = extra_pools or []
    rejected: list[tuple[str, dict]] = []
    for candidate in ranked:
        price = float(candidate["priceUsd"])
        provisional = None
        if supply is not None and supply >= 0:
            provisional = supply * price
        excluded = _guard_excluded(candidates, extras, provisional)
        if str(candidate.get("pairAddress") or "").lower() in excluded:
            continue
        reason = price_rejection_reason(candidate)
        if reason:
            rejected.append((reason, candidate))
            continue
        if provisional is not None and provisional > MAX_TOKEN_MARKET_VALUE_USD:
            rejected.append(("market-value-above-10b", candidate))
            continue
        return candidate, rejected
    return None, rejected


def _blank_reading(supply: float | None) -> dict[str, Any]:
    return {
        "supply": supply,
        "priceUsd": None,
        "priceSource": None,
        "marketValueUsd": None,
    }


def _warning(row: dict, reason: str, *, price: float | None, supply: float | None, market_value: float | None, pair: str | None) -> dict:
    return {
        "symbol": row.get("symbol") or "",
        "address": row.get("address") or "",
        "reason": reason,
        "priceUsd": None if price is None else round_price(price),
        "supply": supply,
        "marketValueUsd": None if market_value is None else round(market_value, 2),
        "pairAddress": pair,
    }


def resolve_market_values(
    rows: list[dict],
    supplies: dict[str, float | None],
    candidates: dict[str, list[dict]],
    gecko_prices: dict[str, float | None],
    *,
    extra_pools: dict[str, list[dict]] | None = None,
    supply_unread: set[str] | None = None,
    gecko_unread: set[str] | None = None,
) -> tuple[dict[str, dict], list[dict], dict[str, int]]:
    """Per-mint supply, price, source, and market value. Null is not zero."""
    readings: dict[str, dict] = {}
    warnings: list[dict] = []
    nulls: dict[str, int] = {}
    unread_supply = supply_unread or set()
    unread_gecko = gecko_unread or set()
    pools_by_mint = extra_pools or {}

    def bump(reason: str) -> None:
        nulls[reason] = nulls.get(reason, 0) + 1

    for row in rows:
        address = str(row.get("address") or "")
        key = address.lower()
        if not key.startswith("0x"):
            continue
        supply = supplies.get(key)
        if isinstance(supply, bool) or supply is None:
            supply_value = None
        else:
            try:
                supply_value = float(supply)
            except (TypeError, ValueError):
                supply_value = None
            if supply_value is None or not math.isfinite(supply_value) or supply_value < 0:
                supply_value = None
        pool_rows = pools_by_mint.get(key) or []
        chosen, rejected = select_dex_price(
            candidates.get(key) or [],
            supply=supply_value,
            extra_pools=pool_rows,
        )
        for reason, candidate in rejected:
            price = candidate.get("priceUsd")
            product = None
            if supply_value is not None and isinstance(price, (int, float)) and not isinstance(price, bool):
                product = supply_value * float(price)
            warnings.append(
                _warning(
                    row,
                    reason,
                    price=float(price) if isinstance(price, (int, float)) and not isinstance(price, bool) else None,
                    supply=supply_value,
                    market_value=product,
                    pair=str(candidate.get("pairAddress") or "") or None,
                )
            )
        if chosen is not None:
            price = round_price(float(chosen["priceUsd"]))
            market = None if supply_value is None else round(supply_value * price, 2)
            readings[key] = {
                "supply": supply_value,
                "priceUsd": price,
                "priceSource": "dexscreener",
                "marketValueUsd": market,
            }
            if market is None:
                if key in unread_supply:
                    bump("budget")
                else:
                    bump("no-supply")
            continue

        gecko_raw = gecko_prices.get(key)
        gecko_price = None
        if isinstance(gecko_raw, (int, float)) and not isinstance(gecko_raw, bool) and math.isfinite(float(gecko_raw)) and float(gecko_raw) > 0:
            gecko_price = round_price(float(gecko_raw))
        anchor = None
        anchor_candidates = sorted(
            [item for item in (candidates.get(key) or []) if _positive_liquidity(item)],
            key=lambda item: (-(float(item["liquidityUsd"])), str(item.get("pairAddress") or "").lower()),
        )
        if anchor_candidates:
            anchor = _history_anchor(anchor_candidates[0])
        gecko_block: str | None = None
        if gecko_price is not None and _far_from_anchor(gecko_price, anchor):
            product = None if supply_value is None else supply_value * gecko_price
            warnings.append(
                _warning(
                    row,
                    "gecko-far-from-pool-history",
                    price=gecko_price,
                    supply=supply_value,
                    market_value=product,
                    pair=str(anchor_candidates[0].get("pairAddress") or "") if anchor_candidates else None,
                )
            )
            gecko_block = "gecko-far-from-pool-history"
            gecko_price = None
        if gecko_price is not None and supply_value is not None and supply_value * gecko_price > MAX_TOKEN_MARKET_VALUE_USD:
            warnings.append(
                _warning(
                    row,
                    "market-value-above-10b",
                    price=gecko_price,
                    supply=supply_value,
                    market_value=supply_value * gecko_price,
                    pair=None,
                )
            )
            gecko_block = "market-value-above-10b"
            gecko_price = None
        if gecko_price is not None:
            market = None if supply_value is None else round(supply_value * gecko_price, 2)
            readings[key] = {
                "supply": supply_value,
                "priceUsd": gecko_price,
                "priceSource": "geckoterminal",
                "marketValueUsd": market,
            }
            if market is None:
                bump("budget" if key in unread_supply else "no-supply")
            continue

        readings[key] = _blank_reading(supply_value)
        if rejected:
            bump(rejected[0][0])
        elif gecko_block:
            bump(gecko_block)
        elif key in unread_supply or key in unread_gecko:
            bump("budget")
        elif supply_value is None:
            bump("no-supply-and-no-price")
        else:
            bump("no-price")
    return readings, warnings, nulls


def read_gecko_token_prices(
    addresses: list[str],
    *,
    fetch: FetchFn,
    budget_s: float,
    clock: ClockFn = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    min_interval_s: float = 3.2,
) -> tuple[dict[str, float | None], list[str], set[str]]:
    """GeckoTerminal simple token price. Missing and unread stay null."""
    ordered: list[str] = []
    seen: set[str] = set()
    for address in addresses:
        key = address.lower()
        if key in seen or not key.startswith("0x"):
            continue
        seen.add(key)
        ordered.append(address)
    prices: dict[str, float | None] = {addr.lower(): None for addr in ordered}
    warnings: list[str] = []
    unread = {addr.lower() for addr in ordered}
    if not ordered:
        return prices, warnings, unread
    deadline = clock() + max(0.0, budget_s)
    last_at = 0.0
    for start in range(0, len(ordered), GECKO_PRICE_BATCH):
        if clock() >= deadline:
            warnings.append(f"market value gecko price stopped: time budget ({len(unread)} unread)")
            break
        if last_at:
            wait = min_interval_s - (clock() - last_at)
            if wait > 0:
                if clock() + wait >= deadline:
                    warnings.append(f"market value gecko price stopped: time budget ({len(unread)} unread)")
                    break
                sleep(wait)
        batch = ordered[start : start + GECKO_PRICE_BATCH]
        url = GECKO_PRICE_URL.format(addrs=",".join(addr.lower() for addr in batch))
        payload = None
        last_error = "gecko price failed"
        for attempt in range(2):
            if clock() >= deadline:
                break
            try:
                payload = fetch(url)
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                payload = None
                if "429" in last_error and attempt == 0 and clock() + 2 < deadline:
                    sleep(2.0)
        last_at = clock()
        if not isinstance(payload, dict):
            warnings.append(f"market value gecko price batch failed: {last_error}")
            continue
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        attrs = data.get("attributes") if isinstance(data.get("attributes"), dict) else {}
        token_prices = attrs.get("token_prices") if isinstance(attrs.get("token_prices"), dict) else {}
        for addr in batch:
            key = addr.lower()
            unread.discard(key)
            raw = token_prices.get(key)
            if raw is None:
                raw = token_prices.get(addr)
            price = reported_number(raw)
            if price is not None and price > 0:
                prices[key] = round_price(price)
    return prices, warnings, unread


def post_json(url: str, payload: Any, timeout: float = 12) -> Any:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; BnbVolumeSnapshot/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} for {url}") from exc


def collect_market_values(
    rows: list[dict],
    pairs: list[Any],
    extra_pools: dict[str, list[dict]] | None = None,
    *,
    budget_s: float = DEFAULT_BUDGET_S,
    rpcs: list[str] | None = None,
    post: PostFn | None = None,
    fetch: FetchFn | None = None,
    clock: ClockFn = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    min_interval_s: float = 3.2,
) -> tuple[dict[str, dict], list[dict], dict[str, int], list[str]]:
    """Supply and price for every mint. Readings stay null when an input is missing."""
    sender = post or post_json
    getter = fetch or fetch_gecko_json
    started = clock()
    addresses = [str(row.get("address") or "") for row in rows]
    supplies, supply_warnings, supply_unread = read_token_supplies(
        addresses,
        post=sender,
        rpcs=list(rpcs or []),
        budget_s=budget_s,
        clock=clock,
    )
    mints = {addr.lower() for addr in addresses if addr.startswith("0x")}
    candidates = index_cash_price_candidates(pairs, mints)
    pools = extra_pools or {}
    need_gecko: list[str] = []
    for row in rows:
        address = str(row.get("address") or "")
        key = address.lower()
        if not key.startswith("0x"):
            continue
        supply = supplies.get(key)
        supply_value = float(supply) if isinstance(supply, (int, float)) and not isinstance(supply, bool) else None
        chosen, _rejected = select_dex_price(
            candidates.get(key) or [],
            supply=supply_value,
            extra_pools=pools.get(key) or [],
        )
        if chosen is None:
            need_gecko.append(address)
    remaining = budget_s - (clock() - started)
    gecko_prices, gecko_warnings, gecko_unread = read_gecko_token_prices(
        need_gecko,
        fetch=getter,
        budget_s=max(0.0, remaining),
        clock=clock,
        sleep=sleep,
        min_interval_s=min_interval_s,
    )
    readings, warnings, nulls = resolve_market_values(
        rows,
        supplies,
        candidates,
        gecko_prices,
        extra_pools=pools,
        supply_unread=supply_unread,
        gecko_unread=gecko_unread,
    )
    return readings, warnings, nulls, supply_warnings + gecko_warnings


def fetch_gecko_json(url: str, timeout: float = 30) -> Any:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; BnbVolumeSnapshot/1.0)",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} for {url}") from exc
