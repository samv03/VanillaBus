"""Unix-domain IPC server: hello on connect, heartbeat, safe framing."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import stat
import time
from pathlib import Path

from can_engine.framing import (
    MAX_FRAME_BYTES,
    ProtocolError,
    check_length,
    decode_payload,
    encode_message,
)
from can_engine.bus import BusError, BusManager
from can_engine.dbc import DbcError
from can_engine.protocol import (
    KNOWN_TYPES,
    bus_close_message,
    bus_list_message,
    bus_open_message,
    dbc_clear_message,
    dbc_load_message,
    error_message,
    heartbeat_message,
    hello_message,
    rx_batch_message,
    tx_cyclic_start_message,
    tx_cyclic_stop_message,
    tx_send_message,
)
from can_engine.tx import TxError
from can_engine.rx import RX_BATCH_INTERVAL_S, RX_BATCH_MAX_FRAMES

LOG = logging.getLogger("vanillabus-engine")
HEARTBEAT_INTERVAL_S = 2.0
HEADER_STRUCT_SIZE = 4


def now_ts_us() -> int:
    return time.time_ns() // 1_000


def assert_socket_path_safe(path: Path) -> None:
    """Refuse a world-writable parent (predictable /tmp sockets)."""
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    mode = parent.stat().st_mode
    if mode & stat.S_IWOTH:
        raise SystemExit(
            f"refusing world-writable socket directory {parent} "
            "(use $XDG_RUNTIME_DIR or a private 0700 mkstemp dir)"
        )


def prepare_listen_path(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if not path.is_absolute():
        path = path.resolve()
    assert_socket_path_safe(path)
    if path.exists():
        path.unlink()
    return path


async def read_message(reader: asyncio.StreamReader) -> dict | None:
    header = await reader.read(HEADER_STRUCT_SIZE)
    if header == b"":
        return None
    if len(header) < HEADER_STRUCT_SIZE:
        raise ProtocolError("invalid_length", "truncated length header")
    length = int.from_bytes(header, "big")
    check_length(length)
    try:
        payload = await reader.readexactly(length)
    except asyncio.IncompleteReadError as exc:
        raise ProtocolError("invalid_length", "truncated JSON payload") from exc
    return decode_payload(payload)


async def write_message(writer: asyncio.StreamWriter, message: dict) -> None:
    writer.write(encode_message(message))
    await writer.drain()


def _payload(message: dict) -> dict:
    raw = message.get("payload")
    return raw if isinstance(raw, dict) else {}


async def handle_request(message: dict, manager: BusManager, send) -> None:
    msg_type = message["type"]
    msg_id = message["id"] if isinstance(message.get("id"), str) else None
    payload = _payload(message)

    if msg_type == "engine.hello":
        await send(hello_message(msg_id))
        return

    if msg_type == "engine.heartbeat":
        await send(heartbeat_message(now_ts_us()))
        return

    try:
        if msg_type == "bus.list":
            listed = manager.list()
            await send(
                bus_list_message(
                    listed["interfaces"],
                    msg_id,
                    listed.get("warnings") or None,
                )
            )
            return
        if msg_type == "bus.open":
            opened = manager.open(payload.get("name"), payload.get("bitrate"))
            await send(bus_open_message(opened["busId"], msg_id))
            return
        if msg_type == "bus.close":
            manager.close(payload.get("busId"))
            await send(bus_close_message(msg_id))
            return
        if msg_type == "dbc.load":
            loaded = manager.load_dbc(payload.get("busId"), payload.get("path"))
            await send(dbc_load_message(loaded["message_count"], msg_id, loaded.get("catalog")))
            return
        if msg_type == "dbc.clear":
            manager.clear_dbc(payload.get("busId"))
            await send(dbc_clear_message(msg_id))
            return
        if msg_type == "tx.send":
            manager.send(payload)
            await send(tx_send_message(msg_id))
            return
        if msg_type == "tx.cyclic.start":
            started = manager.start_cyclic(payload)
            await send(tx_cyclic_start_message(started["job_id"], msg_id))
            return
        if msg_type == "tx.cyclic.stop":
            manager.stop_cyclic(payload)
            await send(tx_cyclic_stop_message(msg_id))
            return
    except (BusError, DbcError, TxError) as exc:
        await send(error_message(exc.code, exc.message, msg_id))
        return
    except Exception:
        LOG.exception("bus request %s failed", msg_type)
        await send(error_message("internal", f"{msg_type} failed unexpectedly", msg_id))
        return

    if msg_type in KNOWN_TYPES:
        await send(error_message("not_implemented", f"{msg_type} is not implemented yet", msg_id))
        return

    await send(error_message("unknown_type", f"unknown message type: {msg_type}", msg_id))


async def heartbeat_loop(send, writer: asyncio.StreamWriter) -> None:
    try:
        while not writer.is_closing():
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)
            await send(heartbeat_message(now_ts_us()))
    except (ConnectionError, BrokenPipeError, asyncio.CancelledError):
        return


async def rx_flush_loop(send, writer: asyncio.StreamWriter, manager: BusManager) -> None:
    """Emit rx.batch: ≤16 ms idle delay, ≤500 frames per event."""
    try:
        while not writer.is_closing():
            frames, dropped = manager.drain_rx(RX_BATCH_MAX_FRAMES)
            if frames:
                await send(rx_batch_message(frames, dropped))
                continue
            await asyncio.sleep(RX_BATCH_INTERVAL_S)
    except (ConnectionError, BrokenPipeError, asyncio.CancelledError):
        return


async def client_session(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    manager: BusManager,
) -> None:
    peer = writer.get_extra_info("peername")
    LOG.info("client connected %s", peer)
    write_lock = asyncio.Lock()

    async def send(message: dict) -> None:
        if writer.is_closing():
            return
        async with write_lock:
            await write_message(writer, message)

    beat = asyncio.create_task(heartbeat_loop(send, writer), name="engine-heartbeat")
    rx_task = asyncio.create_task(rx_flush_loop(send, writer, manager), name="engine-rx")
    try:
        await send(hello_message())
        while True:
            try:
                message = await read_message(reader)
            except ProtocolError as exc:
                LOG.warning("malformed frame: %s (%s)", exc.code, exc.message)
                try:
                    await send(error_message(exc.code, exc.message))
                except (ConnectionError, BrokenPipeError):
                    pass
                break
            if message is None:
                break
            await handle_request(message, manager, send)
    except (ConnectionError, BrokenPipeError):
        LOG.info("client connection dropped")
    except Exception:
        LOG.exception("client handler failed; connection closed")
    finally:
        beat.cancel()
        rx_task.cancel()
        for task in (beat, rx_task):
            try:
                await task
            except asyncio.CancelledError:
                pass
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        LOG.info("client disconnected")


async def serve(path: Path) -> None:
    manager = BusManager()
    server = await asyncio.start_unix_server(
        lambda reader, writer: client_session(reader, writer, manager),
        path=str(path),
    )
    os.chmod(path, 0o600)
    LOG.info("listening on %s (max frame %s bytes)", path, MAX_FRAME_BYTES)
    try:
        async with server:
            await server.serve_forever()
    finally:
        manager.close_all()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vanillabus-engine")
    parser.add_argument("--ipc", required=True, help="Unix domain socket path")
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="vanillabus-engine %(levelname)s %(message)s",
    )
    path = prepare_listen_path(args.ipc)
    try:
        asyncio.run(serve(path))
    except KeyboardInterrupt:
        LOG.info("stopped")
    return 0
