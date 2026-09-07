#!/usr/bin/env python3
"""T12 raw TX: IPC schema, cyclic timer math, optional live vcan.

Synthetic tests never need a host CAN iface: payload validation, deadline
math, RecordingBus one-shot + echo (dir=tx), and cyclic period on a fake
bus (median interval within ±10%).

If vcan0 is UP, a live IPC path sends 0x5A1 and a peer python-can / candump
recv must see the frame. Cyclic 100 ms is measured from peer timestamps
and/or TX-echo rate_ms. Trace/rx.batch must show the TX id (dir=tx echo).

If vcan0 is not UP:

    SKIP vcan0 TX inject: vcan0 is not UP on this host.
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
from can_engine.tx import (  # noqa: E402
    PERIOD_TOLERANCE,
    TxError,
    next_cyclic_deadline,
    parse_hex_data,
    parse_tx_spec,
    period_error_ratio,
    within_period_tolerance,
)

EXPECTED_CAN_ID = 0x5A1
EXPECTED_DATA = bytes([0x02, 0x10, 0x0C, 0x00])
CYCLIC_PERIOD_MS = 50
LIVE_PERIOD_MS = 100


class RecordingBus:
    """python-can-like bus that records send() and can inject recv()."""

    def __init__(self) -> None:
        self.sent: list[object] = []
        self.sent_mono: list[float] = []
        self._q: queue.Queue[object] = queue.Queue()
        self.shutdowns = 0

    def send(self, msg: object) -> None:
        self.sent.append(msg)
        self.sent_mono.append(time.monotonic())

    def inject(self, msg: object) -> None:
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


def _median(values: list[float]) -> float:
    return float(statistics.median(values))


def test_parse_hex_and_spec() -> None:
    assert parse_hex_data("02 10 0C 00") == EXPECTED_DATA
    assert parse_hex_data("02100c00") == EXPECTED_DATA
    try:
        parse_hex_data("210")
        raise AssertionError("odd hex should fail")
    except TxError as exc:
        assert exc.code == "invalid_payload"

    spec = parse_tx_spec(
        {
            "busId": "bus-1",
            "can_id": 0x7E0,
            "data": "02 10 0C 00 00 00 00 00",
        }
    )
    assert spec.can_id == 0x7E0
    assert spec.is_eff is False
    assert spec.dlc == 8
    assert spec.is_rtr is False

    ext = parse_tx_spec({"busId": "bus-1", "can_id": 0x1ABCDE, "data": ""})
    assert ext.is_eff is True

    try:
        parse_tx_spec({"can_id": 0x100, "data": "00"})
        raise AssertionError("missing busId should fail")
    except TxError as exc:
        assert exc.code == "invalid_payload"

    try:
        parse_tx_spec({"busId": "bus-1", "can_id": 0x800, "data": "00", "is_eff": False})
        raise AssertionError("standard ID overflow should fail")
    except TxError as exc:
        assert exc.code == "invalid_payload"
    print("parse hex / tx spec: ok")


def test_cyclic_timer_math() -> None:
    assert next_cyclic_deadline(1.00, 1.00, 0.1) == 1.10
    assert next_cyclic_deadline(1.05, 1.00, 0.1) == 1.10
    # Behind by more than one period: skip missed ticks (stretch, no burst).
    assert next_cyclic_deadline(1.25, 1.00, 0.1) == 1.30
    assert abs(period_error_ratio(0.11, 0.10) - 0.10) < 1e-12
    assert within_period_tolerance(0.11, 0.10)
    assert not within_period_tolerance(0.13, 0.10)
    print("cyclic timer math: ok")


def _open_recording() -> tuple[BusManager, RecordingBus, str]:
    bus = RecordingBus()
    net = _fake_sysfs_vcan0(Path(tempfile.mkdtemp(prefix="vanillabus-tx-sysfs-")))

    def opener(_name: str, _bitrate: int | None) -> RecordingBus:
        return bus

    manager = BusManager(sysfs_net=net, opener=opener)
    opened = manager.open("vcan0")
    return manager, bus, opened["busId"]


def test_oneshot_echo_dir_tx() -> None:
    manager, bus, bus_id = _open_recording()
    try:
        result = manager.send(
            {
                "busId": bus_id,
                "can_id": EXPECTED_CAN_ID,
                "data": EXPECTED_DATA.hex(),
                "is_eff": False,
            }
        )
        assert result == {"ok": True}
        assert len(bus.sent) == 1
        sent = bus.sent[0]
        assert int(getattr(sent, "arbitration_id")) == EXPECTED_CAN_ID
        assert bytes(getattr(sent, "data")) == EXPECTED_DATA

        deadline = time.time() + 1.0
        frames: list[dict] = []
        while not frames and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            if not frames:
                time.sleep(0.01)
        assert len(frames) == 1
        frame = frames[0]
        assert frame["can_id"] == EXPECTED_CAN_ID
        assert frame["data"] == EXPECTED_DATA.hex()
        assert frame["dir"] == "tx"
        assert frame["busId"] == bus_id
        assert frame["ifName"] == "vcan0"
        assert frame["rate_ms"] is None
        print("oneshot echo dir=tx: ok")
    finally:
        manager.close(bus_id)


def test_missing_bus_and_stop_unknown() -> None:
    manager, _bus, bus_id = _open_recording()
    try:
        try:
            manager.send({"busId": "missing", "can_id": 1, "data": "00"})
            raise AssertionError("missing bus should fail")
        except TxError as exc:
            assert exc.code == "bus_not_found"
        try:
            manager.stop_cyclic({"job_id": "no-such-job"})
            raise AssertionError("unknown job should fail")
        except TxError as exc:
            assert exc.code == "job_not_found"
        print("missing bus / unknown job: ok")
    finally:
        manager.close(bus_id)


def test_cyclic_period_recording_bus() -> None:
    manager, bus, bus_id = _open_recording()
    try:
        started = manager.start_cyclic(
            {
                "busId": bus_id,
                "can_id": EXPECTED_CAN_ID,
                "data": EXPECTED_DATA.hex(),
                "period_ms": CYCLIC_PERIOD_MS,
                "is_eff": False,
            }
        )
        job_id = started["job_id"]
        assert isinstance(job_id, str) and job_id
        time.sleep(0.42)
        manager.stop_cyclic({"job_id": job_id})
        stamps = list(bus.sent_mono)
        assert len(stamps) >= 6, f"expected ≥6 cyclic sends, got {len(stamps)}"
        intervals = [later - earlier for earlier, later in zip(stamps, stamps[1:])]
        median = _median(intervals) * 1000.0
        expected = float(CYCLIC_PERIOD_MS)
        assert within_period_tolerance(median, expected), (
            f"synthetic cyclic median {median:.2f} ms not within ±10% of {expected} ms "
            f"(n={len(intervals)}; stretch if the host is overloaded)"
        )
        frames, _dropped = manager.drain_rx(500)
        tx_frames = [frame for frame in frames if frame["dir"] == "tx"]
        assert len(tx_frames) >= 6
        rates = [frame["rate_ms"] for frame in tx_frames[1:] if isinstance(frame["rate_ms"], (int, float))]
        if rates:
            rate_median = _median([float(rate) for rate in rates])
            print(
                f"cyclic RecordingBus: sends={len(stamps)} median={median:.2f} ms "
                f"rate_ms median={rate_median:.2f} (target {expected} ±10%): ok"
            )
        else:
            print(f"cyclic RecordingBus: sends={len(stamps)} median={median:.2f} ms: ok")
    finally:
        manager.close(bus_id)


def test_close_stops_cyclic() -> None:
    manager, bus, bus_id = _open_recording()
    try:
        manager.start_cyclic(
            {
                "busId": bus_id,
                "can_id": 0x123,
                "data": "11",
                "period_ms": 20,
            }
        )
        time.sleep(0.05)
        manager.close(bus_id)
        count = len(bus.sent)
        time.sleep(0.08)
        assert len(bus.sent) == count, "cyclic job must stop on bus.close"
        print("bus.close stops cyclic: ok")
    except Exception:
        try:
            manager.close(bus_id)
        except Exception:
            pass
        raise


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-tx-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-tx-"))
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


def _peer_recv_frames(count: int, timeout: float, can_id: int) -> list[tuple[float, int, bytes]]:
    try:
        import can
    except ImportError:
        can = None
    if can is not None:
        bus = can.Bus(interface="socketcan", channel="vcan0")
        try:
            found: list[tuple[float, int, bytes]] = []
            deadline = time.time() + timeout
            while len(found) < count and time.time() < deadline:
                msg = bus.recv(timeout=max(0.01, deadline - time.time()))
                if msg is None:
                    continue
                if int(msg.arbitration_id) != can_id:
                    continue
                found.append((time.monotonic(), int(msg.arbitration_id), bytes(msg.data)))
            return found
        finally:
            bus.shutdown()

    candump = subprocess.run(
        ["candump", "-n", str(count), "-T", str(int(timeout * 1000)), "vcan0"],
        check=False,
        capture_output=True,
        text=True,
    )
    found = []
    for line in candump.stdout.splitlines():
        # "  vcan0  5A1   [4]  02 10 0C 00"
        parts = line.split()
        if len(parts) < 3:
            continue
        try:
            ident = int(parts[1], 16)
        except ValueError:
            continue
        if ident != can_id:
            continue
        hex_bytes = [p for p in parts[3:] if all(ch in "0123456789abcdefABCDEF" for ch in p)]
        found.append((time.monotonic(), ident, bytes.fromhex("".join(hex_bytes))))
    return found


def _recv_matching(
    sock: socket.socket,
    types: set[str],
    *,
    can_id: int,
    collected: list[dict],
    timeout: float,
) -> dict:
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError(f"timed out waiting for {sorted(types)}")
        message = _recv_message(sock, timeout=remaining)
        if message.get("type") == "rx.batch":
            frames = message.get("payload", {}).get("frames")
            if isinstance(frames, list):
                for frame in frames:
                    if frame.get("can_id") == can_id:
                        collected.append(frame)
            continue
        if message.get("type") in types:
            return message


def _collect_tx_echo(sock: socket.socket, can_id: int, timeout: float) -> list[dict]:
    frames: list[dict] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = deadline - time.time()
        try:
            message = _recv_until(sock, {"rx.batch"}, timeout=max(remaining, 0.01))
        except TimeoutError:
            break
        batch = message.get("payload", {}).get("frames")
        if not isinstance(batch, list):
            continue
        for frame in batch:
            if frame.get("can_id") == can_id:
                frames.append(frame)
    return frames


def test_engine_ipc_tx() -> None:
    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello = _recv_until(sock, {"engine.hello"})
        if hello.get("type") != "engine.hello":
            raise AssertionError(f"expected engine.hello, got {hello!r}")

        _send_message(
            sock,
            {"type": "tx.send", "id": "tx-missing", "payload": {"busId": "nope", "can_id": 1, "data": "00"}},
        )
        missing = _recv_until(sock, {"engine.error", "tx.send"})
        assert missing.get("type") == "engine.error"
        assert missing.get("payload", {}).get("code") == "bus_not_found"

        _send_message(sock, {"type": "tx.send", "id": "tx-bad", "payload": {"can_id": 1, "data": "00"}})
        bad = _recv_until(sock, {"engine.error", "tx.send"})
        assert bad.get("type") == "engine.error"
        assert bad.get("payload", {}).get("code") == "invalid_payload"
        print("IPC schema (missing bus / invalid payload): ok")

        if not _vcan0_up():
            print(
                "SKIP vcan0 TX inject: vcan0 is not UP on this host. "
                "Bring it up with: sudo ./scripts/setup-vcan.sh"
            )
            sock.close()
            return

        _send_message(sock, {"type": "bus.open", "id": "open-tx", "payload": {"name": "vcan0"}})
        opened = _recv_until(sock, {"bus.open", "engine.error"})
        if opened.get("type") != "bus.open":
            raise AssertionError(f"bus.open failed: {opened!r}")
        bus_id = opened.get("payload", {}).get("busId")
        if not isinstance(bus_id, str) or not bus_id:
            raise AssertionError(f"bus.open must return busId: {opened!r}")

        peer_ready = _peer_listen_start()
        _send_message(
            sock,
            {
                "type": "tx.send",
                "id": "tx-one",
                "payload": {
                    "busId": bus_id,
                    "can_id": EXPECTED_CAN_ID,
                    "data": EXPECTED_DATA.hex(),
                    "is_eff": False,
                },
            },
        )
        echo: list[dict] = []
        ack = _recv_matching(
            sock,
            {"tx.send", "engine.error"},
            can_id=EXPECTED_CAN_ID,
            collected=echo,
            timeout=1.0,
        )
        if ack.get("type") != "tx.send":
            raise AssertionError(f"tx.send failed: {ack!r}")
        assert ack.get("payload", {}).get("ok") is True

        peer = peer_ready(1, 0.6)
        if not peer:
            raise AssertionError("peer/candump did not see the one-shot TX frame")
        assert peer[0][1] == EXPECTED_CAN_ID
        assert peer[0][2] == EXPECTED_DATA
        print(f"live oneshot peer recv 0x{EXPECTED_CAN_ID:X}: ok")

        echo.extend(_collect_tx_echo(sock, EXPECTED_CAN_ID, 0.25))
        tx_echo = [frame for frame in echo if frame.get("dir") == "tx"]
        if not tx_echo and not echo:
            raise AssertionError("rx.batch did not show TX echo or loopback after send")
        shown = tx_echo[0] if tx_echo else echo[0]
        assert shown["can_id"] == EXPECTED_CAN_ID
        assert shown["data"] == EXPECTED_DATA.hex()
        print(f"Trace/rx.batch after send dir={shown['dir']}: ok")

        _send_message(
            sock,
            {
                "type": "tx.cyclic.start",
                "id": "tx-cyc",
                "payload": {
                    "busId": bus_id,
                    "can_id": EXPECTED_CAN_ID,
                    "data": EXPECTED_DATA.hex(),
                    "period_ms": LIVE_PERIOD_MS,
                    "is_eff": False,
                },
            },
        )
        started = _recv_matching(
            sock,
            {"tx.cyclic.start", "engine.error"},
            can_id=EXPECTED_CAN_ID,
            collected=echo,
            timeout=1.0,
        )
        if started.get("type") != "tx.cyclic.start":
            raise AssertionError(f"tx.cyclic.start failed: {started!r}")
        job_id = started.get("payload", {}).get("job_id")
        assert isinstance(job_id, str) and job_id

        live = _peer_recv_frames(8, 1.4, EXPECTED_CAN_ID)
        _send_message(sock, {"type": "tx.cyclic.stop", "id": "tx-stop", "payload": {"job_id": job_id}})
        _recv_until(sock, {"tx.cyclic.stop", "engine.error", "rx.batch"})

        if len(live) < 5:
            raise AssertionError(f"live cyclic peer saw {len(live)} frames, need ≥5")
        intervals = [later[0] - earlier[0] for earlier, later in zip(live, live[1:])]
        median = _median(intervals) * 1000.0
        assert within_period_tolerance(median, float(LIVE_PERIOD_MS)), (
            f"live cyclic median {median:.2f} ms not within ±10% of {LIVE_PERIOD_MS} ms "
            f"(n={len(intervals)}; stretch if the host scheduler is noisy)"
        )
        print(
            f"live cyclic peer: n={len(intervals)} median={median:.2f} ms "
            f"(target {LIVE_PERIOD_MS} ±10%): ok"
        )

        _send_message(sock, {"type": "bus.close", "id": "close-tx", "payload": {"busId": bus_id}})
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


def _peer_listen_start():
    """Open a peer socket before send so the one-shot is not missed."""
    try:
        import can
    except ImportError:
        can = None
    if can is None:
        def later(count: int, timeout: float):
            return _peer_recv_frames(count, timeout, EXPECTED_CAN_ID)

        return later

    bus = can.Bus(interface="socketcan", channel="vcan0")

    def later(count: int, timeout: float):
        try:
            found: list[tuple[float, int, bytes]] = []
            deadline = time.time() + timeout
            while len(found) < count and time.time() < deadline:
                msg = bus.recv(timeout=max(0.01, deadline - time.time()))
                if msg is None:
                    continue
                if int(msg.arbitration_id) != EXPECTED_CAN_ID:
                    continue
                found.append((time.monotonic(), int(msg.arbitration_id), bytes(msg.data)))
            return found
        finally:
            bus.shutdown()

    return later


def main() -> int:
    test_parse_hex_and_spec()
    test_cyclic_timer_math()
    test_oneshot_echo_dir_tx()
    test_missing_bus_and_stop_unknown()
    test_cyclic_period_recording_bus()
    test_close_stops_cyclic()
    test_engine_ipc_tx()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
