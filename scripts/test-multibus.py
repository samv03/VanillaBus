#!/usr/bin/env python3
"""T14 multi-bus: concurrent open, one DBC per bus, TX/RX isolation.

Synthetic tests never need a host CAN iface: two RecordingBuses, per-bus
DBC pack/unpack, TX on A is invisible to B, close(A) leaves B alive, and
duplicate iface open is rejected.

If vcan0 *and* vcan1 are UP, a live IPC path opens both, loads sample.dbc
on A and mux.dbc on B, starts vcan peers *before* tx.send (vcan does not
queue for late listeners), TX-isolates the pair, and checks per-bus decode.
Otherwise:

    SKIP vcan0+vcan1 multi-bus: vcan0 and/or vcan1 is not UP on this host.
    Bring both up with: sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import os
import queue
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
sys.path.insert(0, str(ENGINE))

from can_engine.bus import BusError, BusManager  # noqa: E402
from can_engine.dbc import DbcError  # noqa: E402
from can_engine.framing import decode_payload, encode_message  # noqa: E402
from can_engine.tx import TxError  # noqa: E402

SAMPLE_DBC = "fixtures/dbc/sample.dbc"
MUX_DBC = "fixtures/dbc/mux.dbc"
ENGINE_STATUS_ID = 0x100
ENGINE_STATUS_DATA = bytes.fromhex("e8035a0a00000000")
MUX_STATUS_ID = 0x200
MUX0_DATA = bytes.fromhex("008a020700000000")
TX_ID = 0x5A1
TX_DATA = bytes([0x02, 0x10, 0x0C, 0x00])


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


class RecordingBus:
    def __init__(self) -> None:
        self.sent: list[object] = []
        self._q: queue.Queue[object] = queue.Queue()
        self.shutdowns = 0

    def send(self, msg: object) -> None:
        self.sent.append(msg)

    def inject(self, msg: object) -> None:
        self._q.put(msg)

    def recv(self, timeout: float | None = None):
        try:
            return self._q.get(timeout=timeout if timeout is not None else 0.05)
        except queue.Empty:
            return None

    def shutdown(self) -> None:
        self.shutdowns += 1


def _fake_sysfs_two_vcan(root: Path) -> Path:
    net = root / "net"
    net.mkdir()
    for name in ("vcan0", "vcan1"):
        virt = root / "devices" / "virtual" / "net" / name
        virt.mkdir(parents=True)
        (virt / "type").write_text("280\n")
        (virt / "flags").write_text("0x41\n")
        (net / name).symlink_to(virt)
    return net


def _open_two() -> tuple[BusManager, dict[str, RecordingBus], str, str]:
    buses: dict[str, RecordingBus] = {}

    def opener(name: str, _bitrate: int | None) -> RecordingBus:
        bus = RecordingBus()
        buses[name] = bus
        return bus

    net = _fake_sysfs_two_vcan(Path(tempfile.mkdtemp(prefix="vanillabus-multibus-sysfs-")))
    manager = BusManager(sysfs_net=net, opener=opener)
    a = manager.open("vcan0")["busId"]
    b = manager.open("vcan1")["busId"]
    return manager, buses, a, b


def _drain_until(manager: BusManager, pred, timeout: float = 1.0) -> list[dict]:
    found: list[dict] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        frames, _dropped = manager.drain_rx(500)
        found.extend(frames)
        if pred(found):
            return found
        time.sleep(0.01)
    return found


def test_synthetic_two_buses_and_dbc_isolation() -> None:
    manager, buses, bus_a, bus_b = _open_two()
    try:
        opened = {item["name"]: item["busId"] for item in manager.opened()}
        assert opened == {"vcan0": bus_a, "vcan1": bus_b}

        loaded_a = manager.load_dbc(bus_a, SAMPLE_DBC)
        loaded_b = manager.load_dbc(bus_b, MUX_DBC)
        assert loaded_a["message_count"] >= 1
        assert loaded_b["message_count"] >= 1

        buses["vcan0"].inject(FakeMsg(ENGINE_STATUS_ID, ENGINE_STATUS_DATA))
        buses["vcan1"].inject(FakeMsg(MUX_STATUS_ID, MUX0_DATA))
        buses["vcan0"].inject(FakeMsg(MUX_STATUS_ID, MUX0_DATA))
        buses["vcan1"].inject(FakeMsg(ENGINE_STATUS_ID, ENGINE_STATUS_DATA))

        frames = _drain_until(manager, lambda got: len(got) >= 4)
        assert len(frames) >= 4, f"expected 4 RX frames, got {len(frames)}"
        by_bus: dict[str, list[dict]] = {bus_a: [], bus_b: []}
        for frame in frames:
            by_bus.setdefault(frame["busId"], []).append(frame)

        a_engine = next(f for f in by_bus[bus_a] if f["can_id"] == ENGINE_STATUS_ID)
        a_mux = next(f for f in by_bus[bus_a] if f["can_id"] == MUX_STATUS_ID)
        b_mux = next(f for f in by_bus[bus_b] if f["can_id"] == MUX_STATUS_ID)
        b_engine = next(f for f in by_bus[bus_b] if f["can_id"] == ENGINE_STATUS_ID)

        assert a_engine["ifName"] == "vcan0"
        assert b_mux["ifName"] == "vcan1"
        assert a_engine["decode"] and a_engine["decode"]["name"] == "EngineStatus"
        assert abs(float(a_engine["decode"]["signals"]["EngineSpeed"]) - 250.0) < 1e-6
        assert a_mux["decode"] is None
        assert b_mux["decode"] and b_mux["decode"]["name"] == "MuxStatus"
        assert int(b_mux["decode"]["signals"]["MuxId"]) == 0
        assert b_engine["decode"] is None

        packed = manager.send(
            {
                "busId": bus_a,
                "message": "EngineStatus",
                "signals": {"EngineSpeed": 250, "EngineTemp": 50, "OilPressure": 20},
            }
        )
        assert packed == {"ok": True}
        try:
            manager.send({"busId": bus_b, "message": "EngineStatus", "signals": {"EngineSpeed": 1}})
            raise AssertionError("bus B must not pack sample.dbc EngineStatus")
        except DbcError as exc:
            assert exc.code == "unknown_message"

        print("synthetic two buses + per-bus DBC unpack/pack: ok")
    finally:
        manager.close_all()


def test_synthetic_tx_isolation_and_close() -> None:
    manager, buses, bus_a, bus_b = _open_two()
    try:
        manager.send({"busId": bus_a, "can_id": TX_ID, "data": TX_DATA.hex(), "is_eff": False})
        assert len(buses["vcan0"].sent) == 1
        assert len(buses["vcan1"].sent) == 0
        sent = buses["vcan0"].sent[0]
        assert int(getattr(sent, "arbitration_id")) == TX_ID

        frames = _drain_until(manager, lambda got: any(f.get("dir") == "tx" for f in got))
        tx_frames = [f for f in frames if f.get("dir") == "tx"]
        assert len(tx_frames) == 1
        assert tx_frames[0]["busId"] == bus_a
        assert tx_frames[0]["ifName"] == "vcan0"
        assert all(f["busId"] != bus_b for f in tx_frames)

        job_b = manager.start_cyclic(
            {"busId": bus_b, "can_id": 0x123, "data": "11", "period_ms": 20}
        )["job_id"]
        job_a = manager.start_cyclic(
            {"busId": bus_a, "can_id": 0x124, "data": "22", "period_ms": 20}
        )["job_id"]
        time.sleep(0.08)
        manager.close(bus_a)
        sent_b_after_close = len(buses["vcan1"].sent)
        time.sleep(0.08)
        assert len(buses["vcan1"].sent) > sent_b_after_close
        assert buses["vcan0"].shutdowns == 1
        assert buses["vcan1"].shutdowns == 0
        try:
            manager.send({"busId": bus_a, "can_id": 1, "data": "00"})
            raise AssertionError("closed bus A must reject TX")
        except TxError as exc:
            assert exc.code == "bus_not_found"
        buses["vcan1"].inject(FakeMsg(0x42, bytes([0xAA])))
        later = _drain_until(manager, lambda got: any(f.get("can_id") == 0x42 for f in got))
        assert any(f["busId"] == bus_b and f["can_id"] == 0x42 for f in later)
        manager.stop_cyclic({"job_id": job_b})
        try:
            manager.stop_cyclic({"job_id": job_a})
        except TxError as exc:
            assert exc.code == "job_not_found"
        print("synthetic TX isolation + close(A) leaves B: ok")
    finally:
        manager.close_all()


def test_synthetic_duplicate_open_and_fair_drain() -> None:
    manager, buses, bus_a, bus_b = _open_two()
    try:
        try:
            manager.open("vcan0")
            raise AssertionError("second open of vcan0 must fail")
        except BusError as exc:
            assert exc.code == "iface_already_open"

        for _ in range(600):
            buses["vcan0"].inject(FakeMsg(0x10, bytes([0x01])))
        buses["vcan1"].inject(FakeMsg(0x11, bytes([0x02])))
        buses["vcan1"].inject(FakeMsg(0x12, bytes([0x03])))
        time.sleep(0.2)
        batch, _dropped = manager.drain_rx(500)
        ids = {f["busId"] for f in batch}
        assert bus_a in ids and bus_b in ids, (
            f"fair drain missed a bus in a 500-frame batch ({len(batch)} frames): {ids}"
        )
        print("synthetic duplicate-open + fair drain: ok")
    finally:
        manager.close_all()


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-multibus-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-multibus-"))
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


def _recv_skip_until(sock: socket.socket, types: set[str], timeout: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError(f"timed out waiting for {types}")
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


def _iface_up(name: str) -> bool:
    flags = Path(f"/sys/class/net/{name}/flags")
    type_path = Path(f"/sys/class/net/{name}/type")
    if not flags.is_file() or not type_path.is_file():
        return False
    try:
        if int(type_path.read_text().strip(), 0) != 280:
            return False
        return bool(int(flags.read_text().strip(), 0) & 0x1)
    except ValueError:
        return False


def _collect_rx(sock: socket.socket, timeout: float) -> list[dict]:
    frames: list[dict] = []
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            message = _recv_message(sock, timeout=max(0.05, deadline - time.time()))
        except (TimeoutError, socket.timeout):
            continue
        if message.get("type") != "rx.batch":
            continue
        frames.extend(message.get("payload", {}).get("frames") or [])
    return frames


def _parse_candump_id(line: str, can_id: int) -> tuple[int, bytes] | None:
    parts = line.split()
    if len(parts) < 3:
        return None
    try:
        ident = int(parts[1], 16)
    except ValueError:
        return None
    if ident != can_id:
        return None
    hex_bytes = [p for p in parts[3:] if all(ch in "0123456789abcdefABCDEF" for ch in p)]
    return (ident, bytes.fromhex("".join(hex_bytes)))


class _PeerListen:
    """SocketCAN / candump listener that must be started *before* TX.

    vcan does not queue for late sockets. Opening the peer after tx.send
    misses the frame even when the engine sent it on the right iface.
    """

    def __init__(self, channel: str, can_id: int, timeout: float) -> None:
        self.channel = channel
        self.can_id = can_id
        self.timeout = timeout
        self.found: list[tuple[int, bytes]] = []
        self._ready = threading.Event()
        self._error: BaseException | None = None
        self._thread = threading.Thread(
            target=self._run,
            name=f"peer-listen-{channel}",
            daemon=True,
        )
        self._thread.start()

    def wait_ready(self, timeout: float = 2.0) -> None:
        if not self._ready.wait(timeout):
            raise TimeoutError(f"peer listen on {self.channel} did not become ready")
        if self._error is not None:
            raise self._error

    def result(self) -> list[tuple[int, bytes]]:
        self._thread.join(timeout=self.timeout + 1.5)
        if self._error is not None:
            raise self._error
        return self.found

    def _run(self) -> None:
        try:
            try:
                import can
            except ImportError:
                can = None
            if can is not None:
                bus = can.Bus(interface="socketcan", channel=self.channel)
                try:
                    self._ready.set()
                    deadline = time.time() + self.timeout
                    while time.time() < deadline:
                        msg = bus.recv(timeout=max(0.01, deadline - time.time()))
                        if msg is None:
                            continue
                        if int(msg.arbitration_id) != self.can_id:
                            continue
                        self.found.append((int(msg.arbitration_id), bytes(msg.data)))
                finally:
                    bus.shutdown()
                return
            proc = subprocess.Popen(
                [
                    "candump",
                    "-n",
                    "8",
                    "-T",
                    str(int(self.timeout * 1000)),
                    self.channel,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            self._ready.set()
            stdout, _stderr = proc.communicate(timeout=self.timeout + 1.5)
            for line in (stdout or "").splitlines():
                parsed = _parse_candump_id(line, self.can_id)
                if parsed is not None:
                    self.found.append(parsed)
        except BaseException as exc:
            self._error = exc
            self._ready.set()


def _peer_listen(channel: str, can_id: int, timeout: float) -> _PeerListen:
    """Open a peer on `channel` immediately; join after TX with `.result()`."""
    return _PeerListen(channel, can_id, timeout)


def _frames_from_rx_batch(message: dict) -> list[dict]:
    if message.get("type") != "rx.batch":
        return []
    frames = message.get("payload", {}).get("frames")
    return list(frames) if isinstance(frames, list) else []


def _wait_tx_ack(sock: socket.socket, echo: list[dict], timeout: float = 3.0) -> dict:
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise TimeoutError("timed out waiting for tx.send ack")
        message = _recv_skip_heartbeat(sock, timeout=remaining)
        echo.extend(_frames_from_rx_batch(message))
        if message.get("type") in {"tx.send", "engine.error"}:
            return message


def _live_tx_watch_peers(
    sock: socket.socket,
    bus_a: str,
    echo: list[dict],
    *,
    attempt: str,
) -> tuple[list[tuple[int, bytes]], list[tuple[int, bytes]]]:
    """TX on A while both vcan peers are already listening (no late-open race)."""
    listen_a = _peer_listen("vcan0", TX_ID, 1.0)
    listen_b = _peer_listen("vcan1", TX_ID, 1.0)
    listen_a.wait_ready()
    listen_b.wait_ready()
    _send_message(
        sock,
        {
            "type": "tx.send",
            "id": attempt,
            "payload": {"busId": bus_a, "can_id": TX_ID, "data": TX_DATA.hex(), "is_eff": False},
        },
    )
    ack = _wait_tx_ack(sock, echo)
    if ack.get("type") != "tx.send":
        raise AssertionError(f"tx.send failed: {ack!r}")
    return listen_a.result(), listen_b.result()


def _inject(channel: str, can_id: int, data: bytes) -> None:
    try:
        import can
    except ImportError:
        can = None
    if can is not None:
        bus = can.Bus(interface="socketcan", channel=channel)
        try:
            bus.send(can.Message(arbitration_id=can_id, data=data, is_extended_id=False))
            return
        finally:
            bus.shutdown()
    subprocess.run(
        ["cansend", channel, f"{can_id:03X}#{data.hex()}"],
        check=True,
        capture_output=True,
        text=True,
    )


def test_live_vcan_pair() -> None:
    if not (_iface_up("vcan0") and _iface_up("vcan1")):
        print(
            "SKIP vcan0+vcan1 multi-bus: vcan0 and/or vcan1 is not UP on this host. "
            "Bring both up with: sudo ./scripts/setup-vcan.sh"
        )
        return

    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    sock = None
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello = _recv_skip_heartbeat(sock)
        if hello.get("type") != "engine.hello":
            raise AssertionError(f"expected engine.hello, got {hello!r}")

        _send_message(sock, {"type": "bus.open", "id": "open-a", "payload": {"name": "vcan0"}})
        opened_a = _recv_skip_until(sock, {"bus.open", "engine.error"})
        if opened_a.get("type") != "bus.open":
            raise AssertionError(f"bus.open vcan0 failed: {opened_a!r}")
        bus_a = opened_a["payload"]["busId"]

        _send_message(sock, {"type": "bus.open", "id": "open-b", "payload": {"name": "vcan1"}})
        opened_b = _recv_skip_until(sock, {"bus.open", "engine.error"})
        if opened_b.get("type") != "bus.open":
            raise AssertionError(f"bus.open vcan1 failed: {opened_b!r}")
        bus_b = opened_b["payload"]["busId"]
        assert bus_a != bus_b

        _send_message(sock, {"type": "bus.open", "id": "dup", "payload": {"name": "vcan0"}})
        dup = _recv_skip_until(sock, {"engine.error", "bus.open"})
        if dup.get("type") != "engine.error" or dup.get("payload", {}).get("code") != "iface_already_open":
            raise AssertionError(f"expected iface_already_open, got {dup!r}")

        _send_message(
            sock,
            {"type": "dbc.load", "id": "dbc-a", "payload": {"busId": bus_a, "path": SAMPLE_DBC}},
        )
        loaded_a = _recv_skip_until(sock, {"dbc.load", "engine.error"})
        if loaded_a.get("type") != "dbc.load":
            raise AssertionError(f"dbc.load A failed: {loaded_a!r}")
        _send_message(
            sock,
            {"type": "dbc.load", "id": "dbc-b", "payload": {"busId": bus_b, "path": MUX_DBC}},
        )
        loaded_b = _recv_skip_until(sock, {"dbc.load", "engine.error"})
        if loaded_b.get("type") != "dbc.load":
            raise AssertionError(f"dbc.load B failed: {loaded_b!r}")

        _collect_rx(sock, 0.15)
        echo: list[dict] = []
        seen_a, seen_b = _live_tx_watch_peers(sock, bus_a, echo, attempt="tx-a")
        if not seen_a:
            seen_a, seen_b = _live_tx_watch_peers(sock, bus_a, echo, attempt="tx-a-retry")
        assert seen_a, "peer on vcan0 must see TX from bus A"
        assert not seen_b, f"isolation broken: vcan1 peer saw TX {seen_b!r}"

        tx_echo = [f for f in echo if f.get("dir") == "tx" and f.get("can_id") == TX_ID]
        if not tx_echo:
            echo.extend(_collect_rx(sock, 0.4))
            tx_echo = [f for f in echo if f.get("dir") == "tx" and f.get("can_id") == TX_ID]
        assert tx_echo and all(f["busId"] == bus_a for f in tx_echo)
        assert all(f["ifName"] == "vcan0" for f in tx_echo)

        _inject("vcan0", ENGINE_STATUS_ID, ENGINE_STATUS_DATA)
        _inject("vcan1", MUX_STATUS_ID, MUX0_DATA)
        live = _collect_rx(sock, 0.6)
        a_dec = [
            f
            for f in live
            if f.get("busId") == bus_a and f.get("can_id") == ENGINE_STATUS_ID and f.get("decode")
        ]
        b_dec = [
            f
            for f in live
            if f.get("busId") == bus_b and f.get("can_id") == MUX_STATUS_ID and f.get("decode")
        ]
        assert a_dec and a_dec[0]["decode"]["name"] == "EngineStatus"
        assert b_dec and b_dec[0]["decode"]["name"] == "MuxStatus"
        leaked = [
            f
            for f in live
            if f.get("busId") == bus_b and f.get("can_id") == ENGINE_STATUS_ID and f.get("dir") == "rx"
        ]
        assert not leaked, f"vcan1 RX must not see vcan0 EngineStatus: {leaked!r}"

        _send_message(sock, {"type": "bus.close", "id": "close-a", "payload": {"busId": bus_a}})
        closed = _recv_skip_until(sock, {"bus.close", "engine.error"})
        if closed.get("type") != "bus.close":
            raise AssertionError(f"bus.close A failed: {closed!r}")

        _collect_rx(sock, 0.1)
        _inject("vcan1", MUX_STATUS_ID, MUX0_DATA)
        after = _collect_rx(sock, 0.5)
        assert any(
            f.get("busId") == bus_b and f.get("can_id") == MUX_STATUS_ID and f.get("decode")
            for f in after
        ), f"bus B must keep RX/DBC after close(A): {after!r}"

        _send_message(sock, {"type": "bus.close", "id": "close-b", "payload": {"busId": bus_b}})
        _recv_skip_until(sock, {"bus.close", "engine.error"})
        print("live vcan0+vcan1 isolation + per-bus DBC: ok")
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        if ipc_path.exists():
            ipc_path.unlink()


def main() -> int:
    test_synthetic_two_buses_and_dbc_isolation()
    test_synthetic_tx_isolation_and_close()
    test_synthetic_duplicate_open_and_fair_drain()
    test_live_vcan_pair()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
