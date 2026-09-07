"""SocketCAN vendor / module hints and Peak/Kvaser SDK blacklist detection.

Used by bus.list. Pure path reads — no proprietary backends, no SocketCAN
open. Paths are injectable so tests can use a fake sysfs / modprobe.d tree.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable

DEFAULT_MODPROBE_D = Path("/etc/modprobe.d")
DEFAULT_SYS_MODULE = Path("/sys/module")

# Mainline (or HMS OOT) SocketCAN module → vendor family.
VENDOR_BY_DRIVER: dict[str, str] = {
    "peak_usb": "peak",
    "peak_pci": "peak",
    "peak_pciefd": "peak",
    "kvaser_usb": "kvaser",
    "kvaser_pci": "kvaser",
    "kvaser_pciefd": "kvaser",
    "ix_usb_can": "ixxat",
    "ixxat_usb": "ixxat",
    "ixxat_usb2can": "ixxat",
    "vcan": "virtual",
    "vxcan": "virtual",
    "mcp251x": "microchip",
    "mcp251xfd": "microchip",
}

# SocketCAN modules a vendor SDK commonly blacklists.
BLACKLIST_MODULES: dict[str, str] = {
    "peak_usb": "peak",
    "peak_pci": "peak",
    "peak_pciefd": "peak",
    "kvaser_usb": "kvaser",
    "kvaser_pci": "kvaser",
    "kvaser_pciefd": "kvaser",
}

# Proprietary chardev / LinuxCAN modules that replace SocketCAN.
PROP_MODULES: dict[str, str] = {
    "pcan": "peak",
    "leaf": "kvaser",
    "mhydra": "kvaser",
    "usbcanII": "kvaser",
    "pcican": "kvaser",
    "pcicanII": "kvaser",
}

VENDOR_PRIMARY_MODULE: dict[str, str] = {
    "peak": "peak_usb",
    "kvaser": "kvaser_usb",
    "ixxat": "ix_usb_can",
    "virtual": "vcan",
    "microchip": "mcp251x",
}

_BLACKLIST_LINE = re.compile(
    r"^\s*(?:blacklist|install)\s+(?P<module>[A-Za-z0-9_-]+)\b",
    re.IGNORECASE,
)


def vendor_for_driver(driver: str) -> str:
    """Map a sysfs driver / kind hint to a vendor family."""
    if not driver:
        return "unknown"
    return VENDOR_BY_DRIVER.get(driver, "unknown")


def module_for_vendor(vendor: str, driver: str = "") -> str:
    """Best SocketCAN module name for this vendor / driver."""
    if driver in VENDOR_BY_DRIVER:
        return driver
    return VENDOR_PRIMARY_MODULE.get(vendor, driver or "socketcan")


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def scan_modprobe_blacklist(modprobe_d: Path | None = None) -> list[dict[str, str]]:
    """Find Peak/Kvaser SocketCAN blacklist lines under /etc/modprobe.d."""
    root = modprobe_d if modprobe_d is not None else DEFAULT_MODPROBE_D
    hits: list[dict[str, str]] = []
    if not root.is_dir():
        return hits
    try:
        files = sorted(path for path in root.iterdir() if path.is_file() and path.suffix == ".conf")
    except OSError:
        return hits
    seen: set[tuple[str, str]] = set()
    for path in files:
        text = _read_text(path)
        if text is None:
            continue
        for raw in text.splitlines():
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                continue
            match = _BLACKLIST_LINE.match(stripped)
            if match is None:
                continue
            module = match.group("module")
            vendor = BLACKLIST_MODULES.get(module)
            if vendor is None:
                continue
            key = (vendor, module)
            if key in seen:
                continue
            seen.add(key)
            hits.append(
                {
                    "vendor": vendor,
                    "module": module,
                    "source": path.name,
                    "message": (
                        f"{module} is blacklisted in {path.name} "
                        f"({vendor} vendor SDK). Uninstall the proprietary "
                        f"driver and remove that file; see docs/socketcan-vendors.md."
                    ),
                }
            )
    return hits


def scan_proprietary_modules(sys_module: Path | None = None) -> list[dict[str, str]]:
    """Detect loaded Peak chardev / Kvaser LinuxCAN modules via /sys/module."""
    root = sys_module if sys_module is not None else DEFAULT_SYS_MODULE
    hits: list[dict[str, str]] = []
    if not root.is_dir():
        return hits
    for module, vendor in PROP_MODULES.items():
        if (root / module).is_dir():
            hits.append(
                {
                    "vendor": vendor,
                    "module": module,
                    "source": f"module:{module}",
                    "message": (
                        f"Proprietary {vendor} module {module} is loaded and "
                        f"typically replaces SocketCAN. Uninstall Peak chardev "
                        f"/ Kvaser LinuxCAN; VanillaBus uses mainline SocketCAN only."
                    ),
                }
            )
    return hits


def collect_blacklist_hits(
    modprobe_d: Path | None = None,
    sys_module: Path | None = None,
) -> list[dict[str, str]]:
    """Union of modprobe blacklist files and loaded proprietary modules."""
    hits = scan_modprobe_blacklist(modprobe_d)
    seen = {(item["vendor"], item["module"]) for item in hits}
    for item in scan_proprietary_modules(sys_module):
        key = (item["vendor"], item["module"])
        if key not in seen:
            hits.append(item)
            seen.add(key)
    return hits


def hits_for_vendor(hits: Iterable[dict[str, str]], vendor: str) -> list[dict[str, str]]:
    return [item for item in hits if item.get("vendor") == vendor]


def enrich_interface(
    info: dict[str, Any],
    hits: Iterable[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Add driver / vendor / module / blacklist fields. name/kind/state stay."""
    kind = str(info.get("kind") or "socketcan")
    vendor = vendor_for_driver(kind)
    module = module_for_vendor(vendor, kind)
    matched = hits_for_vendor(hits or (), vendor)
    enriched = dict(info)
    enriched["driver"] = kind
    enriched["vendor"] = vendor
    enriched["module"] = module
    enriched["blacklist"] = bool(matched)
    if matched:
        enriched["blacklist_reason"] = matched[0]["message"]
    return enriched


def list_warnings(hits: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    """Host-level warnings (also used when no matching SocketCAN iface exists)."""
    return [
        {
            "vendor": item["vendor"],
            "module": item["module"],
            "source": item["source"],
            "message": item["message"],
        }
        for item in hits
    ]
