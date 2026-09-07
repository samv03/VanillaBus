"""Per-message last inter-arrival time (T6). Not EMA.

Key is (busId, can_id, is_eff). is_fd is added to the key only when FD is
enabled later — classic CAN IDs stay grouped regardless of the is_fd flag.
"""

from __future__ import annotations

import threading
from typing import Hashable

# Unique (busId, can_id, is_eff) keys under a unique-ID flood. Oldest evicted.
RATE_KEY_MAX = 8192

RateKey = tuple[str, int, bool]


def rate_key(bus_id: str, can_id: int, is_eff: bool) -> RateKey:
    return (bus_id, int(can_id), bool(is_eff))


class RateTracker:
    """Remember the previous ts_us per key and return (Δts_us)/1000.

    The key map is bounded (RATE_KEY_MAX). Under a unique-ID flood the
    oldest keys are evicted so the tracker cannot grow without limit.
    """

    def __init__(self, key_max: int = RATE_KEY_MAX) -> None:
        if not isinstance(key_max, int) or key_max < 1:
            raise ValueError("RateTracker key_max must be a positive integer")
        self._last: dict[RateKey, int] = {}
        self._lock = threading.Lock()
        self._key_max = key_max

    def observe(self, bus_id: str, can_id: int, is_eff: bool, ts_us: int) -> float | None:
        """First sample for a key is null; later samples are last inter-arrival ms."""
        key = rate_key(bus_id, can_id, is_eff)
        now = int(ts_us)
        with self._lock:
            prev = self._last.pop(key, None)
            if prev is None and len(self._last) >= self._key_max:
                self._last.pop(next(iter(self._last)))
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
