"""Raw RX batching (T5 stub). Not production Trace (T9)."""

from __future__ import annotations

import queue
import threading
import time
from typing import Any

# Flush when this much time has passed *or* this many frames are ready.
RX_BATCH_INTERVAL_S = 0.016
RX_BATCH_MAX_FRAMES = 500
RX_QUEUE_MAX = 4096
RX_RECV_TIMEOUT_S = 0.05


def now_ts_us() -> int:
    return time.time_ns() // 1_000


def _hex_data(data: Any) -> str:
    if data is None:
        return ""
    if isinstance(data, (bytes, bytearray, memoryview)):
        return bytes(data).hex()
    return bytes(data).hex()


def message_to_frame(
    msg: Any, bus_id: str, if_name: str, ts_us: int | None = None
) -> dict[str, Any]:
    """Map a python-can Message to the IPC FrameEvent object."""
    data = _hex_data(getattr(msg, "data", b""))
    dlc_raw = getattr(msg, "dlc", None)
    try:
        dlc = int(dlc_raw) if dlc_raw is not None else len(data) // 2
    except (TypeError, ValueError):
        dlc = len(data) // 2
    return {
        "busId": bus_id,
        "ifName": if_name,
        "ts_us": int(ts_us if ts_us is not None else now_ts_us()),
        "can_id": int(getattr(msg, "arbitration_id", 0)),
        "dlc": dlc,
        "data": data,
        "is_eff": bool(getattr(msg, "is_extended_id", False)),
        "is_fd": bool(getattr(msg, "is_fd", False)),
        "brs": bool(getattr(msg, "bitrate_switch", False)),
        "is_rtr": bool(getattr(msg, "is_remote_frame", False)),
        "is_err": bool(getattr(msg, "is_error_frame", False)),
        "dir": "rx",
        "rate_ms": None,
    }


class RxPump:
    """recv() thread + bounded drop-oldest queue for one open bus."""

    def __init__(
        self, bus: Any, bus_id: str, if_name: str, queue_max: int = RX_QUEUE_MAX
    ) -> None:
        self._bus = bus
        self._bus_id = bus_id
        self._if_name = if_name
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=queue_max)
        self._dropped = 0
        self._dropped_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def dropped(self) -> int:
        with self._dropped_lock:
            return self._dropped

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._recv_loop,
            name=f"vanillabus-rx-{self._if_name}",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)

    def drain(self, max_frames: int) -> list[dict[str, Any]]:
        frames: list[dict[str, Any]] = []
        while len(frames) < max_frames:
            try:
                frames.append(self._queue.get_nowait())
            except queue.Empty:
                break
        return frames

    def _note_drop(self) -> None:
        with self._dropped_lock:
            self._dropped += 1

    def _enqueue(self, frame: dict[str, Any]) -> None:
        if self._queue.full():
            try:
                self._queue.get_nowait()
                self._note_drop()
            except queue.Empty:
                pass
        try:
            self._queue.put_nowait(frame)
        except queue.Full:
            self._note_drop()

    def _recv_loop(self) -> None:
        while not self._stop.is_set():
            try:
                msg = self._bus.recv(timeout=RX_RECV_TIMEOUT_S)
            except Exception:
                if self._stop.is_set():
                    return
                time.sleep(RX_RECV_TIMEOUT_S)
                continue
            if msg is None:
                continue
            try:
                frame = message_to_frame(msg, self._bus_id, self._if_name)
            except Exception:
                continue
            self._enqueue(frame)
