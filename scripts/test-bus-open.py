#!/usr/bin/env python3
"""bus.list / bus.open / bus.close over engine IPC.

Always checks missing-iface engine.error. The vcan0 open/close/reopen path
runs only when vcan0 exists and is UP. Otherwise it skips with a clear
message (no sudo from this script). Bring vcan0 up with:

    sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
sys.path.insert(0, str(ENGINE))

from can_engine.bus import BusError, BusManager, list_interfaces  # noqa: E402
from can_engine.framing import decode_payload, encode_message  # noqa: E402


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-bus-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-bus-"))
    os.chmod(directory, 0o700)
    return directory / "engine.sock"


def _recv_message(sock: socket.socket, timeout: float = 3.0) -> dict:
    sock.settimeout(timeout)
    header = b""
    while len(header) < 4:
        chunk = sock.recv(4 - len(header))
        if not chunk:
            raise RuntimeError("engine closed the socket while reading length")
        header += chunk
    length = int.from_bytes(header, "big")
    payload = b""
    while len(payload) < length:
        chunk = sock.recv(length - len(payload))
        if not chunk:
            raise RuntimeError("engine closed the socket while reading JSON")
        payload += chunk
    return decode_payload(payload)


def _recv_skip_heartbeat(sock: socket.socket, timeout: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError("timed out waiting for a non-heartbeat message")
        message = _recv_message(sock, timeout=remaining)
        if message.get("type") != "engine.heartbeat":
            return message


def _send_message(sock: socket.socket, message: dict) -> None:
    sock.sendall(encode_message(message))


def _start_engine(ipc_path: Path) -> subprocess.Popen[bytes]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ENGINE) if not existing else f"{ENGINE}{os.pathsep}{existing}"
    proc = subprocess.Popen(
        [sys.executable, "-m", "can_engine", "--ipc", str(ipc_path)],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    deadline = time.time() + 5
    while time.time() < deadline:
        if proc.poll() is not None:
            output = proc.stdout.read().decode("utf-8", errors="replace") if proc.stdout else ""
            raise RuntimeError(f"engine exited early ({proc.returncode}): {output}")
        if ipc_path.exists():
            return proc
        time.sleep(0.05)
    proc.kill()
    raise RuntimeError(f"engine did not create socket {ipc_path}")


class FakeBus:
    def __init__(self) -> None:
        self.shutdowns = 0

    def recv(self, timeout: float | None = None):
        if timeout:
            time.sleep(min(float(timeout), 0.02))
        return None

    def shutdown(self) -> None:
        self.shutdowns += 1


def test_list_and_manager_without_host_vcan() -> None:
    root = Path(tempfile.mkdtemp(prefix="vanillabus-sysfs-"))
    net = root / "net"
    virt = root / "devices" / "virtual" / "net" / "vcan0"
    virt.mkdir(parents=True)
    (virt / "type").write_text("280\n")
    (virt / "flags").write_text("0x41\n")
    net.mkdir()
    (net / "vcan0").symlink_to(virt)

    can0 = net / "can0"
    can0.mkdir()
    (can0 / "type").write_text("280\n")
    (can0 / "flags").write_text("0x0\n")
    driver = root / "drivers" / "mcp251x"
    driver.mkdir(parents=True)
    (can0 / "device").mkdir()
    (can0 / "device" / "driver").symlink_to(driver)

    eth = net / "eth0"
    eth.mkdir()
    (eth / "type").write_text("1\n")
    (eth / "flags").write_text("0x1003\n")

    listed = {item["name"]: item for item in list_interfaces(net)}
    assert "eth0" not in listed
    assert listed["vcan0"]["kind"] == "vcan"
    assert listed["vcan0"]["state"] == "up"
    assert listed["can0"]["kind"] == "mcp251x"
    assert listed["can0"]["state"] == "down"
    print("sysfs list (up vcan + down can, skip eth0): ok")

    opened: list[tuple[str, int | None]] = []

    def opener(name: str, bitrate: int | None) -> FakeBus:
        opened.append((name, bitrate))
        return FakeBus()

    manager = BusManager(sysfs_net=net, opener=opener)

    try:
        manager.open("missing0")
    except BusError as exc:
        assert exc.code == "iface_not_found"
    else:
        raise AssertionError("missing iface must fail")

    try:
        manager.open("can0")
    except BusError as exc:
        assert exc.code == "iface_down"
        assert "will not ip link set up" in exc.message
    else:
        raise AssertionError("down iface must fail without bringing it up")

    try:
        manager.open("eth0")
    except BusError as exc:
        assert exc.code == "iface_not_found"
    else:
        raise AssertionError("non-CAN iface must fail")

    first = manager.open("vcan0", 500000)
    assert "busId" in first
    assert opened[-1] == ("vcan0", None)  # bitrate ignored for vcan
    manager.close(first["busId"])
    second = manager.open("vcan0")
    assert second["busId"] != first["busId"]
    try:
        manager.close(first["busId"])
    except BusError as exc:
        assert exc.code == "bus_not_found"
    else:
        raise AssertionError("close of a stale busId must fail")
    manager.close(second["busId"])
    print("BusManager open/close/reopen + structured errors: ok")


def test_engine_ipc() -> None:
    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello = _recv_skip_heartbeat(sock)
        if hello.get("type") != "engine.hello":
            raise AssertionError(f"expected engine.hello, got {hello!r}")

        _send_message(sock, {"type": "bus.list", "id": "list-1", "payload": {}})
        listed = _recv_skip_heartbeat(sock)
        if listed.get("type") != "bus.list" or listed.get("id") != "list-1":
            raise AssertionError(f"bus.list failed: {listed!r}")
        interfaces = listed.get("payload", {}).get("interfaces")
        if not isinstance(interfaces, list):
            raise AssertionError(f"interfaces must be a list: {listed!r}")
        print("bus.list payload:")
        print(json.dumps(listed.get("payload"), indent=2, sort_keys=True))

        _send_message(
            sock,
            {"type": "bus.open", "id": "open-missing", "payload": {"name": "vb_missing0"}},
        )
        missing = _recv_skip_heartbeat(sock)
        if missing.get("type") != "engine.error" or missing.get("id") != "open-missing":
            raise AssertionError(f"expected engine.error for missing iface, got {missing!r}")
        code = missing.get("payload", {}).get("code")
        if code != "iface_not_found":
            raise AssertionError(f"expected iface_not_found, got {missing!r}")
        print(f"missing iface → {missing.get('payload')}")

        vcan = next((item for item in interfaces if item.get("name") == "vcan0"), None)
        if vcan is None or vcan.get("state") != "up":
            print(
                "SKIP vcan0 open/close/reopen: vcan0 is not UP on this host. "
                "Bring it up with: sudo ./scripts/setup-vcan.sh"
            )
            return

        _send_message(
            sock,
            {"type": "bus.open", "id": "open-1", "payload": {"name": "vcan0", "bitrate": 500000}},
        )
        opened = _recv_skip_heartbeat(sock)
        if opened.get("type") != "bus.open" or opened.get("id") != "open-1":
            raise AssertionError(f"bus.open failed: {opened!r}")
        bus_id = opened.get("payload", {}).get("busId")
        if not isinstance(bus_id, str) or not bus_id:
            raise AssertionError(f"bus.open must return busId: {opened!r}")
        print(f"bus.open vcan0 → busId={bus_id}")

        _send_message(sock, {"type": "bus.close", "id": "close-1", "payload": {"busId": bus_id}})
        closed = _recv_skip_heartbeat(sock)
        if closed.get("type") != "bus.close" or closed.get("payload", {}).get("ok") is not True:
            raise AssertionError(f"bus.close failed: {closed!r}")
        print("bus.close: ok")

        _send_message(sock, {"type": "bus.open", "id": "open-2", "payload": {"name": "vcan0"}})
        reopened = _recv_skip_heartbeat(sock)
        bus_id_2 = reopened.get("payload", {}).get("busId")
        if reopened.get("type") != "bus.open" or not isinstance(bus_id_2, str):
            raise AssertionError(f"reopen failed: {reopened!r}")
        if bus_id_2 == bus_id:
            raise AssertionError("reopen must allocate a new busId")
        print(f"reopen vcan0 → busId={bus_id_2}")
        _send_message(sock, {"type": "bus.close", "id": "close-2", "payload": {"busId": bus_id_2}})
        _recv_skip_heartbeat(sock)
        sock.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        if ipc_path.exists():
            ipc_path.unlink()


def main() -> int:
    test_list_and_manager_without_host_vcan()
    test_engine_ipc()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
