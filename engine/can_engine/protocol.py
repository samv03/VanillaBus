"""Envelope constructors for the locked IPC types."""

from __future__ import annotations

from typing import Any

from can_engine.hello import hello_payload

KNOWN_TYPES = frozenset(
    {
        "engine.hello",
        "engine.heartbeat",
        "engine.error",
        "bus.list",
        "bus.open",
        "bus.close",
        "dbc.load",
        "dbc.clear",
        "rx.batch",
        "tx.send",
        "tx.cyclic.start",
        "tx.cyclic.stop",
    }
)


def envelope(msg_type: str, payload: dict[str, Any], msg_id: str | None = None) -> dict[str, Any]:
    message: dict[str, Any] = {"type": msg_type, "payload": payload}
    if msg_id is not None:
        message["id"] = msg_id
    return message


def hello_message(msg_id: str | None = None) -> dict[str, Any]:
    return envelope("engine.hello", hello_payload(), msg_id)


def heartbeat_message(ts_us: int) -> dict[str, Any]:
    return envelope("engine.heartbeat", {"ts_us": ts_us})


def error_message(code: str, message: str, msg_id: str | None = None) -> dict[str, Any]:
    return envelope("engine.error", {"code": code, "message": message}, msg_id)
