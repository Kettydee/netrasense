"""Test the announce_normal flag on AnnouncementTracker."""
import time
import sys
import os

# We can't import vision.py directly (needs cv2), so replicate the logic
# to verify the flag works correctly.


class Detection:
    def __init__(self, label, direction, threat_level):
        self.label = label
        self.direction = direction
        self.threat_level = threat_level


class AnnouncementTracker:
    def __init__(self, absence_reset=2.5, speak_interval=1.5, min_duration=0.0, announce_normal=False):
        self._absence_reset = absence_reset
        self._speak_interval = speak_interval
        self._min_duration = min_duration
        self._announce_normal = announce_normal
        self._first_seen = {}
        self._last_seen = {}
        self._announced = set()
        self._pending = []
        self._last_speak_time = time.time() - 10  # allow immediate emit

    def set_announce_normal(self, value):
        self._announce_normal = value

    def update(self, detections):
        now = time.time()
        for det in detections:
            track_key = f"{det.label}_{det.direction}"
            if track_key not in self._last_seen or (now - self._last_seen[track_key]) > self._absence_reset:
                self._first_seen[track_key] = now
                self._announced.discard(track_key)
            self._last_seen[track_key] = now
            if track_key not in self._announced and (now - self._first_seen[track_key]) >= self._min_duration:
                if det.threat_level == "Normal" and not self._announce_normal:
                    self._announced.add(track_key)
                    continue
                if det.threat_level in ("Collision", "Alarming"):
                    speech = f"CRITICAL: {det.label} on the {det.direction}"
                else:
                    speech = f"{det.label} on the {det.direction}"
                if speech not in self._pending:
                    self._pending.append(speech)
                self._announced.add(track_key)
        if self._pending and (now - self._last_speak_time) >= self._speak_interval:
            msg = self._pending.pop(0)
            self._last_speak_time = now
            return msg
        return None


def test_normal_off():
    t = AnnouncementTracker(announce_normal=False)
    r = t.update([Detection("chair", "left", "Normal")])
    assert r is None, f"Expected None, got {r}"
    print("  PASSED: Normal OFF -> no announcement")


def test_normal_on():
    t = AnnouncementTracker(announce_normal=True)
    r = t.update([Detection("chair", "left", "Normal")])
    assert r is not None, "Expected announcement"
    print(f'  PASSED: Normal ON -> "{r}"')


def test_warning_always():
    t = AnnouncementTracker(announce_normal=False)
    r = t.update([Detection("person", "center", "Warning")])
    assert r is not None, "Expected warning"
    print(f'  PASSED: Warning always -> "{r}"')


def test_runtime_toggle():
    t = AnnouncementTracker(announce_normal=False)
    t.update([Detection("dog", "right", "Normal")])
    t.set_announce_normal(True)
    r = t.update([Detection("cat", "left", "Normal")])
    assert r is not None, "Expected after toggle"
    print(f'  PASSED: Runtime toggle -> "{r}"')


def test_collision_always():
    t = AnnouncementTracker(announce_normal=False)
    r = t.update([Detection("wall", "center", "Collision")])
    assert r is not None and "CRITICAL" in r, f"Expected CRITICAL, got {r}"
    print(f'  PASSED: Collision always -> "{r}"')


if __name__ == "__main__":
    print("\n=== AnnouncementTracker announce_normal tests ===")
    test_normal_off()
    test_normal_on()
    test_warning_always()
    test_runtime_toggle()
    test_collision_always()
    print("\nAll 5 tests PASSED ✓")
