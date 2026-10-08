#!/usr/bin/env python3
"""Lockstep checks for scripts/volume_snapshot_day.py against the Eastern desk day."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from pathlib import Path

from volume_snapshot_day import EASTERN, snapshot_date_override, snapshot_day_key


def utc(iso: str) -> datetime:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone.utc)


class EasternSnapshotDayTest(unittest.TestCase):
    def test_midnight_matches_both_dst_offsets(self) -> None:
        sep24, sep24_t = snapshot_day_key(utc("2026-09-24T04:00:00Z"))
        jan14, jan14_t = snapshot_day_key(utc("2026-01-14T05:00:00Z"))
        mar8, mar8_t = snapshot_day_key(utc("2026-03-08T05:00:00Z"))
        nov1, nov1_t = snapshot_day_key(utc("2026-11-01T04:00:00Z"))
        self.assertEqual(sep24, "2026-09-24")
        self.assertEqual(sep24_t, 1_790_222_400)
        self.assertEqual(jan14, "2026-01-14")
        self.assertEqual(jan14_t, 1_768_366_800)
        self.assertEqual(mar8, "2026-03-08")
        self.assertEqual(mar8_t, 1_772_946_000)
        self.assertEqual(nov1, "2026-11-01")
        self.assertEqual(nov1_t, 1_793_505_600)

    def test_eleven_fifty_nine_pm_is_the_eastern_day_not_utc_tomorrow(self) -> None:
        late_edt, late_edt_t = snapshot_day_key(utc("2026-09-25T03:59:59Z"))
        next_edt, _ = snapshot_day_key(utc("2026-09-25T04:00:00Z"))
        self.assertEqual(late_edt, "2026-09-24")
        self.assertEqual(late_edt_t, 1_790_222_400)
        self.assertEqual(next_edt, "2026-09-25")

        late_est, late_est_t = snapshot_day_key(utc("2026-01-15T04:59:59Z"))
        next_est, _ = snapshot_day_key(utc("2026-01-15T05:00:00Z"))
        self.assertEqual(late_est, "2026-01-14")
        self.assertEqual(late_est_t, 1_768_366_800)
        self.assertEqual(next_est, "2026-01-15")

    def test_dst_transitions_stay_on_the_eastern_calendar_date(self) -> None:
        before_spring, _ = snapshot_day_key(utc("2026-03-08T04:59:59Z"))
        before_fall, _ = snapshot_day_key(utc("2026-11-01T03:59:59Z"))
        self.assertEqual(before_spring, "2026-03-07")
        self.assertEqual(before_fall, "2026-10-31")

    def test_override_forces_the_key_and_specific_env_wins(self) -> None:
        day, t = snapshot_day_key(utc("2026-09-25T03:59:59Z"), "2026-09-23")
        self.assertEqual(day, "2026-09-23")
        self.assertEqual(t, int(datetime(2026, 9, 23, tzinfo=EASTERN).timestamp()))
        env = {"BNB_SNAPSHOT_DATE": "2026-09-24", "SNAPSHOT_DATE": "2026-09-01"}
        self.assertEqual(snapshot_date_override(env, specific_key="BNB_SNAPSHOT_DATE"), "2026-09-24")
        self.assertEqual(snapshot_date_override({"SNAPSHOT_DATE": " 2026-09-22 "}, specific_key="BNB_SNAPSHOT_DATE"), "2026-09-22")
        with self.assertRaises(ValueError):
            snapshot_day_key(utc("2026-09-24T16:00:00Z"), "2026-02-31")

    def test_bnb_writer_calls_the_shared_helper(self) -> None:
        text = (Path(__file__).resolve().parent / "snapshot-bnb-volume.py").read_text()
        self.assertIn("snapshot_day_key", text)
        self.assertIn('specific_key="BNB_SNAPSHOT_DATE"', text)
        self.assertNotIn("def utc_day", text)
        self.assertNotIn("ALLOWED_ISSUERS", text)


if __name__ == "__main__":
    raise SystemExit(unittest.main())
