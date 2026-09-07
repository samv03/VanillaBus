#!/usr/bin/env python3
"""T13 DBC pack TX: golden vectors, unknown/pack errors, optional live vcan.

Always runs (no host CAN required):
  - fixtures/golden/*_pack.json encode + pack→unpack round-trip
  - unknown_message / dbc_not_loaded / pack_failed
  - RecordingBus one-shot DBC send (dir=tx echo + decode)
  - cyclic DBC period on a fake bus (median within ±10%)

If vcan0 is UP: load sample.dbc, tx.send {message, signals}, assert a
peer/candump recv of the packed frame, then cyclic DBC ±10%.

If vcan0 is not UP:

    SKIP vcan0 DBC TX inject: vcan0 is not UP on this host.
    Bring it up with: sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import json
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
from can_engine.dbc import DbcError, load_database, pack_frame, unpack_frame  # noqa: E402
from can_engine.framing import decode_payload, encode_message  # noqa: E402
from can_engine.tx import TxError, within_period_tolerance  # noqa: E402

ENGINE_STATUS_SIGNALS = {"EngineSpeed": 250.0, "EngineTemp": 50, "OilPressure": 20}
ENGINE_STATUS_ID = 0x100
ENGINE_STATUS_DATA = bytes.fromhex("e8035a0a00000000")
CYCLIC_PERIOD_MS = 50
LIVE_PERIOD_MS = 100


class RecordingBus:
    def __init__(self) -> None:
        self.sent: list[object] = []
        self.sent_mono: list[float] = []
        self._q: queue.Queue[object] = queue.Queue()
        self.shutdowns = 0

    def send(self, msg: object) -> None:
        self.sent.append(msg)
        self.sent_mono.append(time.monotonic())

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


def _signals_equal(actual: dict, expected: dict) -> None:
    assert set(actual) == set(expected), f"signal names {sorted(actual)} != {sorted(expected)}"
    for name, exp in expected.items():
        got = actual[name]
        if isinstance(exp, float) or isinstance(got, float):
            assert abs(float(got) - float(exp)) < 1e-6, f"{name}: {got} != {exp}"
        else:
            assert got == exp, f"{name}: {got} != {exp}"


def _run_golden_pack(path: Path) -> None:
    spec = json.loads(path.read_text(encoding="utf-8"))
    database = load_database(ROOT / spec["dbc"])
    for vector in spec["vectors"]:
        packed = pack_frame(database, vector["message"], vector["signals"])
        assert packed["can_id"] == vector["can_id"], f"{path.name} {vector['id']}: can_id"
        assert packed["is_eff"] == vector["is_eff"], f"{path.name} {vector['id']}: is_eff"
        assert packed["data"] == vector["data"], (
            f"{path.name} {vector['id']}: data {packed['data']} != {vector['data']}"
        )
        decoded = unpack_frame(
            database,
            {"can_id": packed["can_id"], "data": packed["data"], "is_eff": packed["is_eff"]},
        )
        assert decoded is not None, f"{path.name} {vector['id']}: unpack after pack"
        assert decoded["name"] == vector["message"]
        _signals_equal(decoded["signals"], vector["signals"])
        print(f"  {path.name} {vector['id']}: pack+round-trip ok")


def test_golden_pack() -> None:
    goldens = sorted((ROOT / "fixtures" / "golden").glob("*_pack.json"))
    assert goldens, "expected fixtures/golden/*_pack.json"
    for path in goldens:
        _run_golden_pack(path)
    print("golden pack: ok")


def test_pack_errors() -> None:
    database = load_database(ROOT / "fixtures/dbc/sample.dbc")
    try:
        pack_frame(None, "EngineStatus", ENGINE_STATUS_SIGNALS)
        raise AssertionError("expected dbc_not_loaded")
    except DbcError as exc:
        assert exc.code == "dbc_not_loaded"
    try:
        pack_frame(database, "NoSuchMessage", ENGINE_STATUS_SIGNALS)
        raise AssertionError("expected unknown_message")
    except DbcError as exc:
        assert exc.code == "unknown_message"
    try:
        pack_frame(database, "EngineStatus", {"EngineSpeed": "not-a-number"})
        raise AssertionError("expected pack_failed")
    except DbcError as exc:
        assert exc.code == "pack_failed"
    print("pack errors: ok")


def _open_recording() -> tuple[BusManager, RecordingBus, str]:
    bus = RecordingBus()
    net = _fake_sysfs_vcan0(Path(tempfile.mkdtemp(prefix="vanillabus-tx-dbc-sysfs-")))

    def opener(_name: str, _bitrate: int | None) -> RecordingBus:
        return bus

    manager = BusManager(sysfs_net=net, opener=opener)
    opened = manager.open("vcan0")
    return manager, bus, opened["busId"]


def test_oneshot_dbc_echo() -> None:
    manager, bus, bus_id = _open_recording()
    try:
        try:
            manager.send(
                {
                    "busId": bus_id,
                    "message": "EngineStatus",
                    "signals": ENGINE_STATUS_SIGNALS,
                }
            )
            raise AssertionError("DBC send without load should fail")
        except DbcError as exc:
            assert exc.code == "dbc_not_loaded"

        loaded = manager.load_dbc(bus_id, "fixtures/dbc/sample.dbc")
        assert loaded["ok"] is True
        assert any(item["name"] == "EngineStatus" for item in loaded["catalog"])

        result = manager.send(
            {
                "busId": bus_id,
                "message": "EngineStatus",
                "signals": ENGINE_STATUS_SIGNALS,
            }
        )
        assert result == {"ok": True}
        assert len(bus.sent) == 1
        sent = bus.sent[0]
        assert int(getattr(sent, "arbitration_id")) == ENGINE_STATUS_ID
        assert bytes(getattr(sent, "data")) == ENGINE_STATUS_DATA

        deadline = time.time() + 1.0
        frames: list[dict] = []
        while not frames and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            if not frames:
                time.sleep(0.01)
        assert len(frames) == 1
        frame = frames[0]
        assert frame["can_id"] == ENGINE_STATUS_ID
        assert frame["data"] == ENGINE_STATUS_DATA.hex()
        assert frame["dir"] == "tx"
        assert frame["decode"] is not None
        assert frame["decode"]["name"] == "EngineStatus"
        _signals_equal(frame["decode"]["signals"], ENGINE_STATUS_SIGNALS)
        print("oneshot DBC echo dir=tx + decode: ok")
    finally:
        manager.close(bus_id)


def test_unknown_message_on_open_bus() -> None:
    manager, _bus, bus_id = _open_recording()
    try:
        manager.load_dbc(bus_id, "fixtures/dbc/sample.dbc")
        try:
            manager.send({"busId": bus_id, "message": "GhostFrame", "signals": {}})
            raise AssertionError("unknown message should fail")
        except DbcError as exc:
            assert exc.code == "unknown_message"
        print("unknown message on open bus: ok")
    finally:
        manager.close(bus_id)


def test_cyclic_dbc_period_recording_bus() -> None:
    manager, bus, bus_id = _open_recording()
    try:
        manager.load_dbc(bus_id, "fixtures/dbc/sample.dbc")
        started = manager.start_cyclic(
            {
                "busId": bus_id,
                "message": "EngineStatus",
                "signals": ENGINE_STATUS_SIGNALS,
                "period_ms": CYCLIC_PERIOD_MS,
            }
        )
        job_id = started["job_id"]
        assert isinstance(job_id, str) and job_id
        time.sleep(0.42)
        manager.stop_cyclic({"job_id": job_id})
        stamps = list(bus.sent_mono)
        assert len(stamps) >= 6, f"expected ≥6 cyclic DBC sends, got {len(stamps)}"
        for msg in bus.sent:
            assert int(getattr(msg, "arbitration_id")) == ENGINE_STATUS_ID
            assert bytes(getattr(msg, "data")) == ENGINE_STATUS_DATA
        intervals = [later - earlier for earlier, later in zip(stamps, stamps[1:])]
        median = _median(intervals) * 1000.0
        expected = float(CYCLIC_PERIOD_MS)
        assert within_period_tolerance(median, expected), (
            f"synthetic DBC cyclic median {median:.2f} ms not within ±10% of {expected} ms "
            f"(n={len(intervals)}; stretch if the host is overloaded)"
        )
        print(
            f"cyclic DBC RecordingBus: sends={len(stamps)} median={median:.2f} ms "
            f"(target {expected} ±10%): ok"
        )
    finally:
        manager.close(bus_id)


def test_raw_still_works_after_dbc() -> None:
    """T12 raw path must not regress when a DBC is loaded."""
    manager, bus, bus_id = _open_recording()
    try:
        manager.load_dbc(bus_id, "fixtures/dbc/sample.dbc")
        manager.send({"busId": bus_id, "can_id": 0x5A1, "data": "02100c00", "is_eff": False})
        assert int(getattr(bus.sent[0], "arbitration_id")) == 0x5A1
        assert bytes(getattr(bus.sent[0], "data")) == bytes.fromhex("02100c00")
        print("raw TX still works with DBC loaded: ok")
    finally:
        manager.close(bus_id)


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-tx-dbc-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-tx-dbc-"))
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


def _peer_listen_start():
    try:
        import can
    except ImportError:
        can = None
    if can is None:
        def later(count: int, timeout: float):
            return _peer_recv_frames(count, timeout, ENGINE_STATUS_ID)

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
                if int(msg.arbitration_id) != ENGINE_STATUS_ID:
                    continue
                found.append((time.monotonic(), int(msg.arbitration_id), bytes(msg.data)))
            return found
        finally:
            bus.shutdown()

    return later


def test_engine_ipc_dbc_tx() -> None:
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
            {
                "type": "tx.send",
                "id": "tx-dbc-missing",
                "payload": {"busId": "nope", "message": "EngineStatus", "signals": ENGINE_STATUS_SIGNALS},
            },
        )
        missing = _recv_until(sock, {"engine.error", "tx.send"})
        assert missing.get("type") == "engine.error"
        assert missing.get("payload", {}).get("code") == "bus_not_found"
        print("IPC DBC pack (missing bus): ok")

        if not _vcan0_up():
            print(
                "SKIP vcan0 DBC TX inject: vcan0 is not UP on this host. "
                "Bring it up with: sudo ./scripts/setup-vcan.sh"
            )
            sock.close()
            return

        _send_message(sock, {"type": "bus.open", "id": "open-dbc-tx", "payload": {"name": "vcan0"}})
        opened = _recv_until(sock, {"bus.open", "engine.error"})
        if opened.get("type") != "bus.open":
            raise AssertionError(f"bus.open failed: {opened!r}")
        bus_id = opened.get("payload", {}).get("busId")
        if not isinstance(bus_id, str) or not bus_id:
            raise AssertionError(f"bus.open must return busId: {opened!r}")

        _send_message(
            sock,
            {
                "type": "tx.send",
                "id": "tx-noload",
                "payload": {"busId": bus_id, "message": "EngineStatus", "signals": ENGINE_STATUS_SIGNALS},
            },
        )
        noload = _recv_until(sock, {"engine.error", "tx.send"})
        assert noload.get("type") == "engine.error"
        assert noload.get("payload", {}).get("code") == "dbc_not_loaded"

        _send_message(
            sock,
            {
                "type": "dbc.load",
                "id": "load-dbc-tx",
                "payload": {"busId": bus_id, "path": "fixtures/dbc/sample.dbc"},
            },
        )
        loaded = _recv_until(sock, {"dbc.load", "engine.error"})
        if loaded.get("type") != "dbc.load":
            raise AssertionError(f"dbc.load failed: {loaded!r}")

        _send_message(
            sock,
            {
                "type": "tx.send",
                "id": "tx-unknown",
                "payload": {"busId": bus_id, "message": "GhostFrame", "signals": {}},
            },
        )
        unknown = _recv_until(sock, {"engine.error", "tx.send"})
        assert unknown.get("type") == "engine.error"
        assert unknown.get("payload", {}).get("code") == "unknown_message"
        print("IPC unknown_message: ok")

        peer_ready = _peer_listen_start()
        _send_message(
            sock,
            {
                "type": "tx.send",
                "id": "tx-dbc-one",
                "payload": {
                    "busId": bus_id,
                    "message": "EngineStatus",
                    "signals": ENGINE_STATUS_SIGNALS,
                },
            },
        )
        echo: list[dict] = []
        ack = _recv_matching(
            sock,
            {"tx.send", "engine.error"},
            can_id=ENGINE_STATUS_ID,
            collected=echo,
            timeout=1.0,
        )
        if ack.get("type") != "tx.send":
            raise AssertionError(f"tx.send DBC pack failed: {ack!r}")
        assert ack.get("payload", {}).get("ok") is True

        peer = peer_ready(1, 0.6)
        if not peer:
            raise AssertionError("peer/candump did not see the packed EngineStatus frame")
        assert peer[0][1] == ENGINE_STATUS_ID
        assert peer[0][2] == ENGINE_STATUS_DATA
        print(f"live DBC oneshot peer recv 0x{ENGINE_STATUS_ID:X} {ENGINE_STATUS_DATA.hex()}: ok")

        _send_message(
            sock,
            {
                "type": "tx.cyclic.start",
                "id": "tx-dbc-cyc",
                "payload": {
                    "busId": bus_id,
                    "message": "EngineStatus",
                    "signals": ENGINE_STATUS_SIGNALS,
                    "period_ms": LIVE_PERIOD_MS,
                },
            },
        )
        started = _recv_matching(
            sock,
            {"tx.cyclic.start", "engine.error"},
            can_id=ENGINE_STATUS_ID,
            collected=echo,
            timeout=1.0,
        )
        if started.get("type") != "tx.cyclic.start":
            raise AssertionError(f"tx.cyclic.start DBC failed: {started!r}")
        job_id = started.get("payload", {}).get("job_id")
        assert isinstance(job_id, str) and job_id

        live = _peer_recv_frames(8, 1.4, ENGINE_STATUS_ID)
        _send_message(sock, {"type": "tx.cyclic.stop", "id": "tx-dbc-stop", "payload": {"job_id": job_id}})
        _recv_until(sock, {"tx.cyclic.stop", "engine.error", "rx.batch"})

        if len(live) < 5:
            raise AssertionError(f"live DBC cyclic peer saw {len(live)} frames, need ≥5")
        intervals = [later[0] - earlier[0] for earlier, later in zip(live, live[1:])]
        median = _median(intervals) * 1000.0
        assert within_period_tolerance(median, float(LIVE_PERIOD_MS)), (
            f"live DBC cyclic median {median:.2f} ms not within ±10% of {LIVE_PERIOD_MS} ms "
            f"(n={len(intervals)}; stretch if the host scheduler is noisy)"
        )
        print(
            f"live DBC cyclic peer: n={len(intervals)} median={median:.2f} ms "
            f"(target {LIVE_PERIOD_MS} ±10%): ok"
        )

        _send_message(sock, {"type": "bus.close", "id": "close-dbc-tx", "payload": {"busId": bus_id}})
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
    test_golden_pack()
    test_pack_errors()
    test_oneshot_dbc_echo()
    test_unknown_message_on_open_bus()
    test_cyclic_dbc_period_recording_bus()
    test_raw_still_works_after_dbc()
    test_engine_ipc_dbc_tx()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
