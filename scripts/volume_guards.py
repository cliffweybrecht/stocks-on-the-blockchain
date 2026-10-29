"""Pool-level guards for closed ET day volume snapshots.

1. Wash/outlier guard: drop a pool's day volume when it is absurd for the pool's
   liquidity (day volume > 50x liquidity USD) or when one hour dominates a small
   pool (hour > $1M and > 20x the pool's median hour, liquidity < $250k).
2. Closed-day integrity: when the run starts more than GRACE_H hours after the
   ET day ended (a late/backfill run), a rolling-24h fallback pool whose
   creation (DexScreener pairCreatedAt) or first Gecko candle is at/after the
   day end is not counted and is recorded as noClosedDayData. Older pools keep
   the rolling-24h fallback. On-time runs are unchanged.

Every dropped pool is returned with a reason so the row records it.
"""
from __future__ import annotations

import statistics
import time
from typing import Any, Callable

MAX_VOL_TO_LIQ = 50.0
SPIKE_MIN_HOUR_USD = 1_000_000.0
SPIKE_MEDIAN_MULT = 20.0
SPIKE_MAX_LIQ_USD = 250_000.0
GRACE_H = 3.0
FALLBACK_SOURCES = ("dexscreener-h24-fallback", "geckoterminal-h24-fallback")


def wash_reason(volume: float | None, liquidity: float | None, hourly: list[float] | None) -> str | None:
    if volume is None or volume <= 0:
        return None
    if liquidity is not None and liquidity > 0 and volume > MAX_VOL_TO_LIQ * liquidity:
        return f"wash: day volume {volume / liquidity:.0f}x liquidity (> {MAX_VOL_TO_LIQ:.0f}x)"
    if hourly and liquidity is not None and liquidity < SPIKE_MAX_LIQ_USD:
        top = max(hourly)
        med = statistics.median(hourly)
        if top > SPIKE_MIN_HOUR_USD and top > SPIKE_MEDIAN_MULT * max(med, 1.0):
            return f"wash: one hour ${top:,.0f} > {SPIKE_MEDIAN_MULT:.0f}x median hour ${med:,.0f} on small pool"
    return None


def is_late_run(day_end_epoch: int, now: float | None = None) -> bool:
    return (time.time() if now is None else now) > day_end_epoch + GRACE_H * 3600


def created_after(pool: dict[str, Any], day_end_epoch: int) -> int | None:
    """Return the creation/first-candle epoch if it is at or after the day end."""
    marks: list[float] = []
    ms = pool.get("created_ms")
    if isinstance(ms, (int, float)) and ms > 0:
        marks.append(ms / 1000.0)
    first = pool.get("first_candle_ts")
    if isinstance(first, (int, float)) and first > 0:
        marks.append(float(first))
    if not marks:
        return None
    born = min(marks)
    return int(born) if born >= day_end_epoch else None


def make_guard(day_end_epoch: int, now: float | None = None) -> Callable[..., tuple[str, str] | None]:
    """guard(pool, chosen, source) -> (bucket, reason) or None.

    bucket is "excluded" (wash) or "noClosedDayData" (late run, pool created
    after the ET day ended). Late runs still count rolling-24h fallbacks for
    pools that existed before the day ended.
    """
    late = is_late_run(day_end_epoch, now)

    def guard(pool: dict[str, Any], chosen: float | None, source: str) -> tuple[str, str] | None:
        if late and source in FALLBACK_SOURCES:
            born = created_after(pool, day_end_epoch)
            if born is not None:
                return "noClosedDayData", f"late run: pool created/first trade {born} after day end {day_end_epoch}"
        liq = pool.get("liquidity")
        liq = float(liq) if isinstance(liq, (int, float)) else None
        reason = wash_reason(chosen, liq, pool.get("gecko_hourly") if source == "geckoterminal-hourly-et" else None)
        if reason:
            return "excluded", reason
        return None

    guard.late_run = late  # type: ignore[attr-defined]
    return guard
