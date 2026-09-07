"""SocketCAN bus.list / bus.open / bus.close (python-can).

MVP: bind an interface that already exists and is UP. Never `ip link set up`
or set bitrate via CAP_NET_ADMIN. Bitrate is optional and ignored for vcan.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import threading

from can_engine.dbc import DbcError, DbcStore, pack_frame
from can_engine.rate import RateTracker
from can_engine.rx import RX_BATCH_MAX_FRAMES, RxPump, message_to_frame
from can_engine.tx import CyclicScheduler, TxError, TxSpec, build_can_message, parse_period_ms, parse_tx_spec

# Linux ARPHRD_CAN / IFF_UP. Used so list() can report down ifaces too.
ARPHRD_CAN = 280
IFF_UP = 0x1
IFNAMSIZ = 16
SAFE_IFACE = re.compile(r"^[A-Za-z0-9_.-]{1,15}$")
DEFAULT_SYSFS_NET = Path("/sys/class/net")


class BusError(Exception):
    """Structured failure mapped to engine.error {code, message}."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def _sysfs_net(sysfs_net: Path | None) -> Path:
    return sysfs_net if sysfs_net is not None else DEFAULT_SYSFS_NET


def is_can_interface(name: str, sysfs_net: Path | None = None) -> bool:
    type_raw = _read_text(_sysfs_net(sysfs_net) / name / "type")
    if type_raw is None:
        return False
    try:
        return int(type_raw, 0) == ARPHRD_CAN
    except ValueError:
        return False


def interface_state(name: str, sysfs_net: Path | None = None) -> str:
    """up/down from IFF_UP. vcan operstate is often UNKNOWN even when UP."""
    flags_raw = _read_text(_sysfs_net(sysfs_net) / name / "flags")
    if flags_raw is None:
        return "down"
    try:
        flags = int(flags_raw, 0)
    except ValueError:
        return "down"
    return "up" if flags & IFF_UP else "down"


def interface_kind(name: str, sysfs_net: Path | None = None) -> str:
    """Driver/kind hint: vcan, vxcan, kernel driver name, or socketcan."""
    root = _sysfs_net(sysfs_net)
    iface = root / name
    driver = root / name / "device" / "driver"
    if driver.exists() or driver.is_symlink():
        try:
            return driver.resolve().name
        except OSError:
            pass
    try:
        resolved = iface.resolve()
    except OSError:
        resolved = iface
    parts = resolved.as_posix().split("/")
    if "virtual" in parts:
        if name.startswith("vxcan"):
            return "vxcan"
        if name.startswith("vcan"):
            return "vcan"
        return "virtual"
    return "socketcan"


def inspect_interface(name: str, sysfs_net: Path | None = None) -> dict[str, str] | None:
    if not is_can_interface(name, sysfs_net):
        return None
    return {
        "name": name,
        "kind": interface_kind(name, sysfs_net),
        "state": interface_state(name, sysfs_net),
    }


def list_interfaces(sysfs_net: Path | None = None) -> list[dict[str, str]]:
    root = _sysfs_net(sysfs_net)
    if not root.is_dir():
        return []
    found: list[dict[str, str]] = []
    try:
        names = sorted(entry.name for entry in root.iterdir() if entry.is_dir() or entry.is_symlink())
    except OSError:
        return []
    for name in names:
        info = inspect_interface(name, root)
        if info is not None:
            found.append(info)
    return found


def validate_iface_name(name: str) -> str:
    if not isinstance(name, str) or not SAFE_IFACE.match(name):
        raise BusError(
            "invalid_payload",
            "interface name must be 1–15 characters [A-Za-z0-9_.-]",
        )
    if len(name.encode("ascii", "strict")) >= IFNAMSIZ:
        raise BusError("invalid_payload", "interface name exceeds IFNAMSIZ")
    return name


def _open_socketcan(name: str, bitrate: int | None) -> Any:
    try:
        import can
    except ImportError as exc:
        raise BusError(
            "open_failed",
            "python-can is not installed (pip install -e engine/)",
        ) from exc

    kwargs: dict[str, Any] = {"interface": "socketcan", "channel": name}
    if bitrate is not None:
        kwargs["bitrate"] = bitrate
    try:
        return can.Bus(**kwargs)
    except BusError:
        raise
    except Exception as exc:
        raise BusError("open_failed", f"SocketCAN open failed for {name}: {exc}") from exc


class BusManager:
    """In-process map of busId → python-can SocketCAN bus."""

    def __init__(self, sysfs_net: Path | None = None, opener=_open_socketcan) -> None:
        self._sysfs_net = sysfs_net
        self._opener = opener
        self._buses: dict[str, Any] = {}
        self._names: dict[str, str] = {}
        self._pumps: dict[str, RxPump] = {}
        self._send_locks: dict[str, threading.Lock] = {}
        self._rates = RateTracker()
        self._dbc = DbcStore()
        self._cyclic = CyclicScheduler()

    def list(self) -> dict[str, Any]:
        return {"interfaces": list_interfaces(self._sysfs_net)}

    def open(self, name: object, bitrate: object = None) -> dict[str, Any]:
        if not isinstance(name, str) or not name:
            raise BusError("invalid_payload", "bus.open requires payload.name")
        channel = validate_iface_name(name)
        parsed_bitrate = self._parse_bitrate(bitrate)

        info = inspect_interface(channel, self._sysfs_net)
        if info is None:
            if not (_sysfs_net(self._sysfs_net) / channel).exists():
                raise BusError("iface_not_found", f"interface {channel} does not exist")
            raise BusError("iface_not_found", f"{channel} is not a SocketCAN interface")
        if info["state"] != "up":
            raise BusError(
                "iface_down",
                f"{channel} is down; bring it up first "
                f"(e.g. sudo ./scripts/setup-vcan.sh) — VanillaBus will not ip link set up",
            )

        # vcan has no kernel bitrate; ignore the optional field.
        apply_bitrate = None if info["kind"] in {"vcan", "vxcan"} else parsed_bitrate
        bus = self._opener(channel, apply_bitrate)
        bus_id = str(uuid.uuid4())
        self._buses[bus_id] = bus
        self._names[bus_id] = channel
        pump = RxPump(bus, bus_id, channel, rates=self._rates, decode=self._dbc.attach)
        self._pumps[bus_id] = pump
        self._send_locks[bus_id] = threading.Lock()
        pump.start()
        return {"busId": bus_id}

    def load_dbc(self, bus_id: object, path: object) -> dict[str, Any]:
        if not isinstance(bus_id, str) or not bus_id:
            raise DbcError("invalid_payload", "dbc.load requires payload.busId")
        if bus_id not in self._buses:
            raise DbcError("bus_not_found", f"no open bus with busId {bus_id}")
        return self._dbc.load(bus_id, path)

    def clear_dbc(self, bus_id: object) -> dict[str, Any]:
        if not isinstance(bus_id, str) or not bus_id:
            raise DbcError("invalid_payload", "dbc.clear requires payload.busId")
        if bus_id not in self._buses:
            raise DbcError("bus_not_found", f"no open bus with busId {bus_id}")
        return self._dbc.clear(bus_id)

    def drain_rx(self, max_frames: int = RX_BATCH_MAX_FRAMES) -> tuple[list[dict[str, Any]], int]:
        """Take up to max_frames queued RX frames plus the cumulative drop count."""
        frames: list[dict[str, Any]] = []
        dropped = 0
        for pump in list(self._pumps.values()):
            dropped += pump.dropped
            room = max_frames - len(frames)
            if room > 0:
                frames.extend(pump.drain(room))
        return frames, dropped

    def send(self, payload: object) -> dict[str, Any]:
        """One-shot raw or DBC-packed TX. Echoes dir=tx onto the RX queue for Trace."""
        spec = self._resolve_tx_spec(payload)
        self._send_spec(spec)
        return {"ok": True}

    def start_cyclic(self, payload: object) -> dict[str, Any]:
        spec = self._resolve_tx_spec(payload)
        period_ms = parse_period_ms(payload.get("period_ms") if isinstance(payload, dict) else None)
        if spec.bus_id not in self._buses:
            raise TxError("bus_not_found", f"no open bus with busId {spec.bus_id}")
        job_id = self._cyclic.start(spec, period_ms, self._send_spec)
        return {"job_id": job_id}

    def _resolve_tx_spec(self, payload: object) -> TxSpec:
        """Raw {can_id, data} or DBC {message, signals} packed once via cantools."""
        if isinstance(payload, dict) and isinstance(payload.get("message"), str) and payload["message"].strip():
            bus_id = payload.get("busId")
            if not isinstance(bus_id, str) or not bus_id:
                raise TxError("invalid_payload", "tx requires payload.busId")
            if bus_id not in self._buses:
                raise TxError("bus_not_found", f"no open bus with busId {bus_id}")
            packed = pack_frame(self._dbc.get(bus_id), payload.get("message"), payload.get("signals"))
            return TxSpec(
                bus_id=bus_id,
                can_id=int(packed["can_id"]),
                data=bytes.fromhex(str(packed["data"])),
                dlc=int(packed["dlc"]),
                is_eff=bool(packed["is_eff"]),
                is_fd=False,
                brs=False,
                is_rtr=False,
            )
        return parse_tx_spec(payload)

    def stop_cyclic(self, payload: object) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise TxError("invalid_payload", "tx.cyclic.stop requires payload.job_id")
        self._cyclic.stop(payload.get("job_id"))
        return {"ok": True}

    def _send_spec(self, spec: TxSpec) -> None:
        bus = self._buses.get(spec.bus_id)
        if bus is None:
            raise TxError("bus_not_found", f"no open bus with busId {spec.bus_id}")
        msg = build_can_message(spec)
        lock = self._send_locks.get(spec.bus_id)
        try:
            if lock is not None:
                with lock:
                    bus.send(msg)
            else:
                bus.send(msg)
        except TxError:
            raise
        except Exception as exc:
            raise TxError("tx_failed", f"SocketCAN send failed: {exc}") from exc
        self._echo_tx(spec.bus_id, msg)

    def _echo_tx(self, bus_id: str, msg: Any) -> None:
        if_name = self._names.get(bus_id)
        pump = self._pumps.get(bus_id)
        if if_name is None or pump is None:
            return
        frame = message_to_frame(msg, bus_id, if_name)
        frame["dir"] = "tx"
        self._rates.attach(frame)
        try:
            self._dbc.attach(frame)
        except Exception:
            frame["decode"] = None
        pump.enqueue(frame)

    def close(self, bus_id: object) -> dict[str, Any]:
        if not isinstance(bus_id, str) or not bus_id:
            raise BusError("invalid_payload", "bus.close requires payload.busId")
        self._cyclic.stop_bus(bus_id)
        pump = self._pumps.pop(bus_id, None)
        if pump is not None:
            pump.stop()
        self._dbc.clear(bus_id)
        self._rates.clear_bus(bus_id)
        bus = self._buses.pop(bus_id, None)
        self._names.pop(bus_id, None)
        self._send_locks.pop(bus_id, None)
        if bus is None:
            raise BusError("bus_not_found", f"no open bus with busId {bus_id}")
        shutdown = getattr(bus, "shutdown", None)
        if callable(shutdown):
            try:
                shutdown()
            except Exception as exc:
                raise BusError("close_failed", f"failed to close {bus_id}: {exc}") from exc
        return {"ok": True}

    def close_all(self) -> None:
        self._cyclic.stop_all()
        for bus_id in list(self._buses):
            try:
                self.close(bus_id)
            except BusError:
                continue

    @staticmethod
    def _parse_bitrate(bitrate: object) -> int | None:
        if bitrate is None:
            return None
        if isinstance(bitrate, bool) or not isinstance(bitrate, int) or bitrate <= 0:
            raise BusError("invalid_payload", "bitrate must be a positive integer when provided")
        return bitrate
