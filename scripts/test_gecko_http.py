#!/usr/bin/env python3
"""GeckoTerminal retries: 429, 5xx, and timeouts back off before a fallback."""

from __future__ import annotations

import io
import json
import unittest
import urllib.error

from gecko_http import GeckoHttpClient


class Clock:
    def __init__(self) -> None:
        self.t = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.t += seconds


class Resp:
    def __init__(self, body: dict, status: int = 200, headers: dict | None = None) -> None:
        self._body = json.dumps(body).encode()
        self.status = status
        self.headers = headers or {}

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "Resp":
        return self

    def __exit__(self, *_args: object) -> bool:
        return False


def http_error(status: int, headers: dict | None = None) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://api.geckoterminal.com/test",
        status,
        "err",
        headers or {},
        io.BytesIO(b""),
    )


class GeckoHttpTest(unittest.TestCase):
    def client(self, opener, *, attempts: int = 4) -> tuple[GeckoHttpClient, Clock]:
        clock = Clock()
        client = GeckoHttpClient(
            interval=2.1,
            max_attempts=attempts,
            sleep=clock.sleep,
            monotonic=clock.monotonic,
            random_fn=lambda: 0.25,
            opener=opener,
        )
        return client, clock

    def test_429_then_ok_retries_with_backoff_and_jitter(self) -> None:
        calls = {"n": 0}

        def opener(_req, timeout):  # noqa: ANN001
            self.assertEqual(timeout, 30.0)
            calls["n"] += 1
            if calls["n"] == 1:
                raise http_error(429, {"Retry-After": "3"})
            return Resp({"data": {"ok": True}})

        client, clock = self.client(opener)
        result = client.get_json("https://api.geckoterminal.com/api/v2/networks/bsc/pools/x")
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 2)
        self.assertEqual(result.body, {"data": {"ok": True}})
        # First request is immediate. The 429 waits max(1s * 2^0 + 0.25s jitter, Retry-After 3s).
        # Retry-After 3s, then the shared 2.1s pace before the next attempt.
        self.assertEqual([round(item, 2) for item in clock.sleeps], [3.0, 2.1])
        self.assertEqual(client.retries, 1)

    def test_timeout_then_5xx_then_ok(self) -> None:
        calls = {"n": 0}

        def opener(_req, timeout):  # noqa: ANN001
            calls["n"] += 1
            if calls["n"] == 1:
                raise TimeoutError("timed out")
            if calls["n"] == 2:
                raise http_error(503)
            return Resp({"candles": []})

        client, clock = self.client(opener)
        result = client.get_json("https://example.test/ohlcv")
        self.assertTrue(result.ok)
        self.assertEqual(result.attempts, 3)
        # Backoff 1.25s and 2.25s, with the 2.1s pace before the following attempt.
        self.assertEqual([round(item, 2) for item in clock.sleeps], [1.25, 2.1, 2.25, 2.1])

    def test_404_is_final(self) -> None:
        calls = {"n": 0}

        def opener(_req, timeout):  # noqa: ANN001
            calls["n"] += 1
            raise http_error(404)

        client, _clock = self.client(opener)
        result = client.get_json("https://example.test/missing")
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "not-found")
        self.assertEqual(calls["n"], 1)

    def test_exhausted_429_does_not_return_a_body(self) -> None:
        def opener(_req, timeout):  # noqa: ANN001
            raise http_error(429)

        client, _clock = self.client(opener, attempts=3)
        result = client.get_json("https://example.test/limited")
        self.assertFalse(result.ok)
        self.assertEqual(result.reason, "retries-exhausted")
        self.assertEqual(result.status, 429)
        self.assertEqual(result.attempts, 3)
        self.assertIsNone(result.body)

    def test_pace_spaces_successful_calls(self) -> None:
        def opener(_req, timeout):  # noqa: ANN001
            return Resp({"ok": True})

        client, clock = self.client(opener)
        self.assertTrue(client.get_json("https://example.test/a").ok)
        self.assertTrue(client.get_json("https://example.test/b").ok)
        self.assertEqual([round(item, 2) for item in clock.sleeps], [2.1])


if __name__ == "__main__":
    unittest.main()
