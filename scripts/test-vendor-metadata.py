#!/usr/bin/env python3
"""T15 vendor metadata + Peak/Kvaser blacklist helpers (offline)."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
sys.path.insert(0, str(ENGINE))

from can_engine.bus import list_bus_payload, list_interfaces  # noqa: E402
from can_engine.vendor import (  # noqa: E402
    collect_blacklist_hits,
    enrich_interface,
    module_for_vendor,
    scan_modprobe_blacklist,
    scan_proprietary_modules,
    vendor_for_driver,
)


def _fake_can(net: Path, name: str, type_code: str, flags: str, driver: str | None = None) -> None:
    iface = net / name
    iface.mkdir()
    (iface / "type").write_text(f"{type_code}\n")
    (iface / "flags").write_text(f"{flags}\n")
    if driver:
        drv = net.parent / "drivers" / driver
        drv.mkdir(parents=True, exist_ok=True)
        (iface / "device").mkdir()
        (iface / "device" / "driver").symlink_to(drv)


def test_vendor_map() -> None:
    assert vendor_for_driver("peak_usb") == "peak"
    assert vendor_for_driver("kvaser_usb") == "kvaser"
    assert vendor_for_driver("ix_usb_can") == "ixxat"
    assert vendor_for_driver("vcan") == "virtual"
    assert vendor_for_driver("mcp251x") == "microchip"
    assert vendor_for_driver("unknown_drv") == "unknown"
    assert module_for_vendor("peak", "peak_usb") == "peak_usb"
    assert module_for_vendor("ixxat") == "ix_usb_can"
    print("vendor_for_driver / module_for_vendor: ok")


def test_blacklist_files_and_modules() -> None:
    root = Path(tempfile.mkdtemp(prefix="vanillabus-vendor-"))
    modprobe = root / "modprobe.d"
    modprobe.mkdir()
    (modprobe / "blacklist-peak.conf").write_text(
        "# Peak chardev installer\nblacklist peak_usb\nblacklist peak_pciefd\n"
    )
    (modprobe / "kvaser.conf").write_text("blacklist kvaser_usb\ninstall kvaser_pci /bin/true\n")
    (modprobe / "ignore.conf").write_text("blacklist ipv6\n")
    (modprobe / "notes.txt").write_text("blacklist peak_usb\n")

    file_hits = scan_modprobe_blacklist(modprobe)
    modules = {item["module"] for item in file_hits}
    assert modules == {"peak_usb", "peak_pciefd", "kvaser_usb", "kvaser_pci"}
    assert any(item["source"] == "blacklist-peak.conf" for item in file_hits)
    assert any(item["vendor"] == "kvaser" for item in file_hits)

    sys_module = root / "module"
    (sys_module / "pcan").mkdir(parents=True)
    (sys_module / "leaf").mkdir()
    prop = scan_proprietary_modules(sys_module)
    assert {item["module"] for item in prop} == {"pcan", "leaf"}

    combined = collect_blacklist_hits(modprobe, sys_module)
    assert any(item["module"] == "pcan" for item in combined)
    assert any(item["module"] == "peak_usb" for item in combined)
    print("modprobe + proprietary module scan: ok")


def test_enrich_and_list_payload() -> None:
    root = Path(tempfile.mkdtemp(prefix="vanillabus-sysfs-"))
    net = root / "net"
    net.mkdir()
    virt = root / "devices" / "virtual" / "net" / "vcan0"
    virt.mkdir(parents=True)
    (virt / "type").write_text("280\n")
    (virt / "flags").write_text("0x41\n")
    (net / "vcan0").symlink_to(virt)
    _fake_can(net, "can0", "280", "0x0", "peak_usb")
    _fake_can(net, "can1", "280", "0x41", "ix_usb_can")
    eth = net / "eth0"
    eth.mkdir()
    (eth / "type").write_text("1\n")
    (eth / "flags").write_text("0x1003\n")

    modprobe = root / "modprobe.d"
    modprobe.mkdir()
    (modprobe / "blacklist-peak.conf").write_text("blacklist peak_usb\n")
    sys_module = root / "module"
    sys_module.mkdir()

    empty = root / "empty-modprobe"
    empty.mkdir()
    listed = {item["name"]: item for item in list_interfaces(net, modprobe_d=empty, sys_module=sys_module)}
    assert "eth0" not in listed
    assert listed["vcan0"]["kind"] == "vcan"
    assert listed["vcan0"]["vendor"] == "virtual"
    assert listed["vcan0"]["blacklist"] is False
    assert listed["can0"]["kind"] == "peak_usb"
    assert listed["can0"]["vendor"] == "peak"
    assert listed["can0"]["module"] == "peak_usb"
    assert listed["can0"]["driver"] == "peak_usb"
    assert listed["can1"]["vendor"] == "ixxat"
    assert listed["can1"]["module"] == "ix_usb_can"
    print("synthetic list metadata (no blacklist): ok")

    payload = list_bus_payload(net, modprobe_d=modprobe, sys_module=sys_module)
    by_name = {item["name"]: item for item in payload["interfaces"]}
    assert by_name["can0"]["blacklist"] is True
    assert "peak_usb" in by_name["can0"]["blacklist_reason"]
    assert by_name["vcan0"]["blacklist"] is False
    assert by_name["can1"]["blacklist"] is False
    assert payload["warnings"]
    assert payload["warnings"][0]["vendor"] == "peak"
    assert payload["warnings"][0]["module"] == "peak_usb"
    print("synthetic list payload with Peak blacklist: ok")

    bare = enrich_interface({"name": "can9", "kind": "kvaser_usb", "state": "up"}, [])
    assert bare["vendor"] == "kvaser"
    assert bare["blacklist"] is False
    assert "name" in bare and "kind" in bare and "state" in bare
    print("enrich_interface backward-compatible keys: ok")


def test_docs_present() -> None:
    vendors = (ROOT / "docs" / "socketcan-vendors.md").read_text(encoding="utf-8")
    assert "peak_usb" in vendors
    assert "kvaser_usb" in vendors
    assert "ix_usb_can" in vendors
    assert "22.04" in vendors and "24.04" in vendors
    assert "CONFIG_CAN_IXXAT_USB" in vendors
    assert "blacklist-peak.conf" in vendors
    assert "LinuxCAN" in vendors
    assert "chardev" in vendors.lower() or "chardev" in vendors
    fd = (ROOT / "docs" / "can-fd.md").read_text(encoding="utf-8")
    assert "is_fd" in fd
    assert "docs only" in fd.lower() or "does **not**" in fd
    priv = (ROOT / "docs" / "privileges.md").read_text(encoding="utf-8")
    assert "pkexec" in priv
    assert "cap_net_admin" in priv
    assert "Electron" in priv
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "docs/socketcan-vendors.md" in readme
    assert "docs/can-fd.md" in readme
    print("T15 docs matrix + privilege + FD checklist linked: ok")


def main() -> int:
    test_vendor_map()
    test_blacklist_files_and_modules()
    test_enrich_and_list_payload()
    test_docs_present()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
