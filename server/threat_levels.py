"""Canonical distance-to-threat classification for NetraSense software.

Exact boundaries are intentional and shared by serial ingestion, warning
evaluation, and fusion: 300 cm is WARNING, 100 cm is WARNING, and 50 cm is
ALARM. A reading is fresh when its age is less than or equal to the configured
timeout; it becomes stale only once its age is greater than that timeout.
"""
from __future__ import annotations


def classify_distance_cm(distance_cm: float) -> str:
    """Return the canonical NetraSense threat level for a validated range."""
    if distance_cm > 300.0:
        return "NORMAL"
    if distance_cm >= 100.0:
        return "WARNING"
    if distance_cm >= 50.0:
        return "ALARM"
    return "CRITICAL"
