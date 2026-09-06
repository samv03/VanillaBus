"""DBC load / allowlist / cantools unpack (T7).

One database per open busId. Unknown CAN IDs stay on the RX path as raw
frames (decode is null). Paths must resolve under the project root
(fixtures included). The renderer never parses DBC.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

DBC_SUFFIX = ".dbc"


class DbcError(Exception):
    """Structured failure mapped to engine.error {code, message}."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def project_root() -> Path:
    override = os.environ.get("VANILLABUS_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    # engine/can_engine/dbc.py → repository root
    return Path(__file__).resolve().parents[2]


def allowlist_roots() -> tuple[Path, ...]:
    root = project_root()
    return (root, root / "fixtures")


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def is_allowlisted(path: Path) -> bool:
    resolved = path.resolve()
    return any(_is_under(resolved, root) for root in allowlist_roots())


def resolve_dbc_path(raw: object) -> Path:
    """Resolve a DBC path and reject anything outside project/fixtures."""
    if not isinstance(raw, str) or not raw.strip():
        raise DbcError("invalid_payload", "dbc.load requires payload.path")
    text = raw.strip()
    candidate = Path(text).expanduser()
    if not candidate.is_absolute():
        candidate = project_root() / candidate
    try:
        resolved = candidate.resolve(strict=False)
    except OSError as exc:
        raise DbcError("dbc_not_found", f"DBC path could not be resolved: {text}") from exc

    if not is_allowlisted(resolved):
        raise DbcError(
            "path_not_allowed",
            f"DBC path is outside the project/fixtures allowlist: {text}",
        )
    if not resolved.is_file():
        raise DbcError("dbc_not_found", f"DBC file not found: {text}")
    if resolved.suffix.lower() != DBC_SUFFIX:
        raise DbcError("dbc_invalid", "DBC path must end with .dbc")
    return resolved


def load_database(path: Path) -> Any:
    try:
        import cantools
    except ImportError as exc:
        raise DbcError(
            "dbc_invalid",
            "cantools is not installed (pip install -e engine/)",
        ) from exc
    try:
        return cantools.database.load_file(str(path))
    except DbcError:
        raise
    except Exception as exc:
        raise DbcError("dbc_invalid", f"failed to parse DBC: {exc}") from exc


def jsonable_signal(value: Any) -> int | float | str | bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value
    raw = getattr(value, "value", None)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return raw
    name = getattr(value, "name", None)
    if isinstance(name, str):
        return name
    return str(value)


def unpack_frame(database: Any, frame: dict[str, Any]) -> dict[str, Any] | None:
    """Return {name, signals} or None. Never raises — unknown/bad frames stay raw."""
    if database is None:
        return None
    try:
        can_id = int(frame["can_id"])
        data_hex = str(frame.get("data") or "")
        data = bytes.fromhex(data_hex)
    except (KeyError, TypeError, ValueError):
        return None

    try:
        message = database.get_message_by_frame_id(can_id)
    except Exception:
        return None
    if message is None:
        return None

    try:
        decoded = message.decode(data, decode_choices=False, scaling=True)
    except Exception:
        return None
    if not isinstance(decoded, dict):
        return None

    signals: dict[str, int | float | str | bool] = {}
    for name, value in decoded.items():
        signals[str(name)] = jsonable_signal(value)
    return {"name": str(message.name), "signals": signals}


class DbcStore:
    """In-process map of busId → loaded cantools database."""

    def __init__(self) -> None:
        self._dbs: dict[str, Any] = {}
        self._paths: dict[str, str] = {}
        self._lock = threading.Lock()

    def load(self, bus_id: str, path: object) -> dict[str, Any]:
        resolved = resolve_dbc_path(path)
        database = load_database(resolved)
        with self._lock:
            self._dbs[bus_id] = database
            self._paths[bus_id] = str(resolved)
        return {
            "ok": True,
            "message_count": len(database.messages),
            "path": str(resolved),
        }

    def clear(self, bus_id: str) -> dict[str, Any]:
        with self._lock:
            self._dbs.pop(bus_id, None)
            self._paths.pop(bus_id, None)
        return {"ok": True}

    def get(self, bus_id: str) -> Any | None:
        with self._lock:
            return self._dbs.get(bus_id)

    def attach(self, frame: dict[str, Any]) -> dict[str, Any]:
        """Set frame['decode'] from the DBC bound to frame['busId']."""
        bus_id = str(frame.get("busId") or "")
        with self._lock:
            database = self._dbs.get(bus_id)
            frame["decode"] = unpack_frame(database, frame)
        return frame

    def loaded_path(self, bus_id: str) -> str | None:
        with self._lock:
            return self._paths.get(bus_id)
