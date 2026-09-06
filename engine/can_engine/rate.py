"""Per-message last inter-arrival time (T6). Not EMA.

Key is (busId, can_id, is_eff). is_fd is added to the key only when FD is
enabled later — classic CAN IDs stay grouped regardless of the is_fd flag.
"""

from __future__ import annotations

import threading
from typing import Hashable


RateKey = tuple[str, int, bool]


def rate_key(bus_id: str, can_id: int, is_eff: bool) -> RateKey:
    return (bus_id, int(can_id), bool(is_eff))


class RateTracker:
    """Remember the previous ts_us per key and return (Δts_us)/1000."""

    def __init__(self) -> None:
        self._last: dict[RateKey, int] = {}
        self._lock = threading.Lock()

    def observe(self, bus_id: str, can_id: int, is_eff: bool, ts_us: int) -> float | None:
        """First sample for a key is null; later samples are last inter-arrival ms."""
        key = rate_key(bus_id, can_id, is_eff)
        now = int(ts_us)
        with self._lock:
            prev = self._last.get(key)
            self._last[key] = now
        if prev is None:
            return None
        return (now - prev) / 1000.0

    def attach(self, frame: dict) -> dict:
        """Set frame['rate_ms'] from the frame's busId / can_id / is_eff / ts_us."""
        frame["rate_ms"] = self.observe(
            str(frame["busId"]),
            int(frame["can_id"]),
            bool(frame["is_eff"]),
            int(frame["ts_us"]),
        )
        return frame

    def clear_bus(self, bus_id: str) -> None:
        """Drop every key for this busId (bus.close)."""
        with self._lock:
            stale = [key for key in self._last if key[0] == bus_id]
            for key in stale:
                del self._last[key]

    def clear(self) -> None:
        with self._lock:
            self._last.clear()

    def stored_keys(self) -> tuple[Hashable, ...]:
        with self._lock:
            return tuple(self._last.keys())
