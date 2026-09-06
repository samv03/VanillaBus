"""SocketCAN bus.list / bus.open / bus.close (python-can).

MVP: bind an interface that already exists and is UP. Never `ip link set up`
or set bitrate via CAP_NET_ADMIN. Bitrate is optional and ignored for vcan.
"""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

from can_engine.rx import RX_BATCH_MAX_FRAMES, RxPump

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
        pump = RxPump(bus, bus_id, channel)
        self._pumps[bus_id] = pump
        pump.start()
        return {"busId": bus_id}

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

    def close(self, bus_id: object) -> dict[str, Any]:
        if not isinstance(bus_id, str) or not bus_id:
            raise BusError("invalid_payload", "bus.close requires payload.busId")
        pump = self._pumps.pop(bus_id, None)
        if pump is not None:
            pump.stop()
        bus = self._buses.pop(bus_id, None)
        self._names.pop(bus_id, None)
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
