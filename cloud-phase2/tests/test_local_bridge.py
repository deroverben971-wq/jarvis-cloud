import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from local_bridge import manila_clock_context


class ManilaClockContextTests(unittest.TestCase):
    def test_converts_utc_instant_to_manila_time(self):
        instant = datetime(2026, 11, 3, 9, 15, tzinfo=timezone.utc)
        self.assertEqual(
            manila_clock_context(instant),
            "Tuesday, November 03, 2026 at 05:15 PM PST"
        )

    def test_rejects_naive_datetime(self):
        with self.assertRaises(ValueError):
            manila_clock_context(datetime(2026, 11, 3, 9, 15))


if __name__ == "__main__":
    unittest.main()
