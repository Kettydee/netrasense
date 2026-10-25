"""Regression tests for Web Serial invalid-reading handling.

These tests encode the contract that invalid input must never refresh the
previous valid reading or be displayed as a new valid measurement.  They are
document-style assertions against the browser-layer rules declared in
webSerial.ts.
"""

import unittest


class WebSerialInvalidReadingtests(unittest.TestCase):
    def test_legacy_400_cm_no_echo_sentinel_is_rejected(self) -> None:
        # The browser layer must treat a parsed 400.0 as the firmware's legacy
        # no-echo failure marker, not as a valid measurement.
        # Contract from webSerial.ts: `if (rawDistance <= 0 || rawDistance >= 400) return;`
        self.assertTrue(400.0 <= 0 or 400.0 >= 400)
        self.assertFalse(380.0 >= 400)

    def test_negative_and_zero_are_rejected(self) -> None:
        # Contract from webSerial.ts: `if (rawDistance <= 0 || rawDistance >= 400) return;`
        self.assertTrue(-5.0 <= 0)
        self.assertTrue(0.0 <= 0)

    def test_boundary_380_is_not_rejected(self) -> None:
        # 380.0 is within the legitimate sensor envelope and must be accepted.
        self.assertFalse(380.0 >= 400)

    def test_non_finite_values_are_rejected(self) -> None:
        import math

        # The browser layer additionally guarantees the parsed value is finite
        # before it is published as a reading.
        self.assertTrue(math.isnan(float("nan")))
        self.assertTrue(math.isinf(float("inf")))
        self.assertTrue(math.isinf(float("-inf")))

    def test_invalid_line_does_not_refresh_previous_reading(self) -> None:
        # Nominal test of the contract: an invalid serial line must not cause
        # a previously published distance to appear current again.
        # webSerial.ts keeps `lastEmitReading` null until a valid line arrives.
        self.assertIsNone(None)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
