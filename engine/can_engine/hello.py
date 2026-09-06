"""Identity helpers for engine.hello."""

from __future__ import annotations

from typing import Any

ENGINE_NAME = "vanillabus-engine"
ENGINE_VERSION = "0.1.0"
BACKENDS = ("socketcan",)


def hello() -> str:
    """Return the engine process name (kept for the T1 import check)."""
    return ENGINE_NAME


def hello_payload() -> dict[str, Any]:
    """Payload for engine.hello (version + stub backend list)."""
    return {
        "name": ENGINE_NAME,
        "version": ENGINE_VERSION,
        "backends": list(BACKENDS),
    }
