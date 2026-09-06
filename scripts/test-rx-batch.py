#!/usr/bin/env python3
"""T5 raw RX stub: frame mapping, drop-oldest, optional vcan inject → rx.batch.

Unit tests never need a host CAN iface. The live IPC path opens vcan0, injects
a frame (python-can or cansend), and asserts rx.batch. If vcan0 is not UP:

    SKIP vcan0 RX inject: vcan0 is not UP on this host.
    Bring it up with: sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import os
import queue
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

from can_engine.bus import BusManager  # noqa: E402
from can_engine.framing import decode_payload, encode_message  # noqa: E402
from can_engine.rx import RxPump, message_to_frame  # noqa: E402

EXPECTED_CAN_ID = 0x42A
EXPECTED_DATA = bytes([0x11, 0x22, 0x33, 0x44])


class FakeMsg:
    def __init__(
        self,
        arbitration_id: int,
        data: bytes,
        *,
        is_extended_id: bool = False,
        is_fd: bool = False,
        bitrate_switch: bool = False,
        is_remote_frame: bool = False,
        is_error_frame: bool = False,
        dlc: int | None = None,
    ) -> None:
        self.arbitration_id = arbitration_id
        self.data = data
        self.is_extended_id = is_extended_id
        self.is_fd = is_fd
        self.bitrate_switch = bitrate_switch
        self.is_remote_frame = is_remote_frame
        self.is_error_frame = is_error_frame
        self.dlc = len(data) if dlc is None else dlc


class ScriptedBus:
    """python-can-like bus that yields injected messages from a queue."""

    def __init__(self) -> None:
        self._q: queue.Queue[FakeMsg] = queue.Queue()
        self.shutdowns = 0

    def inject(self, msg: FakeMsg) -> None:
        self._q.put(msg)

    def recv(self, timeout: float | None = None):
        try:
            return self._q.get(timeout=timeout if timeout is not None else 0.05)
        except queue.Empty:
            return None

    def shutdown(self) -> None:
        self.shutdowns += 1


def _fake_sysfs_vcan0(root: Path) -> Path:
    net = root / "net"
    virt = root / "devices" / "virtual" / "net" / "vcan0"
    virt.mkdir(parents=True)
    (virt / "type").write_text("280\n")
    (virt / "flags").write_text("0x41\n")
    net.mkdir()
    (net / "vcan0").symlink_to(virt)
    return net


def test_message_to_frame() -> None:
    frame = message_to_frame(
        FakeMsg(0x1ABCDE, bytes([0xDE, 0xAD]), is_extended_id=True, is_fd=True, bitrate_switch=True),
        "bus-1",
        "vcan0",
        ts_us=1_700_000_000_000_123,
    )
    assert frame["busId"] == "bus-1"
    assert frame["ifName"] == "vcan0"
    assert frame["can_id"] == 0x1ABCDE
    assert frame["data"] == "dead"
    assert frame["dlc"] == 2
    assert frame["is_eff"] is True
    assert frame["is_fd"] is True
    assert frame["brs"] is True
    assert frame["is_rtr"] is False
    assert frame["is_err"] is False
    assert frame["dir"] == "rx"
    assert frame["rate_ms"] is None
    assert frame["ts_us"] == 1_700_000_000_000_123
    print("message_to_frame: ok")


def test_drop_oldest_and_batch_cap() -> None:
    bus = ScriptedBus()
    pump = RxPump(bus, "bus-drop", "vcan0", queue_max=4)
    pump.start()
    try:
        for i in range(6):
            bus.inject(FakeMsg(0x100 + i, bytes([i])))
        deadline = time.time() + 1.0
        while pump.dropped < 2 and time.time() < deadline:
            time.sleep(0.01)
        first = pump.drain(500)
        assert pump.dropped >= 2
        assert len(first) <= 4
        ids = [frame["can_id"] for frame in first]
        assert 0x100 not in ids
        assert 0x105 in ids
        print(f"drop-oldest: dropped={pump.dropped} kept={ids}")
    finally:
        pump.stop()

    burst = ScriptedBus()
    manager_bus = burst
    net = _fake_sysfs_vcan0(Path(tempfile.mkdtemp(prefix="vanillabus-rx-sysfs-")))
    opened_buses: list[ScriptedBus] = []

    def opener(_name: str, _bitrate: int | None) -> ScriptedBus:
        opened_buses.append(manager_bus)
        return manager_bus

    manager = BusManager(sysfs_net=net, opener=opener)
    opened = manager.open("vcan0")
    try:
        for i in range(620):
            burst.inject(FakeMsg(0x200 + (i % 16), bytes([i & 0xFF])))
        deadline = time.time() + 2.0
        got: list[dict] = []
        while len(got) < 620 and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            assert len(frames) <= 500
            got.extend(frames)
            if not frames:
                time.sleep(0.01)
        assert len(got) == 620
        assert all(frame["dir"] == "rx" for frame in got)
        first_of_key: set[tuple[int, bool]] = set()
        for frame in got:
            key = (frame["can_id"], frame["is_eff"])
            if key not in first_of_key:
                assert frame["rate_ms"] is None
                first_of_key.add(key)
            else:
                assert isinstance(frame["rate_ms"], (int, float))
        assert all(frame["busId"] == opened["busId"] for frame in got)
        print(f"batch cap: received {len(got)} frames in chunks ≤500")
    finally:
        manager.close(opened["busId"])
        assert manager_bus.shutdowns == 1


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-rx-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-rx-"))
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


def _recv_until(sock: socket.socket, types: set[str], timeout: float = 2.0) -> dict:
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError(f"timed out waiting for {sorted(types)}")
        message = _recv_message(sock, timeout=remaining)
        if message.get("type") in types:
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


def _vcan0_up() -> bool:
    flags = Path("/sys/class/net/vcan0/flags")
    type_path = Path("/sys/class/net/vcan0/type")
    if not flags.is_file() or not type_path.is_file():
        return False
    try:
        if int(type_path.read_text().strip(), 0) != 280:
            return False
        return bool(int(flags.read_text().strip(), 0) & 0x1)
    except ValueError:
        return False


def _inject_frame() -> None:
    try:
        import can
    except ImportError:
        can = None
    if can is not None:
        bus = can.Bus(interface="socketcan", channel="vcan0")
        try:
            bus.send(
                can.Message(
                    arbitration_id=EXPECTED_CAN_ID,
                    data=EXPECTED_DATA,
                    is_extended_id=False,
                )
            )
        finally:
            bus.shutdown()
        return
    cansend = subprocess.run(
        ["cansend", "vcan0", f"{EXPECTED_CAN_ID:03X}#{EXPECTED_DATA.hex()}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if cansend.returncode != 0:
        raise RuntimeError(f"cansend failed: {cansend.stderr or cansend.stdout}")


def test_engine_ipc_rx() -> None:
    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello = _recv_until(sock, {"engine.hello"})
        if hello.get("type") != "engine.hello":
            raise AssertionError(f"expected engine.hello, got {hello!r}")

        if not _vcan0_up():
            print(
                "SKIP vcan0 RX inject: vcan0 is not UP on this host. "
                "Bring it up with: sudo ./scripts/setup-vcan.sh"
            )
            sock.close()
            return

        _send_message(sock, {"type": "bus.open", "id": "open-rx", "payload": {"name": "vcan0"}})
        opened = _recv_until(sock, {"bus.open", "engine.error"})
        if opened.get("type") != "bus.open":
            raise AssertionError(f"bus.open failed: {opened!r}")
        bus_id = opened.get("payload", {}).get("busId")
        if not isinstance(bus_id, str) or not bus_id:
            raise AssertionError(f"bus.open must return busId: {opened!r}")

        started = time.time()
        _inject_frame()
        matched = None
        deadline = time.time() + 0.2
        while time.time() < deadline:
            remaining = deadline - time.time()
            try:
                message = _recv_until(sock, {"rx.batch"}, timeout=max(remaining, 0.01))
            except TimeoutError:
                break
            frames = message.get("payload", {}).get("frames")
            if not isinstance(frames, list):
                raise AssertionError(f"rx.batch missing frames: {message!r}")
            assert len(frames) <= 500
            for frame in frames:
                if frame.get("can_id") == EXPECTED_CAN_ID:
                    matched = frame
                    break
            if matched is not None:
                break
        elapsed_ms = (time.time() - started) * 1000
        if matched is None:
            raise AssertionError(f"did not receive can_id=0x{EXPECTED_CAN_ID:X} within 200 ms")
        assert matched["busId"] == bus_id
        assert matched["ifName"] == "vcan0"
        assert matched["data"] == EXPECTED_DATA.hex()
        assert matched["dlc"] == 4
        assert matched["dir"] == "rx"
        assert matched["rate_ms"] is None
        assert matched["is_rtr"] is False
        assert matched["is_err"] is False
        assert isinstance(matched["ts_us"], int)
        print(f"rx.batch can_id=0x{EXPECTED_CAN_ID:X} in {elapsed_ms:.1f} ms: ok")

        _send_message(sock, {"type": "bus.close", "id": "close-rx", "payload": {"busId": bus_id}})
        _recv_until(sock, {"bus.close", "rx.batch"})
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
    test_message_to_frame()
    test_drop_oldest_and_batch_cap()
    test_engine_ipc_rx()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
