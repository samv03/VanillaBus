"""DBC load / allowlist / cantools unpack (T7) and pack (T13).

One database per open busId. Unknown CAN IDs stay on the RX path as raw
frames (decode is null). TX pack uses the same loaded database: message
name + physical signals → raw bytes. Paths must resolve under the project
root (fixtures included). The renderer never parses DBC.
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
    units: dict[str, str] = {}
    for signal in getattr(message, "signals", None) or []:
        unit = getattr(signal, "unit", None)
        sig_name = getattr(signal, "name", None)
        if isinstance(sig_name, str) and isinstance(unit, str) and unit:
            units[sig_name] = unit
    return {"name": str(message.name), "signals": signals, "units": units}


def _jsonable_bound(value: Any) -> int | float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    return None


def _signal_initial(signal: Any) -> int | float | None:
    initial = _jsonable_bound(getattr(signal, "initial", None))
    if initial is not None:
        return initial
    minimum = _jsonable_bound(getattr(signal, "minimum", None))
    if minimum is not None:
        return minimum
    return 0


def catalog_from_database(database: Any) -> list[dict[str, Any]]:
    """Message/signal list for Graph + Transmit. Mux rules stay engine-side."""
    catalog: list[dict[str, Any]] = []
    for message in getattr(database, "messages", None) or []:
        signals: list[dict[str, Any]] = []
        for signal in getattr(message, "signals", None) or []:
            name = getattr(signal, "name", None)
            if not isinstance(name, str) or not name:
                continue
            unit = getattr(signal, "unit", None)
            entry: dict[str, Any] = {
                "name": name,
                "unit": unit if isinstance(unit, str) else "",
            }
            minimum = _jsonable_bound(getattr(signal, "minimum", None))
            maximum = _jsonable_bound(getattr(signal, "maximum", None))
            initial = _signal_initial(signal)
            if minimum is not None:
                entry["min"] = minimum
            if maximum is not None:
                entry["max"] = maximum
            if initial is not None:
                entry["initial"] = initial
            signals.append(entry)
        frame_id = getattr(message, "frame_id", None)
        msg_name = getattr(message, "name", None)
        if not isinstance(msg_name, str) or not isinstance(frame_id, int):
            continue
        catalog.append({"name": msg_name, "can_id": int(frame_id), "signals": signals})
    return catalog


def _lookup_message(database: Any, name: str) -> Any:
    getter = getattr(database, "get_message_by_name", None)
    if callable(getter):
        try:
            message = getter(name)
        except KeyError as exc:
            raise DbcError("unknown_message", f"DBC has no message named {name}") from exc
        except Exception as exc:
            raise DbcError("unknown_message", f"DBC has no message named {name}") from exc
        if message is None:
            raise DbcError("unknown_message", f"DBC has no message named {name}")
        return message
    for message in getattr(database, "messages", None) or []:
        if getattr(message, "name", None) == name:
            return message
    raise DbcError("unknown_message", f"DBC has no message named {name}")


def _coerce_signal_value(name: str, value: Any) -> int | float | str | bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise DbcError("invalid_payload", f"signal {name} must be a finite number")
        return value
    if isinstance(value, str):
        return value
    raise DbcError("invalid_payload", f"signal {name} must be a number, string, or boolean")


def parse_pack_signals(raw: object) -> dict[str, int | float | str | bool]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise DbcError("invalid_payload", "signals must be an object of name → value")
    signals: dict[str, int | float | str | bool] = {}
    for key, value in raw.items():
        name = str(key)
        if not name:
            raise DbcError("invalid_payload", "signal names must be non-empty")
        signals[name] = _coerce_signal_value(name, value)
    return signals


def _mux_selector_name(message: Any) -> str | None:
    for signal in getattr(message, "signals", None) or []:
        if getattr(signal, "is_multiplexer", False):
            name = getattr(signal, "name", None)
            if isinstance(name, str) and name:
                return name
    return None


def _filter_mux_signals(message: Any, signals: dict[str, int | float | str | bool]) -> dict[str, int | float | str | bool]:
    """Drop inactive multiplexed signals so encode does not require unused mux fields."""
    selector = _mux_selector_name(message)
    if selector is None or selector not in signals:
        return dict(signals)
    try:
        mux_value = int(signals[selector])  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return dict(signals)
    filtered: dict[str, int | float | str | bool] = {}
    for name, value in signals.items():
        try:
            signal = message.get_signal_by_name(name)
        except Exception:
            filtered[name] = value
            continue
        mux_ids = getattr(signal, "multiplexer_ids", None)
        if mux_ids and mux_value not in mux_ids:
            continue
        filtered[name] = value
    return filtered


def pack_frame(database: Any, message_name: object, signals: object) -> dict[str, Any]:
    """Encode physical signals with cantools. Returns can_id / hex data / is_eff / dlc / name."""
    if database is None:
        raise DbcError("dbc_not_loaded", "no DBC is loaded for this busId")
    if not isinstance(message_name, str) or not message_name.strip():
        raise DbcError("invalid_payload", "tx DBC pack requires payload.message")
    name = message_name.strip()
    parsed = parse_pack_signals(signals)
    message = _lookup_message(database, name)
    filtered = _filter_mux_signals(message, parsed)
    try:
        encoded = message.encode(filtered, scaling=True, strict=False)
    except DbcError:
        raise
    except Exception as exc:
        raise DbcError("pack_failed", f"failed to pack {name}: {exc}") from exc
    if not isinstance(encoded, (bytes, bytearray)):
        raise DbcError("pack_failed", f"cantools encode for {name} did not return bytes")
    data = bytes(encoded)
    frame_id = getattr(message, "frame_id", None)
    if not isinstance(frame_id, int):
        raise DbcError("pack_failed", f"DBC message {name} has no frame id")
    is_eff = bool(
        getattr(message, "is_extended_frame", False)
        or getattr(message, "is_extended_id", False)
    )
    return {
        "name": str(message.name),
        "can_id": int(frame_id),
        "data": data.hex(),
        "dlc": len(data),
        "is_eff": is_eff,
    }


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
            "catalog": catalog_from_database(database),
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
