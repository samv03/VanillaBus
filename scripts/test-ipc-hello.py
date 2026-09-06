#!/usr/bin/env python3
"""Prove engine.hello round-trip over length-prefixed Unix-domain IPC."""

from __future__ import annotations

import json
import os
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
sys.path.insert(0, str(ENGINE))

from can_engine.framing import (  # noqa: E402
    MAX_FRAME_BYTES,
    ProtocolError,
    check_length,
    decode_payload,
    encode_message,
)
from can_engine.hello import ENGINE_NAME, hello_payload  # noqa: E402


def _choose_socket_path() -> Path:
    xdg = os.environ.get("XDG_RUNTIME_DIR")
    if xdg:
        parent = Path(xdg)
        mode = parent.stat().st_mode
        if not mode & stat.S_IWOTH:
            path = parent / f"vanillabus-hello-test-{os.getpid()}.sock"
            if path.exists():
                path.unlink()
            return path
    directory = Path(tempfile.mkdtemp(prefix="vanillabus-hello-"))
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


def _send_message(sock: socket.socket, message: dict) -> None:
    sock.sendall(encode_message(message))


def test_framing_unit() -> None:
    encoded = encode_message({"type": "engine.hello", "payload": {}})
    assert encoded[:4] == struct.pack(">I", len(encoded) - 4)
    decoded = decode_payload(encoded[4:])
    assert decoded["type"] == "engine.hello"
    try:
        check_length(0)
    except ProtocolError as exc:
        assert exc.code == "invalid_length"
    else:
        raise AssertionError("length 0 must be rejected")
    try:
        check_length(MAX_FRAME_BYTES + 1)
    except ProtocolError as exc:
        assert exc.code == "payload_too_large"
    else:
        raise AssertionError("huge length must be rejected")


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


def test_hello_round_trip() -> dict:
    ipc_path = _choose_socket_path()
    proc = _start_engine(ipc_path)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.connect(str(ipc_path))
        hello = _recv_message(sock)
        if hello.get("type") != "engine.hello":
            raise AssertionError(f"expected engine.hello, got {hello!r}")
        payload = hello.get("payload")
        print("engine.hello payload:")
        print(json.dumps(payload, indent=2, sort_keys=True))
        expected = hello_payload()
        if payload != expected:
            raise AssertionError(f"payload mismatch: {payload!r} != {expected!r}")
        if expected["name"] != ENGINE_NAME or "socketcan" not in expected["backends"]:
            raise AssertionError("hello identity fields are wrong")

        _send_message(sock, {"type": "engine.hello", "id": "round-trip", "payload": {}})
        reply = _recv_message(sock)
        if reply.get("type") != "engine.hello" or reply.get("id") != "round-trip":
            raise AssertionError(f"hello round-trip failed: {reply!r}")
        print("hello round-trip: ok")

        beat = _recv_message(sock, timeout=3.5)
        if beat.get("type") != "engine.heartbeat":
            raise AssertionError(f"expected engine.heartbeat, got {beat!r}")
        ts_us = beat.get("payload", {}).get("ts_us")
        if not isinstance(ts_us, int):
            raise AssertionError(f"heartbeat ts_us must be int, got {ts_us!r}")
        print(f"engine.heartbeat payload: {json.dumps(beat.get('payload'))}")

        sock.sendall(struct.pack(">I", 0xFFFFFFFF))
        try:
            error = _recv_message(sock, timeout=2.0)
            if error.get("type") != "engine.error":
                raise AssertionError(f"expected engine.error after bad length, got {error!r}")
            print(f"malformed length -> {error.get('payload')}")
        except (TimeoutError, socket.timeout, RuntimeError, ProtocolError, OSError):
            print("malformed length: connection closed (engine still running)")
        sock.close()

        if proc.poll() is not None:
            raise RuntimeError("engine crashed after a malformed length")

        sock2 = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock2.connect(str(ipc_path))
        hello2 = _recv_message(sock2)
        if hello2.get("type") != "engine.hello":
            raise AssertionError("engine did not accept a new client after malformed length")
        sock2.close()
        print("engine stayed up after malformed length: ok")
        return payload if isinstance(payload, dict) else expected
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        if ipc_path.exists():
            ipc_path.unlink()


def test_refuse_world_writable_tmp() -> None:
    tmp = Path("/tmp")
    if not tmp.exists() or not (tmp.stat().st_mode & stat.S_IWOTH):
        print("skip refuse /tmp (directory is not world-writable here)")
        return
    predictable = Path("/tmp/vanillabus-predictable.sock")
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ENGINE) if not existing else f"{ENGINE}{os.pathsep}{existing}"
    completed = subprocess.run(
        [sys.executable, "-m", "can_engine", "--ipc", str(predictable)],
        cwd=str(ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=5,
        check=False,
    )
    if completed.returncode == 0:
        raise AssertionError("engine must refuse a world-writable /tmp socket path")
    if predictable.exists():
        predictable.unlink()
        raise AssertionError("engine bound a predictable /tmp socket")
    print("refused world-writable /tmp socket path: ok")


def main() -> int:
    test_framing_unit()
    print("framing unit checks: ok")
    test_refuse_world_writable_tmp()
    test_hello_round_trip()
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
