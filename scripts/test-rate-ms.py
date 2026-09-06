#!/usr/bin/env python3
"""T6 last inter-arrival rate_ms: synthetic timestamps + optional vcan.

Acceptance: after ≥50 samples at a 10 ms period, median rate_ms is within
±1 ms (synthetic timestamps). Live vcan uses ±2 ms because host scheduling
jitter on SocketCAN inject is not a hardware capture clock.

If vcan0 is not UP:

    SKIP vcan0 rate inject: vcan0 is not UP on this host.
    Bring it up with: sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import os
import queue
import socket
import statistics
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
from can_engine.rate import RateTracker  # noqa: E402
from can_engine.rx import RxPump, message_to_frame  # noqa: E402

PERIOD_MS = 10.0
PERIOD_US = 10_000
SYNTHETIC_TOLERANCE_MS = 1.0
LIVE_TOLERANCE_MS = 2.0
SAMPLE_COUNT = 51  # first is null, then ≥50 rates
EXPECTED_CAN_ID = 0x321
EXPECTED_DATA = bytes([0xAA, 0xBB, 0xCC, 0xDD])


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
        ts_us: int | None = None,
    ) -> None:
        self.arbitration_id = arbitration_id
        self.data = data
        self.is_extended_id = is_extended_id
        self.is_fd = is_fd
        self.bitrate_switch = bitrate_switch
        self.is_remote_frame = is_remote_frame
        self.is_error_frame = is_error_frame
        self.dlc = len(data) if dlc is None else dlc
        self.ts_us = ts_us


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


def _median(values: list[float]) -> float:
    return float(statistics.median(values))


def test_first_sample_null_then_last_interval() -> None:
    tracker = RateTracker()
    first = tracker.observe("bus-a", 0x123, False, 1_000_000)
    second = tracker.observe("bus-a", 0x123, False, 1_000_000 + PERIOD_US)
    third = tracker.observe("bus-a", 0x123, False, 1_000_000 + 2 * PERIOD_US + 500)
    assert first is None
    assert second == 10.0
    assert third == 10.5
    print("first sample null / last interval: ok")


def test_key_is_bus_id_can_id_is_eff_not_is_fd() -> None:
    tracker = RateTracker()
    assert tracker.observe("bus-a", 0x10, False, 1_000) is None
    # Different busId / can_id / is_eff are independent first samples.
    assert tracker.observe("bus-b", 0x10, False, 2_000) is None
    assert tracker.observe("bus-a", 0x11, False, 3_000) is None
    assert tracker.observe("bus-a", 0x10, True, 4_000) is None
    # Same (busId, can_id, is_eff): last interval, even if is_fd would differ.
    rate = tracker.observe("bus-a", 0x10, False, 1_000 + PERIOD_US)
    assert rate == 10.0
    print("rate key (busId, can_id, is_eff): ok")


def test_clear_bus_resets_first_sample() -> None:
    tracker = RateTracker()
    assert tracker.observe("bus-a", 0x5, False, 100) is None
    assert tracker.observe("bus-a", 0x5, False, 100 + PERIOD_US) == 10.0
    tracker.observe("bus-b", 0x5, False, 200)
    tracker.clear_bus("bus-a")
    assert tracker.observe("bus-a", 0x5, False, 300) is None
    assert tracker.observe("bus-b", 0x5, False, 200 + PERIOD_US) == 10.0
    print("clear_bus: ok")


def test_synthetic_10ms_median() -> None:
    tracker = RateTracker()
    start_us = 50_000_000
    rates: list[float] = []
    for i in range(SAMPLE_COUNT):
        rate = tracker.observe("bus-med", 0x42A, False, start_us + i * PERIOD_US)
        if i == 0:
            assert rate is None
        else:
            assert isinstance(rate, float)
            rates.append(rate)
    assert len(rates) >= 50
    median = _median(rates)
    assert abs(median - PERIOD_MS) <= SYNTHETIC_TOLERANCE_MS, (
        f"synthetic median {median} not within ±{SYNTHETIC_TOLERANCE_MS} ms of {PERIOD_MS}"
    )
    print(
        f"synthetic 10 ms median: n={len(rates)} median={median} "
        f"(tol ±{SYNTHETIC_TOLERANCE_MS} ms): ok"
    )


def test_pump_attaches_rate_from_synthetic_ts_us() -> None:
    bus = ScriptedBus()
    tracker = RateTracker()
    pump = RxPump(bus, "bus-pump", "vcan0", rates=tracker)
    pump.start()
    try:
        start_us = 10_000_000
        for i in range(SAMPLE_COUNT):
            bus.inject(
                FakeMsg(
                    EXPECTED_CAN_ID,
                    EXPECTED_DATA,
                    ts_us=start_us + i * PERIOD_US,
                )
            )
        deadline = time.time() + 2.0
        frames: list[dict] = []
        while len(frames) < SAMPLE_COUNT and time.time() < deadline:
            frames.extend(pump.drain(SAMPLE_COUNT))
            if len(frames) < SAMPLE_COUNT:
                time.sleep(0.01)
        assert len(frames) == SAMPLE_COUNT
        assert frames[0]["rate_ms"] is None
        rates = [frame["rate_ms"] for frame in frames[1:]]
        assert all(isinstance(rate, (int, float)) for rate in rates)
        median = _median([float(rate) for rate in rates])
        assert abs(median - PERIOD_MS) <= SYNTHETIC_TOLERANCE_MS
        mapped = message_to_frame(FakeMsg(1, b"\x00"), "bus-pump", "vcan0", ts_us=1)
        assert mapped["rate_ms"] is None
        print(f"RxPump synthetic ts_us median={median}: ok")
    finally:
        pump.stop()


def test_bus_close_clears_rate_state() -> None:
    net = Path(tempfile.mkdtemp(prefix="vanillabus-rate-sysfs-"))
    virt = net / "devices" / "virtual" / "net" / "vcan0"
    virt.mkdir(parents=True)
    (virt / "type").write_text("280\n")
    (virt / "flags").write_text("0x41\n")
    sysfs = net / "net"
    sysfs.mkdir()
    (sysfs / "vcan0").symlink_to(virt)

    scripted = ScriptedBus()

    def opener(_name: str, _bitrate: int | None) -> ScriptedBus:
        return scripted

    manager = BusManager(sysfs_net=sysfs, opener=opener)
    opened = manager.open("vcan0")
    bus_id = opened["busId"]
    start_us = 20_000_000
    try:
        scripted.inject(FakeMsg(0x100, b"\x01", ts_us=start_us))
        scripted.inject(FakeMsg(0x100, b"\x01", ts_us=start_us + PERIOD_US))
        deadline = time.time() + 1.0
        got: list[dict] = []
        while len(got) < 2 and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            got.extend(frames)
            if len(got) < 2:
                time.sleep(0.01)
        assert len(got) == 2
        assert got[0]["rate_ms"] is None
        assert got[1]["rate_ms"] == 10.0
        assert any(key[0] == bus_id for key in manager._rates.stored_keys())
    finally:
        manager.close(bus_id)
    assert all(key[0] != bus_id for key in manager._rates.stored_keys())

    reopened = manager.open("vcan0")
    try:
        scripted.inject(FakeMsg(0x100, b"\x01", ts_us=start_us + 5 * PERIOD_US))
        deadline = time.time() + 1.0
        got = []
        while not got and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            got.extend(frames)
            if not got:
                time.sleep(0.01)
        assert len(got) == 1
        assert got[0]["rate_ms"] is None, "first sample after bus.close must be null"
        print("bus.close clears rate state: ok")
    finally:
        manager.close(reopened["busId"])


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-rate-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-rate-"))
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


def test_engine_ipc_vcan_median() -> None:
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
                "SKIP vcan0 rate inject: vcan0 is not UP on this host. "
                "Bring it up with: sudo ./scripts/setup-vcan.sh"
            )
            sock.close()
            return

        _send_message(sock, {"type": "bus.open", "id": "open-rate", "payload": {"name": "vcan0"}})
        opened = _recv_until(sock, {"bus.open", "engine.error"})
        if opened.get("type") != "bus.open":
            raise AssertionError(f"bus.open failed: {opened!r}")
        bus_id = opened.get("payload", {}).get("busId")
        if not isinstance(bus_id, str) or not bus_id:
            raise AssertionError(f"bus.open must return busId: {opened!r}")

        period_s = PERIOD_MS / 1000.0
        for _ in range(SAMPLE_COUNT):
            _inject_frame()
            time.sleep(period_s)

        rates: list[float] = []
        deadline = time.time() + 2.0
        while time.time() < deadline and len(rates) < 50:
            remaining = deadline - time.time()
            try:
                message = _recv_until(sock, {"rx.batch"}, timeout=max(remaining, 0.01))
            except TimeoutError:
                break
            frames = message.get("payload", {}).get("frames")
            if not isinstance(frames, list):
                raise AssertionError(f"rx.batch missing frames: {message!r}")
            for frame in frames:
                if frame.get("can_id") != EXPECTED_CAN_ID or frame.get("busId") != bus_id:
                    continue
                rate = frame.get("rate_ms")
                if rate is None:
                    continue
                if not isinstance(rate, (int, float)):
                    raise AssertionError(f"rate_ms must be number or null: {frame!r}")
                rates.append(float(rate))

        if len(rates) < 50:
            raise AssertionError(f"expected ≥50 rate_ms samples, got {len(rates)}")
        median = _median(rates[:50] if len(rates) > 50 else rates)
        # Live inject uses sleep() + software ts_us; accept ±2 ms (documented).
        assert abs(median - PERIOD_MS) <= LIVE_TOLERANCE_MS, (
            f"live median {median} not within ±{LIVE_TOLERANCE_MS} ms of {PERIOD_MS}"
        )
        print(
            f"vcan 10 ms median: n={len(rates)} median={median} "
            f"(tol ±{LIVE_TOLERANCE_MS} ms): ok"
        )

        _send_message(sock, {"type": "bus.close", "id": "close-rate", "payload": {"busId": bus_id}})
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
    test_first_sample_null_then_last_interval()
    test_key_is_bus_id_can_id_is_eff_not_is_fd()
    test_clear_bus_resets_first_sample()
    test_synthetic_10ms_median()
    test_pump_attaches_rate_from_synthetic_ts_us()
    test_bus_close_clears_rate_state()
    test_engine_ipc_vcan_median()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
