"""Obstacle warning and threat state management for ultrasonic sensors.

Evaluates raw ultrasonic distance readings against configurable thresholds,
tracks sensor data freshness against timeouts, manages state transitions
(OBSTACLE WARNING, CLEAR, SENSOR ERROR, SENSOR UNAVAILABLE), and prevents
spurious repeated alerts while an obstacle remains unchanged.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Any

from threat_levels import classify_distance_cm


class ObstacleState(str, Enum):
    """The four required operational states of the obstacle detection system."""
    OBSTACLE_WARNING = "OBSTACLE_WARNING"
    CLEAR = "CLEAR"
    SENSOR_ERROR = "SENSOR_ERROR"
    SENSOR_UNAVAILABLE = "SENSOR_UNAVAILABLE"


# Default thresholds and operational constants
DEFAULT_WARNING_THRESHOLD_CM: float = 300.0
DEFAULT_STALE_TIMEOUT_S: float = 3.0
DEFAULT_HYSTERESIS_CM: float = 5.0
DEFAULT_DEBOUNCE_COUNT: int = 1
DEFAULT_DELTA_ALERT_THRESHOLD_CM: float = 15.0
DEFAULT_MIN_DISTANCE_CM: float = 2.0
DEFAULT_MAX_DISTANCE_CM: float = 400.0


@dataclass(frozen=True)
class WarningEvaluation:
    """Immutable evaluation result for an ultrasonic reading or query."""
    state: ObstacleState
    distance_cm: Optional[float]
    is_warning: bool
    is_clear: bool
    is_error: bool
    is_unavailable: bool
    alert_triggered: bool
    threat_level: str  # "NORMAL", "WARNING", "ALARM", "CRITICAL", or "NONE"
    timestamp: float
    raw_reading_timestamp: Optional[str] = None
    age_seconds: Optional[float] = None
    error_message: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "distance_cm": self.distance_cm,
            "is_warning": self.is_warning,
            "is_clear": self.is_clear,
            "is_error": self.is_error,
            "is_unavailable": self.is_unavailable,
            "alert_triggered": self.alert_triggered,
            "threat_level": self.threat_level,
            "timestamp": self.timestamp,
            "raw_reading_timestamp": self.raw_reading_timestamp,
            "age_seconds": round(self.age_seconds, 2) if self.age_seconds is not None else None,
            "error_message": self.error_message,
        }


class ObstacleWarningEvaluator:
    """Configurable stateful evaluator for obstacle detection and warning logic.

    Attributes:
        warning_threshold_cm: Distance in cm at or below which an obstacle warning triggers.
        stale_timeout_s: Maximum age in seconds of a reading before declaring SENSOR_UNAVAILABLE.
        hysteresis_cm: Deadband zone to avoid rapid state oscillation around threshold.
        debounce_count: Consecutive matching readings required to transition state (default 1).
        delta_alert_threshold_cm: Distance change threshold to trigger a new alert event while in warning state.
        min_distance_cm: Physical minimum valid distance for HC-SR04 (typically 2 cm).
        max_distance_cm: Physical maximum valid distance for HC-SR04 (typically 400 cm).
    """

    def __init__(
        self,
        warning_threshold_cm: float = DEFAULT_WARNING_THRESHOLD_CM,
        stale_timeout_s: float = DEFAULT_STALE_TIMEOUT_S,
        hysteresis_cm: float = DEFAULT_HYSTERESIS_CM,
        debounce_count: int = DEFAULT_DEBOUNCE_COUNT,
        delta_alert_threshold_cm: float = DEFAULT_DELTA_ALERT_THRESHOLD_CM,
        min_distance_cm: float = DEFAULT_MIN_DISTANCE_CM,
        max_distance_cm: float = DEFAULT_MAX_DISTANCE_CM,
    ) -> None:
        self.warning_threshold_cm = float(warning_threshold_cm)
        self.stale_timeout_s = float(stale_timeout_s)
        self.hysteresis_cm = float(hysteresis_cm)
        self.debounce_count = max(1, int(debounce_count))
        self.delta_alert_threshold_cm = float(delta_alert_threshold_cm)
        self.min_distance_cm = float(min_distance_cm)
        self.max_distance_cm = float(max_distance_cm)

        # Internal state tracking
        self._current_state: ObstacleState = ObstacleState.SENSOR_UNAVAILABLE
        self._last_valid_distance: Optional[float] = None
        self._last_valid_monotonic: float = 0.0
        self._last_valid_reading_ts: Optional[str] = None
        self._last_alerted_distance: Optional[float] = None
        self._last_error_message: Optional[str] = None

        # Debounce tracking
        self._pending_state: Optional[ObstacleState] = None
        self._pending_count: int = 0

    def update_config(
        self,
        warning_threshold_cm: Optional[float] = None,
        stale_timeout_s: Optional[float] = None,
        hysteresis_cm: Optional[float] = None,
        debounce_count: Optional[int] = None,
        delta_alert_threshold_cm: Optional[float] = None,
        min_distance_cm: Optional[float] = None,
        max_distance_cm: Optional[float] = None,
    ) -> dict[str, Any]:
        """Update configuration parameters at runtime."""
        if warning_threshold_cm is not None:
            self.warning_threshold_cm = float(warning_threshold_cm)
        if stale_timeout_s is not None:
            self.stale_timeout_s = float(stale_timeout_s)
        if hysteresis_cm is not None:
            self.hysteresis_cm = float(hysteresis_cm)
        if debounce_count is not None:
            self.debounce_count = max(1, int(debounce_count))
        if delta_alert_threshold_cm is not None:
            self.delta_alert_threshold_cm = float(delta_alert_threshold_cm)
        if min_distance_cm is not None:
            self.min_distance_cm = float(min_distance_cm)
        if max_distance_cm is not None:
            self.max_distance_cm = float(max_distance_cm)
        return self.get_config()

    def get_config(self) -> dict[str, Any]:
        """Return the current configuration values."""
        return {
            "warning_threshold_cm": self.warning_threshold_cm,
            "stale_timeout_s": self.stale_timeout_s,
            "hysteresis_cm": self.hysteresis_cm,
            "debounce_count": self.debounce_count,
            "delta_alert_threshold_cm": self.delta_alert_threshold_cm,
            "min_distance_cm": self.min_distance_cm,
            "max_distance_cm": self.max_distance_cm,
        }

    def _classify_threat_level(self, distance_cm: Optional[float]) -> str:
        """Map distance to threat level aligned with NetraSense zones.

        Boundaries must match ``serial_sensor.classify_threat_level()`` and the
        dashboard zones: above the configured warning threshold is NORMAL,
        100 cm and below is WARNING, 50 cm and below is ALARM, below 50 cm is
        CRITICAL.
        """
        if distance_cm is None:
            return "NONE"
        if distance_cm > self.warning_threshold_cm:
            return "NORMAL"
        # The default 300 cm threshold uses the shared canonical classifier.
        # A configured warning threshold changes only NORMAL versus WARNING;
        # the 100/50 cm alarm boundaries remain common system semantics.
        return classify_distance_cm(distance_cm)

    def process_reading(
        self,
        raw_distance: Any,
        reading_timestamp: Optional[str] = None,
        current_time: Optional[float] = None,
    ) -> WarningEvaluation:
        """Process a new incoming distance reading.

        Validates the reading, updates internal state, applies debounce / hysteresis,
        and determines whether a new alert event should be triggered.
        """
        now = time.monotonic() if current_time is None else current_time

        # Validate input
        dist_val: Optional[float] = None
        error_msg: Optional[str] = None

        if isinstance(raw_distance, bool) or raw_distance is None:
            error_msg = f"Invalid sensor reading value: {raw_distance!r}"
        else:
            try:
                parsed = float(raw_distance)
                if not math.isfinite(parsed):
                    error_msg = f"Non-finite distance reading: {parsed}"
                elif parsed < self.min_distance_cm or parsed > self.max_distance_cm:
                    error_msg = f"Distance {parsed} cm outside valid physical range [{self.min_distance_cm}, {self.max_distance_cm}]"
                else:
                    dist_val = parsed
            except (ValueError, TypeError) as exc:
                error_msg = f"Could not parse distance value {raw_distance!r}: {exc}"

        if dist_val is None:
            # SENSOR ERROR
            target_state = ObstacleState.SENSOR_ERROR
            self._last_error_message = error_msg
            self._current_state = target_state
            self._pending_state = None
            self._pending_count = 0
            # SENSOR ERROR resets last alert distance so upon recovery genuine warnings alert immediately
            self._last_alerted_distance = None

            return WarningEvaluation(
                state=self._current_state,
                distance_cm=None,
                is_warning=False,
                is_clear=False,
                is_error=True,
                is_unavailable=False,
                alert_triggered=False,
                threat_level="NONE",
                timestamp=time.time(),
                raw_reading_timestamp=reading_timestamp,
                age_seconds=0.0,
                error_message=error_msg,
            )

        # Successful valid reading
        self._last_error_message = None
        self._last_valid_distance = dist_val
        self._last_valid_monotonic = now
        self._last_valid_reading_ts = reading_timestamp

        # Determine target state based on hysteresis:
        # If currently in OBSTACLE_WARNING, clear threshold is (warning_threshold_cm + hysteresis_cm)
        # If currently CLEAR (or other), warning threshold is warning_threshold_cm
        if self._current_state == ObstacleState.OBSTACLE_WARNING:
            if dist_val > (self.warning_threshold_cm + self.hysteresis_cm):
                target_state = ObstacleState.CLEAR
            else:
                target_state = ObstacleState.OBSTACLE_WARNING
        else:
            if dist_val <= self.warning_threshold_cm:
                target_state = ObstacleState.OBSTACLE_WARNING
            else:
                target_state = ObstacleState.CLEAR

        # Apply debounce logic
        state_changed = False
        if target_state == ObstacleState.OBSTACLE_WARNING and target_state != self._current_state:
            # Warning escalation is never debounced: a supported configuration
            # may smooth a transition back to CLEAR, but it must not delay an
            # observation that requires an immediate obstacle warning.
            self._current_state = target_state
            self._pending_state = None
            self._pending_count = 0
            state_changed = True
        elif target_state != self._current_state:
            if self._pending_state == target_state:
                self._pending_count += 1
            else:
                self._pending_state = target_state
                self._pending_count = 1

            if self._pending_count >= self.debounce_count:
                self._current_state = target_state
                self._pending_state = None
                self._pending_count = 0
                state_changed = True
        else:
            self._pending_state = None
            self._pending_count = 0

        # Alert event decision logic:
        # 1. Entering OBSTACLE_WARNING from another state triggers an alert.
        # 2. While remaining in OBSTACLE_WARNING, repeated measurements of the same obstacle
        #    do NOT trigger an alert event UNLESS the distance changes significantly
        #    (abs(dist_val - _last_alerted_distance) >= delta_alert_threshold_cm).
        # 3. Transitioning to CLEAR, SENSOR_ERROR, or UNAVAILABLE resets _last_alerted_distance.
        alert_triggered = False
        if self._current_state == ObstacleState.OBSTACLE_WARNING:
            if state_changed or self._last_alerted_distance is None:
                alert_triggered = True
                self._last_alerted_distance = dist_val
            elif abs(dist_val - self._last_alerted_distance) >= self.delta_alert_threshold_cm:
                alert_triggered = True
                self._last_alerted_distance = dist_val
        else:
            self._last_alerted_distance = None

        threat = self._classify_threat_level(dist_val)

        return WarningEvaluation(
            state=self._current_state,
            distance_cm=dist_val,
            is_warning=(self._current_state == ObstacleState.OBSTACLE_WARNING),
            is_clear=(self._current_state == ObstacleState.CLEAR),
            is_error=False,
            is_unavailable=False,
            alert_triggered=alert_triggered,
            threat_level=threat,
            timestamp=time.time(),
            raw_reading_timestamp=reading_timestamp,
            age_seconds=0.0,
            error_message=None,
        )

    def evaluate(self, current_time: Optional[float] = None) -> WarningEvaluation:
        """Evaluate the current obstacle status without a new reading.

        Checks whether the existing data has gone stale (> stale_timeout_s).
        Ensures stale readings cannot indefinitely preserve a misleading CLEAR status.
        """
        now = time.monotonic() if current_time is None else current_time

        if self._last_valid_monotonic <= 0:
            # Never received any valid reading
            return WarningEvaluation(
                state=ObstacleState.SENSOR_UNAVAILABLE,
                distance_cm=None,
                is_warning=False,
                is_clear=False,
                is_error=False,
                is_unavailable=True,
                alert_triggered=False,
                threat_level="NONE",
                timestamp=time.time(),
                raw_reading_timestamp=None,
                age_seconds=None,
                error_message=self._last_error_message or "No sensor readings received yet",
            )

        age = now - self._last_valid_monotonic
        if age > self.stale_timeout_s:
            # Stale data timeout
            self._current_state = ObstacleState.SENSOR_UNAVAILABLE
            self._pending_state = None
            self._pending_count = 0
            self._last_alerted_distance = None

            return WarningEvaluation(
                state=ObstacleState.SENSOR_UNAVAILABLE,
                distance_cm=None,
                is_warning=False,
                is_clear=False,
                is_error=False,
                is_unavailable=True,
                alert_triggered=False,
                threat_level="NONE",
                timestamp=time.time(),
                raw_reading_timestamp=self._last_valid_reading_ts,
                age_seconds=age,
                error_message=f"Sensor data is stale ({age:.1f}s > timeout {self.stale_timeout_s:.1f}s)",
            )

        # Still fresh - return active state with current age
        threat = self._classify_threat_level(self._last_valid_distance)
        return WarningEvaluation(
            state=self._current_state,
            distance_cm=self._last_valid_distance,
            is_warning=(self._current_state == ObstacleState.OBSTACLE_WARNING),
            is_clear=(self._current_state == ObstacleState.CLEAR),
            is_error=(self._current_state == ObstacleState.SENSOR_ERROR),
            is_unavailable=False,
            alert_triggered=False,
            threat_level=threat,
            timestamp=time.time(),
            raw_reading_timestamp=self._last_valid_reading_ts,
            age_seconds=age,
            error_message=self._last_error_message,
        )

    def reset(self) -> None:
        """Reset internal state to clean initial condition."""
        self._current_state = ObstacleState.SENSOR_UNAVAILABLE
        self._last_valid_distance = None
        self._last_valid_monotonic = 0.0
        self._last_valid_reading_ts = None
        self._last_alerted_distance = None
        self._last_error_message = None
        self._pending_state = None
        self._pending_count = 0
