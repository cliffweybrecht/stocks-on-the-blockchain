#!/usr/bin/env python3
"""America/New_York calendar day for desk volume snapshots.

Mirrors src/lib/market/eastern-day.ts. DST comes from ZoneInfo — do not
hardcode a fixed EST/EDT offset.

A volume day is 12:00:00 AM–11:59:59 PM Eastern. The day key is that
calendar YYYY-MM-DD. At 11:59 PM Eastern, UTC is already the next calendar
day; the key is the Eastern date that is ending, never UTC "tomorrow".

`t` is the unix timestamp of 12:00:00 AM on that date in America/New_York.
A YYYY-MM-DD override forces the key only. It does not invent volume.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

EASTERN = ZoneInfo("America/New_York")


def eastern_midnight_unix(day: date) -> int:
    """Unix seconds for America/New_York midnight on this Eastern calendar day."""
    return int(datetime(day.year, day.month, day.day, tzinfo=EASTERN).timestamp())


def parse_day_key(raw: str) -> date:
    text = raw.strip()
    parts = text.split("-")
    if len(parts) != 3 or list(map(len, parts)) != [4, 2, 2] or not all(part.isdigit() for part in parts):
        raise ValueError(f"snapshot day override must be YYYY-MM-DD, got {raw!r}")
    try:
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError as exc:
        raise ValueError(f"snapshot day override must be a real YYYY-MM-DD date, got {raw!r}") from exc


def snapshot_date_override(
    env: Mapping[str, str] | None = None,
    specific_key: str | None = None,
) -> str | None:
    """Chain-specific key wins over SNAPSHOT_DATE. Blank values are ignored."""
    source = os.environ if env is None else env
    keys: list[str] = []
    if specific_key:
        keys.append(specific_key)
    keys.append("SNAPSHOT_DATE")
    for key in keys:
        value = (source.get(key) or "").strip()
        if value:
            return value
    return None


def snapshot_day_key(now: datetime, override: str | None = None) -> tuple[str, int]:
    """Eastern calendar date of `now`, plus unix time for that ET midnight.

    The desk routine runs at 11:59 PM America/New_York, when UTC is already the
    next calendar day. The record date is New York's calendar date so the row
    is labeled with the ET day that is ending. A YYYY-MM-DD override forces
    that day key only; it does not invent volume.
    """
    if override is not None and override.strip():
        day = parse_day_key(override)
    else:
        if now.tzinfo is None:
            now = now.replace(tzinfo=timezone.utc)
        day = now.astimezone(EASTERN).date()
    return day.isoformat(), eastern_midnight_unix(day)
