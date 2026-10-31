#!/usr/bin/env python3
"""Shared GeckoTerminal HTTP client for the nightly volume writers.

The public API allows 30 requests per minute. This client spaces calls at
2.1 seconds (about 28 per minute). HTTP 429, 5xx, timeouts, and connection
errors retry with exponential backoff and jitter. A 404 is final. Callers
may use DexScreener h24 only after retries are exhausted.
"""

from __future__ import annotations

import json
import random
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

# 2.1s is about 28 requests/minute, under the published 30/minute cap.
GECKO_MIN_INTERVAL_S = 2.1
GECKO_MAX_ATTEMPTS = 6
GECKO_TIMEOUT_S = 30.0
GECKO_BACKOFF_BASE_S = 1.0
GECKO_BACKOFF_CAP_S = 60.0

UA = {"accept": "application/json", "user-agent": "stocks-on-the-blockchain-gecko/1.0"}


@dataclass
class GeckoFetchResult:
    ok: bool
    body: Any
    status: int | None
    reason: str
    attempts: int


def _header(headers: Any, name: str) -> str | None:
    if headers is None:
        return None
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return None
    value = getter(name)
    if value is None:
        value = getter(name.lower())
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def retry_after_seconds(headers: Any) -> float | None:
    raw = _header(headers, "Retry-After")
    if raw is None:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        return None
    if seconds < 0 or seconds != seconds:
        return None
    return min(seconds, GECKO_BACKOFF_CAP_S)


class GeckoHttpClient:
    """One pace for every GeckoTerminal call in this process."""

    def __init__(
        self,
        *,
        interval: float = GECKO_MIN_INTERVAL_S,
        max_attempts: int = GECKO_MAX_ATTEMPTS,
        timeout: float = GECKO_TIMEOUT_S,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        random_fn: Callable[[], float] = random.random,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        self.interval = interval
        self.max_attempts = max(1, max_attempts)
        self.timeout = timeout
        self.sleep = sleep
        self.monotonic = monotonic
        self.random_fn = random_fn
        self.opener = opener or urllib.request.urlopen
        self._lock = threading.Lock()
        self._next = 0.0
        self.requests = 0
        self.retries = 0

    def _pace(self) -> None:
        # Reserve the next slot under the lock, sleep outside it: threads queue in order.
        with self._lock:
            now = self.monotonic()
            slot = max(now, self._next)
            self._next = slot + self.interval
        if slot > now:
            self.sleep(slot - now)

    def _backoff(self, attempt: int, headers: Any) -> None:
        exp = min(GECKO_BACKOFF_CAP_S, GECKO_BACKOFF_BASE_S * (2**attempt))
        jitter = self.random_fn() * GECKO_BACKOFF_BASE_S
        delay = exp + jitter
        retry_after = retry_after_seconds(headers)
        if retry_after is not None:
            delay = max(delay, retry_after)
        self.sleep(delay)
        with self._lock:
            self._next = max(self._next, self.monotonic() + self.interval)

    def get_json(self, url: str) -> GeckoFetchResult:
        last_status: int | None = None
        for attempt in range(self.max_attempts):
            self._pace()
            self.requests += 1
            if self.requests % 25 == 0:
                print(f"gecko http requests={self.requests} retries={self.retries}", flush=True)
            req = urllib.request.Request(url, headers=UA)
            try:
                with self.opener(req, timeout=self.timeout) as resp:
                    status = getattr(resp, "status", None)
                    if status is None:
                        getcode = getattr(resp, "getcode", None)
                        status = getcode() if callable(getcode) else 200
                    status = int(status)
                    raw = resp.read()
                    body = json.loads(raw.decode() if isinstance(raw, bytes) else raw)
            except urllib.error.HTTPError as exc:
                last_status = int(exc.code)
                if exc.code == 404:
                    return GeckoFetchResult(False, None, 404, "not-found", attempt + 1)
                if exc.code == 429 or exc.code >= 500:
                    self.retries += 1
                    if attempt + 1 < self.max_attempts:
                        self._backoff(attempt, exc.headers)
                        continue
                    return GeckoFetchResult(False, None, last_status, "retries-exhausted", attempt + 1)
                return GeckoFetchResult(False, None, last_status, "not-found" if exc.code == 404 else "http-error", attempt + 1)
            except (TimeoutError, urllib.error.URLError, OSError, json.JSONDecodeError, ValueError):
                self.retries += 1
                last_status = None
                if attempt + 1 < self.max_attempts:
                    self._backoff(attempt, None)
                    continue
                return GeckoFetchResult(False, None, None, "retries-exhausted", attempt + 1)
            if status == 429 or status >= 500:
                last_status = status
                self.retries += 1
                if attempt + 1 < self.max_attempts:
                    headers = getattr(resp, "headers", None)
                    self._backoff(attempt, headers)
                    continue
                return GeckoFetchResult(False, None, status, "retries-exhausted", attempt + 1)
            return GeckoFetchResult(True, body, status, "ok", attempt + 1)
        return GeckoFetchResult(False, None, last_status, "retries-exhausted", self.max_attempts)


_SHARED: GeckoHttpClient | None = None
_SHARED_LOCK = threading.Lock()


def shared_gecko_client() -> GeckoHttpClient:
    """Process-wide client so discovery and candle reads share one throttle."""
    global _SHARED
    with _SHARED_LOCK:
        if _SHARED is None:
            _SHARED = GeckoHttpClient()
        return _SHARED


def gecko_get_json(url: str) -> GeckoFetchResult:
    return shared_gecko_client().get_json(url)


def gecko_get_json_or_raise(url: str) -> Any:
    """Shared-client GET for callers that treat any failure as an exception."""
    result = gecko_get_json(url)
    if not result.ok:
        raise RuntimeError(f"gecko {result.reason} status={result.status} attempts={result.attempts}: {url}")
    return result.body
