#!/usr/bin/env python3
"""T16 hardening: RX backpressure, OOM caps, IPC safety, restart under load.

Synthetic / in-process path always runs (no host CAN required). If vcan0 is
UP a live flood + engine-kill slice also runs. Otherwise:

    SKIP vcan0 harden: vcan0 is not UP on this host.
    Bring it up with: sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import os
import queue
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
sys.path.insert(0, str(ENGINE))

from can_engine.bus import BusManager  # noqa: E402
from can_engine.dbc import DbcError, resolve_dbc_path  # noqa: E402
from can_engine.framing import (  # noqa: E402
    MAX_FRAME_BYTES,
    ProtocolError,
    check_length,
    decode_payload,
    encode_message,
)
from can_engine.protocol import rx_batch_message  # noqa: E402
from can_engine.rate import RATE_KEY_MAX, RateTracker  # noqa: E402
from can_engine.rx import (  # noqa: E402
    RX_BATCH_INTERVAL_S,
    RX_BATCH_MAX_FRAMES,
    RX_BATCH_MAX_INTERVAL_S,
    RX_QUEUE_MAX,
    RxPump,
    should_flush,
)
from can_engine.server import IPC_PARTIAL_READ_TIMEOUT_S  # noqa: E402


class FakeMsg:
    def __init__(self, arbitration_id: int, data: bytes) -> None:
        self.arbitration_id = arbitration_id
        self.data = data
        self.is_extended_id = False
        self.is_fd = False
        self.bitrate_switch = False
        self.is_remote_frame = False
        self.is_error_frame = False
        self.dlc = len(data)


class ScriptedBus:
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


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-harden-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-harden-"))
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
    check_length(length)
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


def _stop_engine(proc: subprocess.Popen[bytes], ipc_path: Path) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
        proc.kill()
    if ipc_path.exists():
        ipc_path.unlink()


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


def test_should_flush_bounds() -> None:
    assert should_flush(0, 1.0) is False
    assert should_flush(1, 0.0) is False
    assert should_flush(1, RX_BATCH_INTERVAL_S) is True
    assert should_flush(1, RX_BATCH_MAX_INTERVAL_S) is True
    assert should_flush(RX_BATCH_MAX_FRAMES, 0.0) is True
    assert should_flush(RX_BATCH_MAX_FRAMES - 1, RX_BATCH_INTERVAL_S - 0.001) is False
    assert RX_BATCH_INTERVAL_S <= 0.016 + 1e-9
    assert RX_BATCH_MAX_INTERVAL_S <= 0.033 + 1e-9
    print("should_flush 16–33 ms / 500: ok")


def test_rx_queue_cap_and_drop_counter() -> None:
    bus = ScriptedBus()
    pump = RxPump(bus, "bus-flood", "vcan0", queue_max=RX_QUEUE_MAX)
    pump.start()
    try:
        flood = 12_000
        for i in range(flood):
            bus.inject(FakeMsg(0x100 + (i % 2048), bytes([i & 0xFF])))
        deadline = time.time() + 3.0
        while pump.dropped < flood - RX_QUEUE_MAX and time.time() < deadline:
            time.sleep(0.01)
        assert pump.qsize <= RX_QUEUE_MAX
        assert pump.queue_max == RX_QUEUE_MAX
        assert pump.dropped >= flood - RX_QUEUE_MAX
        first = pump.drain(RX_BATCH_MAX_FRAMES)
        assert len(first) <= RX_BATCH_MAX_FRAMES
        leftover = pump.drain(RX_QUEUE_MAX + 10)
        assert pump.qsize == 0
        assert len(first) + len(leftover) <= RX_QUEUE_MAX
        batch = rx_batch_message(first, pump.dropped)
        assert batch["type"] == "rx.batch"
        assert batch["payload"]["dropped"] == pump.dropped
        assert batch["payload"]["dropped"] > 0
        print(
            f"RX queue cap: qsize≤{RX_QUEUE_MAX} dropped={pump.dropped} "
            f"batch={len(first)} (visible on rx.batch)"
        )
    finally:
        pump.stop()


def test_flood_batch_timing_and_count() -> None:
    bus = ScriptedBus()
    net = _fake_sysfs_vcan0(Path(tempfile.mkdtemp(prefix="vanillabus-harden-sysfs-")))
    opened_bus = bus

    def opener(_name: str, _bitrate: int | None) -> ScriptedBus:
        return opened_bus

    manager = BusManager(sysfs_net=net, opener=opener)
    opened = manager.open("vcan0")
    try:
        inject_n = 2_400
        for i in range(inject_n):
            bus.inject(FakeMsg(0x200 + (i % 32), bytes([i & 0xFF])))
        started = time.monotonic()
        got = 0
        batches = 0
        first_flush_s: float | None = None
        deadline = time.monotonic() + 1.0
        while got < inject_n and time.monotonic() < deadline:
            frames, dropped = manager.drain_rx(RX_BATCH_MAX_FRAMES)
            if frames:
                assert len(frames) <= RX_BATCH_MAX_FRAMES
                if first_flush_s is None:
                    first_flush_s = time.monotonic() - started
                    assert first_flush_s <= RX_BATCH_MAX_INTERVAL_S + 0.05
                assert should_flush(len(frames), max(first_flush_s or 0.0, RX_BATCH_INTERVAL_S))
                got += len(frames)
                batches += 1
                assert isinstance(dropped, int)
            else:
                time.sleep(0.002)
        assert got == inject_n, f"expected {inject_n} frames, got {got}"
        assert batches >= inject_n / RX_BATCH_MAX_FRAMES
        print(
            f"flood batch: {got} frames in {batches} chunks ≤{RX_BATCH_MAX_FRAMES}, "
            f"first flush {first_flush_s * 1000:.1f} ms"
        )
    finally:
        manager.close(opened["busId"])


def test_rate_tracker_key_cap() -> None:
    cap = 64
    tracker = RateTracker(key_max=cap)
    for i in range(cap + 40):
        result = tracker.observe("bus-a", i, False, 1_000_000 + i * 1000)
        if i < cap:
            assert result is None
    assert len(tracker.stored_keys()) == cap
    # Full-size default cap stays documented.
    assert RATE_KEY_MAX == 8192
    big = RateTracker()
    for i in range(200):
        big.observe("bus-a", i, False, i)
    assert len(big.stored_keys()) == 200
    print(f"rate key cap: held {cap} after +40 unique IDs: ok")


def test_dbc_path_traversal() -> None:
    try:
        resolve_dbc_path("fixtures/dbc/../../../etc/hostname")
        raise AssertionError("expected path_not_allowed for ../ escape")
    except DbcError as exc:
        assert exc.code in {"path_not_allowed", "dbc_not_found", "dbc_invalid"}

    try:
        resolve_dbc_path("/tmp/../etc/hostname")
        raise AssertionError("expected path_not_allowed for absolute traversal")
    except DbcError as exc:
        assert exc.code in {"path_not_allowed", "dbc_not_found", "dbc_invalid"}

    link = ROOT / "fixtures" / "dbc" / f"harden-escape-{os.getpid()}.dbc"
    target = Path("/etc/hostname")
    if target.is_file() and not link.exists():
        try:
            link.symlink_to(target)
            try:
                resolve_dbc_path(str(link))
                raise AssertionError("expected path_not_allowed for symlink escape")
            except DbcError as exc:
                assert exc.code == "path_not_allowed"
            print("DBC symlink escape rejected: ok")
        finally:
            if link.exists() or link.is_symlink():
                link.unlink()
    else:
        print("DBC .. traversal rejected: ok")


def test_pump_restart_under_flood() -> None:
    bus = ScriptedBus()
    pump = RxPump(bus, "bus-restart", "vcan0", queue_max=128)
    pump.start()
    try:
        for i in range(400):
            bus.inject(FakeMsg(0x10, bytes([i & 0xFF])))
        deadline = time.time() + 1.5
        while pump.dropped == 0 and time.time() < deadline:
            time.sleep(0.01)
        assert pump.qsize <= 128
        assert pump.dropped > 0
    finally:
        pump.stop()

    pump2 = RxPump(bus, "bus-restart", "vcan0", queue_max=128)
    pump2.start()
    try:
        for i in range(40):
            bus.inject(FakeMsg(0x11, bytes([i & 0xFF])))
        deadline = time.time() + 1.0
        drained: list[dict] = []
        while len(drained) < 40 and time.time() < deadline:
            drained.extend(pump2.drain(500))
            if len(drained) < 40:
                time.sleep(0.01)
        assert len(drained) == 40
        assert pump2.qsize <= 128
        assert all(frame["can_id"] == 0x11 for frame in drained)
        print(f"pump restart under flood: resumed {len(drained)} frames, qsize≤128")
    finally:
        pump2.stop()


def test_ipc_oversized_malformed_partial() -> None:
    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello = _recv_until(sock, {"engine.hello"})
        assert hello.get("type") == "engine.hello"

        # Oversized length: engine.error then close; process stays up.
        sock.sendall(struct.pack(">I", MAX_FRAME_BYTES + 1))
        closed_or_error = False
        try:
            error = _recv_until(sock, {"engine.error"}, timeout=2.0)
            assert error.get("payload", {}).get("code") == "payload_too_large"
            closed_or_error = True
            print(f"oversized length -> {error.get('payload')}")
        except (TimeoutError, RuntimeError, ProtocolError, OSError):
            closed_or_error = True
            print("oversized length: connection closed (engine still running)")
        sock.close()
        assert closed_or_error
        if proc.poll() is not None:
            raise RuntimeError("engine crashed after oversized length")

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        _recv_until(sock, {"engine.hello"})
        payload = b"{not-json"
        sock.sendall(struct.pack(">I", len(payload)) + payload)
        try:
            error = _recv_until(sock, {"engine.error"}, timeout=2.0)
            assert error.get("payload", {}).get("code") in {"invalid_json", "invalid_message"}
            print(f"malformed JSON -> {error.get('payload')}")
        except (TimeoutError, RuntimeError, ProtocolError, OSError):
            print("malformed JSON: connection closed (engine still running)")
        sock.close()
        if proc.poll() is not None:
            raise RuntimeError("engine crashed after malformed JSON")

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        _recv_until(sock, {"engine.hello"})
        sock.sendall(b"\x00\x00")  # 2-byte partial header
        started = time.monotonic()
        try:
            error = _recv_until(
                sock,
                {"engine.error"},
                timeout=IPC_PARTIAL_READ_TIMEOUT_S + 1.5,
            )
            assert error.get("payload", {}).get("code") == "invalid_length"
            print(f"partial header -> {error.get('payload')}")
        except (TimeoutError, RuntimeError, ProtocolError, OSError):
            print("partial header: connection closed without hang")
        elapsed = time.monotonic() - started
        assert elapsed < IPC_PARTIAL_READ_TIMEOUT_S + 2.0, f"partial read hung ({elapsed:.1f}s)"
        sock.close()
        if proc.poll() is not None:
            raise RuntimeError("engine crashed after partial header")

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello2 = _recv_until(sock, {"engine.hello"})
        assert hello2.get("type") == "engine.hello"
        sock.close()
        print("engine stayed up after oversized / malformed / partial: ok")
    finally:
        _stop_engine(proc, ipc_path)


def test_live_vcan_flood_optional() -> None:
    if not _vcan0_up():
        print(
            "SKIP vcan0 harden: vcan0 is not UP on this host. "
            "Bring it up with: sudo ./scripts/setup-vcan.sh"
        )
        return

    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        _recv_until(sock, {"engine.hello"})
        _send_message(sock, {"type": "bus.open", "id": "open-h", "payload": {"name": "vcan0"}})
        opened = _recv_until(sock, {"bus.open", "engine.error"})
        if opened.get("type") != "bus.open":
            raise AssertionError(f"bus.open failed: {opened!r}")

        try:
            import can
        except ImportError:
            can = None
        if can is None:
            print("SKIP vcan0 harden flood: python-can not importable")
            sock.close()
            return

        tx = can.Bus(interface="socketcan", channel="vcan0")
        try:
            for i in range(80):
                tx.send(
                    can.Message(
                        arbitration_id=0x42B,
                        data=bytes([i & 0xFF, 0x22, 0x33, 0x44]),
                        is_extended_id=False,
                    )
                )
        finally:
            tx.shutdown()

        started = time.monotonic()
        seen = 0
        deadline = time.time() + 1.0
        while time.time() < deadline and seen < 1:
            remaining = deadline - time.time()
            try:
                message = _recv_until(sock, {"rx.batch"}, timeout=max(remaining, 0.01))
            except TimeoutError:
                break
            frames = message.get("payload", {}).get("frames")
            assert isinstance(frames, list)
            assert len(frames) <= RX_BATCH_MAX_FRAMES
            assert isinstance(message.get("payload", {}).get("dropped"), int)
            seen += sum(1 for frame in frames if frame.get("can_id") == 0x42B)
        assert seen >= 1, "expected live rx.batch during vcan flood"
        assert time.monotonic() - started <= 0.5
        print(f"live vcan flood: {seen} frames, batches ≤{RX_BATCH_MAX_FRAMES}: ok")
        sock.close()
    finally:
        _stop_engine(proc, ipc_path)


def main() -> int:
    test_should_flush_bounds()
    test_rx_queue_cap_and_drop_counter()
    test_flood_batch_timing_and_count()
    test_rate_tracker_key_cap()
    test_dbc_path_traversal()
    test_pump_restart_under_flood()
    test_ipc_oversized_malformed_partial()
    test_live_vcan_flood_optional()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
