#!/usr/bin/env python3
"""T7 DBC load + cantools unpack (golden, mux, allowlist, unknown IDs).

Unit/golden tests never need a host CAN iface. An optional vcan0 IPC path
loads sample.dbc, injects a known frame, and asserts decode on rx.batch.
If vcan0 is not UP:

    SKIP vcan0 DBC inject: vcan0 is not UP on this host.
    Bring it up with: sudo ./scripts/setup-vcan.sh
"""

from __future__ import annotations

import json
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
from can_engine.dbc import (  # noqa: E402
    DbcError,
    DbcStore,
    load_database,
    resolve_dbc_path,
    unpack_frame,
)
from can_engine.framing import decode_payload, encode_message  # noqa: E402


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


def _signals_equal(actual: dict, expected: dict) -> None:
    assert set(actual) == set(expected), f"signal names {sorted(actual)} != {sorted(expected)}"
    for name, exp in expected.items():
        got = actual[name]
        if isinstance(exp, float) or isinstance(got, float):
            assert abs(float(got) - float(exp)) < 1e-6, f"{name}: {got} != {exp}"
        else:
            assert got == exp, f"{name}: {got} != {exp}"


def _run_golden(path: Path) -> None:
    spec = json.loads(path.read_text(encoding="utf-8"))
    database = load_database(ROOT / spec["dbc"])
    for vector in spec["vectors"]:
        frame = {
            "busId": "golden",
            "can_id": vector["can_id"],
            "is_eff": vector["is_eff"],
            "data": vector["data"],
        }
        decoded = unpack_frame(database, frame)
        if vector["name"] is None:
            assert decoded is None, f"{path.name} {vector['id']}: expected raw, got {decoded}"
            continue
        assert decoded is not None, f"{path.name} {vector['id']}: expected decode"
        assert decoded["name"] == vector["name"]
        _signals_equal(decoded["signals"], vector["signals"])
        print(f"  {path.name} {vector['id']}: {decoded['name']} ok")


def test_golden_unpack() -> None:
    goldens = sorted((ROOT / "fixtures" / "golden").glob("*_unpack.json"))
    assert goldens, "expected fixtures/golden/*_unpack.json"
    for path in goldens:
        _run_golden(path)
    print("golden unpack: ok")


def test_unknown_id_stays_raw() -> None:
    database = load_database(ROOT / "fixtures/dbc/sample.dbc")
    frame = {"can_id": 0x7FF, "data": "11223344"}
    assert unpack_frame(database, frame) is None
    assert unpack_frame(None, {"can_id": 256, "data": "e8035a0a00000000"}) is None
    # Known ID, truncated payload: still raw, no crash.
    assert unpack_frame(database, {"can_id": 256, "data": "00"}) is None
    print("unknown / short payload stays raw: ok")


def test_path_allowlist_and_bad_dbc() -> None:
    sample = resolve_dbc_path("fixtures/dbc/sample.dbc")
    assert sample.is_file()
    assert sample.name == "sample.dbc"

    try:
        resolve_dbc_path("/tmp/vanillabus-evil.dbc")
        raise AssertionError("expected path_not_allowed for /tmp")
    except DbcError as exc:
        assert exc.code == "path_not_allowed"

    try:
        resolve_dbc_path("/etc/hostname")
        raise AssertionError("expected path_not_allowed or dbc_invalid for /etc")
    except DbcError as exc:
        assert exc.code in {"path_not_allowed", "dbc_invalid"}

    try:
        resolve_dbc_path("fixtures/dbc/missing.dbc")
        raise AssertionError("expected dbc_not_found")
    except DbcError as exc:
        assert exc.code == "dbc_not_found"

    try:
        load_database(resolve_dbc_path("fixtures/dbc/invalid.dbc"))
        raise AssertionError("expected dbc_invalid")
    except DbcError as exc:
        assert exc.code == "dbc_invalid"

    store = DbcStore()
    try:
        store.load("bus-x", "/tmp/not-allowed.dbc")
        raise AssertionError("store.load should reject /tmp")
    except DbcError as exc:
        assert exc.code == "path_not_allowed"
    print("allowlist / bad DBC: ok")


def test_bus_manager_decode_and_unknown() -> None:
    bus = ScriptedBus()
    net = _fake_sysfs_vcan0(Path(tempfile.mkdtemp(prefix="vanillabus-dbc-sysfs-")))

    def opener(_name: str, _bitrate: int | None) -> ScriptedBus:
        return bus

    manager = BusManager(sysfs_net=net, opener=opener)
    opened = manager.open("vcan0")
    bus_id = opened["busId"]
    try:
        loaded = manager.load_dbc(bus_id, "fixtures/dbc/sample.dbc")
        assert loaded["ok"] is True
        assert loaded["message_count"] == 2

        spec = json.loads((ROOT / "fixtures/golden/sample_unpack.json").read_text())
        known = next(v for v in spec["vectors"] if v["id"] == "engine_status_nominal")
        unknown = next(v for v in spec["vectors"] if v["id"] == "unknown_id_raw")
        bus.inject(FakeMsg(known["can_id"], bytes.fromhex(known["data"])))
        bus.inject(FakeMsg(unknown["can_id"], bytes.fromhex(unknown["data"])))

        got: list[dict] = []
        deadline = time.time() + 1.0
        while len(got) < 2 and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            got.extend(frames)
            if len(got) < 2:
                time.sleep(0.01)
        assert len(got) >= 2, f"expected two RX frames, got {got!r}"
        by_id = {frame["can_id"]: frame for frame in got}
        decoded = by_id[known["can_id"]]["decode"]
        assert decoded is not None
        assert decoded["name"] == "EngineStatus"
        _signals_equal(decoded["signals"], known["signals"])
        raw = by_id[unknown["can_id"]]
        assert raw["decode"] is None
        assert raw["data"] == unknown["data"]
        assert raw["can_id"] == unknown["can_id"]

        manager.clear_dbc(bus_id)
        bus.inject(FakeMsg(known["can_id"], bytes.fromhex(known["data"])))
        cleared: list[dict] = []
        deadline = time.time() + 1.0
        while not cleared and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            cleared.extend(frames)
            if not cleared:
                time.sleep(0.01)
        assert cleared
        assert cleared[0]["decode"] is None
        print("BusManager load/unpack/unknown/clear: ok")
    finally:
        manager.close(bus_id)


def test_mux_on_bus() -> None:
    bus = ScriptedBus()
    net = _fake_sysfs_vcan0(Path(tempfile.mkdtemp(prefix="vanillabus-mux-sysfs-")))

    def opener(_name: str, _bitrate: int | None) -> ScriptedBus:
        return bus

    manager = BusManager(sysfs_net=net, opener=opener)
    opened = manager.open("vcan0")
    bus_id = opened["busId"]
    try:
        loaded = manager.load_dbc(bus_id, "fixtures/dbc/mux.dbc")
        assert loaded["message_count"] == 1
        spec = json.loads((ROOT / "fixtures/golden/mux_unpack.json").read_text())
        for vector in spec["vectors"]:
            if vector["name"] is None:
                continue
            bus.inject(FakeMsg(vector["can_id"], bytes.fromhex(vector["data"])))
        got: list[dict] = []
        deadline = time.time() + 1.0
        while len(got) < 2 and time.time() < deadline:
            frames, _dropped = manager.drain_rx(500)
            got.extend(frames)
            if len(got) < 2:
                time.sleep(0.01)
        names = [frame["decode"]["signals"] for frame in got if frame.get("decode")]
        assert any("CoolantTemp" in signals and "FuelPressure" not in signals for signals in names)
        assert any("FuelPressure" in signals and "CoolantTemp" not in signals for signals in names)
        print("mux decode on RX: ok")
    finally:
        manager.close(bus_id)


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-dbc-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-dbc-"))
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


def test_engine_ipc_errors_and_optional_vcan() -> None:
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
                "type": "dbc.load",
                "id": "load-missing-bus",
                "payload": {"busId": "nope", "path": "fixtures/dbc/sample.dbc"},
            },
        )
        missing = _recv_until(sock, {"engine.error", "dbc.load"})
        assert missing.get("type") == "engine.error"
        assert missing.get("payload", {}).get("code") == "bus_not_found"

        if not _vcan0_up():
            print(
                "SKIP vcan0 DBC inject: vcan0 is not UP on this host. "
                "Bring it up with: sudo ./scripts/setup-vcan.sh"
            )
            sock.close()
            return

        _send_message(sock, {"type": "bus.open", "id": "open-dbc", "payload": {"name": "vcan0"}})
        opened = _recv_until(sock, {"bus.open", "engine.error"})
        if opened.get("type") != "bus.open":
            raise AssertionError(f"bus.open failed: {opened!r}")
        bus_id = opened["payload"]["busId"]

        _send_message(
            sock,
            {
                "type": "dbc.load",
                "id": "load-tmp",
                "payload": {"busId": bus_id, "path": "/tmp/vanillabus-evil.dbc"},
            },
        )
        denied = _recv_until(sock, {"engine.error", "dbc.load"})
        assert denied.get("type") == "engine.error"
        assert denied.get("payload", {}).get("code") == "path_not_allowed"

        _send_message(
            sock,
            {
                "type": "dbc.load",
                "id": "load-bad",
                "payload": {"busId": bus_id, "path": "fixtures/dbc/invalid.dbc"},
            },
        )
        bad = _recv_until(sock, {"engine.error", "dbc.load"})
        assert bad.get("type") == "engine.error"
        assert bad.get("payload", {}).get("code") == "dbc_invalid"

        _send_message(
            sock,
            {
                "type": "dbc.load",
                "id": "load-ok",
                "payload": {"busId": bus_id, "path": "fixtures/dbc/sample.dbc"},
            },
        )
        loaded = _recv_until(sock, {"dbc.load", "engine.error"})
        assert loaded.get("type") == "dbc.load"
        assert loaded.get("payload", {}).get("message_count") == 2

        spec = json.loads((ROOT / "fixtures/golden/sample_unpack.json").read_text())
        known = next(v for v in spec["vectors"] if v["id"] == "engine_status_nominal")
        try:
            import can
        except ImportError:
            can = None
        if can is not None:
            tx = can.Bus(interface="socketcan", channel="vcan0")
            try:
                tx.send(
                    can.Message(
                        arbitration_id=known["can_id"],
                        data=bytes.fromhex(known["data"]),
                        is_extended_id=False,
                    )
                )
                tx.send(
                    can.Message(
                        arbitration_id=0x7FF,
                        data=bytes.fromhex("deadbeef"),
                        is_extended_id=False,
                    )
                )
            finally:
                tx.shutdown()
        else:
            subprocess.run(
                ["cansend", "vcan0", f"{known['can_id']:03X}#{known['data'].upper()}"],
                check=True,
            )
            subprocess.run(["cansend", "vcan0", "7FF#DEADBEEF"], check=True)

        seen_known = None
        seen_unknown = None
        deadline = time.time() + 0.4
        while time.time() < deadline and (seen_known is None or seen_unknown is None):
            remaining = deadline - time.time()
            try:
                message = _recv_until(sock, {"rx.batch"}, timeout=max(remaining, 0.01))
            except TimeoutError:
                break
            for frame in message.get("payload", {}).get("frames", []):
                if frame.get("can_id") == known["can_id"]:
                    seen_known = frame
                if frame.get("can_id") == 0x7FF:
                    seen_unknown = frame
        assert seen_known is not None, "expected decoded EngineStatus on rx.batch"
        assert seen_known.get("decode", {}).get("name") == "EngineStatus"
        _signals_equal(seen_known["decode"]["signals"], known["signals"])
        assert seen_unknown is not None, "expected unknown 0x7FF on rx.batch"
        assert seen_unknown.get("decode") is None
        print("IPC dbc.load / allowlist / decode + unknown: ok")

        _send_message(sock, {"type": "dbc.clear", "id": "clear-ok", "payload": {"busId": bus_id}})
        cleared = _recv_until(sock, {"dbc.clear", "engine.error"})
        assert cleared.get("type") == "dbc.clear"
        _send_message(sock, {"type": "bus.close", "id": "close-dbc", "payload": {"busId": bus_id}})
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
    test_golden_unpack()
    test_unknown_id_stays_raw()
    test_path_allowlist_and_bad_dbc()
    test_bus_manager_decode_and_unknown()
    test_mux_on_bus()
    test_engine_ipc_errors_and_optional_vcan()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
