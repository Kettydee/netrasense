"""Hardware-free regression tests for Arduino serial parsing/validation.

Guards the measurement-validation contract between the Arduino firmware and
the Python reader:

* valid distances are accepted;
* malformed JSON, missing fields, booleans, NaN and infinity are rejected
  without raising;
* negative and out-of-range distances are rejected;
* the legacy 400 cm no-echo sentinel is never accepted as a measurement;
* payloads explicitly flagged ``valid: false`` (or a failure ``status``) are
  rejected even when they carry a distance;
* an invalid input produces no record at all, so it cannot refresh the
  last-valid-reading timestamp.

Run from the server directory:
    python3 -m unittest test_serial_sensor
"""

from __future__ import annotations

import unittest

from serial_sensor import normalize_sensor_data, parse_distance_cm


class ParseDistanceTests(unittest.TestCase):
    def test_valid_payloads_parse(self):
        cases = [
            (b'{"distance_cm": 73.5}', 73.5),
            ('{"distance": 73.5}', 73.5),
            ("73", 73.0),
            ("73 cm", 73.0),
            ("distance: 73 cm", 73.0),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertAlmostEqual(parse_distance_cm(raw), expected)

    def test_malformed_json_does_not_crash(self):
        malformed = [
            b"{distance_cm: 73}",
            '{"distance_cm": }',
            '{"distance_cm": 73',  # truncated
            b"\xff\xfe\x00broken",
            "",
            "   ",
        ]
        for raw in malformed:
            with self.subTest(raw=raw):
                self.assertIsNone(parse_distance_cm(raw))

    def test_missing_distance_field_is_rejected(self):
        payloads = [
            '{"device_id": "NETRA-001"}',
            '{"valid": true}',
            '{"distance_cm": null}',
            '{"distance_cm": null, "valid": false, "status": "NO_ECHO"}',
            "null",
            "[1, 2, 3]",
        ]
        for raw in payloads:
            with self.subTest(raw=raw):
                self.assertIsNone(parse_distance_cm(raw))

    def test_non_numeric_values_are_rejected(self):
        for raw in ('{"distance_cm": true}', "true", '{"distance_cm": "far"}', '"73 cm"'):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_distance_cm(raw))

    def test_nan_and_infinity_are_rejected(self):
        for raw in (
            "NaN",
            "Infinity",
            "-Infinity",
            '{"distance_cm": NaN}',
            '{"distance_cm": Infinity}',
        ):
            with self.subTest(raw=raw):
                self.assertIsNone(parse_distance_cm(raw))

    def test_explicitly_failed_measurement_is_rejected(self):
        payloads = [
            '{"distance_cm": 150, "valid": false}',
            '{"distance_cm": 150, "valid": 0}',
            '{"distance_cm": 150, "valid": null, "status": "NO_ECHO"}',
            '{"distance_cm": null, "valid": false, "status": "OUT_OF_RANGE"}',
        ]
        for raw in payloads:
            with self.subTest(raw=raw):
                self.assertIsNone(parse_distance_cm(raw))

    def test_explicitly_valid_measurement_is_accepted(self):
        self.assertAlmostEqual(
            parse_distance_cm('{"distance_cm": 150.5, "valid": true}'), 150.5
        )


class NormalizeSensorDataTests(unittest.TestCase):
    def test_valid_reading_produces_record(self):
        record = normalize_sensor_data('{"distance_cm": 73, "valid": true}')
        self.assertIsNotNone(record)
        self.assertEqual(record["distance_cm"], 73)
        self.assertEqual(record["device_id"], "NETRA-001")
        self.assertIsNotNone(record["timestamp"])
        self.assertEqual(record["threat_level"], "ALARM")
        self.assertIn("processing_latency_ms", record)

    def test_invalid_input_produces_no_record(self):
        # Anything that fails validation must yield None — no partial record,
        # so the last-valid-reading timestamp cannot be refreshed by it.
        invalid = [
            "-5",            # negative distance
            "0",             # below physical minimum
            "1.5",           # below physical minimum (2 cm)
            "450",           # above physical maximum
            "NaN",
            "Infinity",
            '{"distance_cm": -5}',
            '{"distance_cm": 450.0, "valid": true}',  # range still enforced
            '{"distance_cm": true}',
            '{"device_id": "NETRA-001"}',  # missing distance field
            "garbage line",
            b"{not json at all",
        ]
        for raw in invalid:
            with self.subTest(raw=raw):
                self.assertIsNone(normalize_sensor_data(raw))

    def test_legacy_no_echo_sentinel_400_cm_is_rejected(self):
        # Older firmware reports a failed ultrasonic measurement (no echo) as
        # 400.0 cm — the configured maximum. It must never be accepted as a
        # legitimate "path is clear" distance.
        for raw in ('{"distance_cm": 400.0}', "400", "400 cm"):
            with self.subTest(raw=raw):
                self.assertIsNone(normalize_sensor_data(raw))

    def test_unflagged_distance_below_maximum_is_accepted(self):
        # Legacy firmware never emits a genuine echo above 380 cm, so values
        # just below the 400 cm maximum remain usable.
        self.assertIsNotNone(normalize_sensor_data('{"distance_cm": 399.9}'))

    def test_firmware_valid_flag_takes_precedence(self):
        self.assertIsNone(normalize_sensor_data('{"distance_cm": 150, "valid": false}'))
        self.assertIsNone(
            normalize_sensor_data('{"distance_cm": null, "valid": false, "status": "NO_ECHO"}')
        )
        self.assertIsNotNone(normalize_sensor_data('{"distance_cm": 150, "valid": true}'))

    def test_custom_range_is_enforced(self):
        self.assertIsNone(normalize_sensor_data("410", max_distance_cm=400.0))
        self.assertIsNone(normalize_sensor_data("1", min_distance_cm=2.0))
        self.assertIsNotNone(normalize_sensor_data("410", max_distance_cm=420.0))


if __name__ == "__main__":
    unittest.main()
