"""Length-prefixed JSON frames: 4-byte big-endian size + UTF-8 payload."""

from __future__ import annotations

import json
import struct
from typing import Any, Final

MAX_FRAME_BYTES: Final[int] = 1_048_576
_HEADER = struct.Struct(">I")


class ProtocolError(Exception):
    """Malformed length or JSON. The server must not crash on this."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def encode_message(message: dict[str, Any]) -> bytes:
    payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(payload) > MAX_FRAME_BYTES:
        raise ProtocolError("payload_too_large", "encoded JSON exceeds 1 MiB")
    return _HEADER.pack(len(payload)) + payload


def decode_payload(payload: bytes) -> dict[str, Any]:
    if not payload:
        raise ProtocolError("invalid_length", "empty JSON payload")
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProtocolError("invalid_json", f"JSON decode failed: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ProtocolError("invalid_message", "JSON root must be an object")
    msg_type = parsed.get("type")
    if not isinstance(msg_type, str) or not msg_type:
        raise ProtocolError("invalid_message", "message type must be a non-empty string")
    return parsed


def check_length(length: int) -> None:
    if length <= 0:
        raise ProtocolError("invalid_length", f"length must be > 0, got {length}")
    if length > MAX_FRAME_BYTES:
        raise ProtocolError("payload_too_large", f"length {length} exceeds 1 MiB")
