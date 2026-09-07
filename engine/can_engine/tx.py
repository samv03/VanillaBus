"""Raw TX (T12): one-shot send + engine-owned cyclic jobs.

DBC pack/encode is T13 — this module only transmits raw bytes. After a
successful send the engine echoes a FrameEvent with dir=tx onto the RX
queue so Trace can show TX without relying on SocketCAN recv-own-msgs
(off by default). On vcan, a peer/candump still sees the wire frame.

Cyclic jobs are owned here (one thread per job). Deadlines use a monotonic
clock. If a send overruns the period, missed ticks are skipped (stretch)
instead of bursting catch-up frames. Host scheduling jitter is expected;
acceptance is median interval within ±10% of period_ms.
"""

from __future__ import annotations

import math
import re
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable

MAX_CLASSIC_DLC = 8
MAX_FD_DLC = 64
MAX_CAN_ID_SFF = 0x7FF
MAX_CAN_ID_EFF = 0x1FFFFFFF
HEX_CLEAN = re.compile(r"[\s:_-]+")
PERIOD_TOLERANCE = 0.10


class TxError(Exception):
    """Structured failure mapped to engine.error {code, message}."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class TxSpec:
    bus_id: str
    can_id: int
    data: bytes
    dlc: int
    is_eff: bool
    is_fd: bool
    brs: bool
    is_rtr: bool


@dataclass
class OutgoingFrame:
    """python-can Message-shaped object for tests when python-can is absent."""

    arbitration_id: int
    data: bytes
    is_extended_id: bool
    is_remote_frame: bool
    is_fd: bool
    bitrate_switch: bool
    dlc: int
    is_error_frame: bool = False


def parse_hex_data(raw: object) -> bytes:
    if not isinstance(raw, str):
        raise TxError("invalid_payload", "data must be a hex string")
    cleaned = HEX_CLEAN.sub("", raw.strip())
    if cleaned.lower().startswith("0x"):
        cleaned = cleaned[2:]
    if cleaned == "":
        return b""
    if len(cleaned) % 2 != 0 or any(ch not in "0123456789abcdefABCDEF" for ch in cleaned):
        raise TxError("invalid_payload", "data must be an even number of hex digits")
    try:
        return bytes.fromhex(cleaned)
    except ValueError as exc:
        raise TxError("invalid_payload", "data is not valid hex") from exc


def parse_can_id(raw: object) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        if isinstance(raw, str):
            text = raw.strip()
            if not text:
                raise TxError("invalid_payload", "can_id is required")
            try:
                value = int(text, 0) if text.lower().startswith("0x") else int(text, 16)
            except ValueError as exc:
                raise TxError("invalid_payload", "can_id must be an integer or hex string") from exc
        else:
            raise TxError("invalid_payload", "can_id must be an integer")
    else:
        value = raw
    if value < 0:
        raise TxError("invalid_payload", "can_id must be >= 0")
    return value


def parse_period_ms(raw: object) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        raise TxError("invalid_payload", "period_ms must be an integer >= 1")
    return raw


def _as_bool(raw: object, default: bool, field: str) -> bool:
    if raw is None:
        return default
    if not isinstance(raw, bool):
        raise TxError("invalid_payload", f"{field} must be a boolean when provided")
    return raw


def parse_tx_spec(payload: object) -> TxSpec:
    if not isinstance(payload, dict):
        raise TxError("invalid_payload", "TX payload must be an object")
    bus_id = payload.get("busId")
    if not isinstance(bus_id, str) or not bus_id:
        raise TxError("invalid_payload", "tx requires payload.busId")

    can_id = parse_can_id(payload.get("can_id"))
    data = parse_hex_data(payload.get("data"))
    is_fd = _as_bool(payload.get("is_fd"), False, "is_fd")
    is_rtr = _as_bool(payload.get("is_rtr"), False, "is_rtr")
    brs = _as_bool(payload.get("brs"), False, "brs")
    if brs and not is_fd:
        raise TxError("invalid_payload", "brs requires is_fd")

    is_eff_raw = payload.get("is_eff")
    if is_eff_raw is None:
        is_eff = can_id > MAX_CAN_ID_SFF
    else:
        is_eff = _as_bool(is_eff_raw, False, "is_eff")

    max_id = MAX_CAN_ID_EFF if is_eff else MAX_CAN_ID_SFF
    if can_id > max_id:
        kind = "extended" if is_eff else "standard"
        raise TxError("invalid_payload", f"can_id 0x{can_id:X} is out of range for {kind} IDs")

    max_dlc = MAX_FD_DLC if is_fd else MAX_CLASSIC_DLC
    if len(data) > max_dlc:
        raise TxError("invalid_payload", f"data exceeds {max_dlc} bytes for this frame type")

    dlc_raw = payload.get("dlc")
    if dlc_raw is None:
        dlc = len(data)
    else:
        if isinstance(dlc_raw, bool) or not isinstance(dlc_raw, int) or dlc_raw < 0 or dlc_raw > max_dlc:
            raise TxError("invalid_payload", f"dlc must be an integer 0–{max_dlc}")
        if dlc_raw < len(data):
            raise TxError("invalid_payload", "dlc is smaller than the data payload")
        dlc = dlc_raw

    if is_rtr:
        data = b""

    return TxSpec(
        bus_id=bus_id,
        can_id=can_id,
        data=data,
        dlc=dlc,
        is_eff=is_eff,
        is_fd=is_fd,
        brs=brs,
        is_rtr=is_rtr,
    )


def build_can_message(spec: TxSpec) -> Any:
    """Build a sendable frame. Prefer python-can.Message when installed."""
    try:
        import can
    except ImportError:
        can = None
    if can is not None:
        kwargs = {
            "arbitration_id": spec.can_id,
            "data": spec.data,
            "is_extended_id": spec.is_eff,
            "is_remote_frame": spec.is_rtr,
            "is_fd": spec.is_fd,
            "bitrate_switch": bool(spec.brs and spec.is_fd),
        }
        try:
            return can.Message(**kwargs, dlc=spec.dlc, check=False)
        except TypeError:
            try:
                return can.Message(**kwargs, dlc=spec.dlc)
            except TypeError:
                return can.Message(**kwargs)
    return OutgoingFrame(
        arbitration_id=spec.can_id,
        data=spec.data,
        is_extended_id=spec.is_eff,
        is_remote_frame=spec.is_rtr,
        is_fd=spec.is_fd,
        bitrate_switch=bool(spec.brs and spec.is_fd),
        dlc=spec.dlc,
    )


def next_cyclic_deadline(now: float, scheduled: float, period_s: float) -> float:
    """Advance one period on a monotonic grid.

    On-time or slightly late: scheduled + period. If we fell behind by more
    than one period, skip missed ticks (stretch) instead of bursting.
    """
    if period_s <= 0:
        raise ValueError("period_s must be positive")
    next_t = scheduled + period_s
    if now <= next_t:
        return next_t
    missed = math.floor((now - scheduled) / period_s)
    return scheduled + (missed + 1) * period_s


def period_error_ratio(measured: float, expected: float) -> float:
    if expected <= 0:
        raise ValueError("expected period must be positive")
    return abs(measured - expected) / expected


def within_period_tolerance(
    measured: float, expected: float, tolerance: float = PERIOD_TOLERANCE
) -> bool:
    return period_error_ratio(measured, expected) <= tolerance


class CyclicJob:
    def __init__(
        self,
        job_id: str,
        spec: TxSpec,
        period_ms: int,
        send: Callable[[TxSpec], None],
    ) -> None:
        self.job_id = job_id
        self.spec = spec
        self.period_ms = period_ms
        self._send = send
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name=f"vanillabus-tx-{job_id[:8]}",
            daemon=True,
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout=1.0)

    def _run(self) -> None:
        period_s = self.period_ms / 1000.0
        scheduled = time.monotonic()
        while not self._stop.is_set():
            try:
                self._send(self.spec)
            except Exception:
                # Keep the job alive; the next tick still runs. Close/stop
                # tears the job down. Stretch is documented for overruns.
                pass
            scheduled = next_cyclic_deadline(time.monotonic(), scheduled, period_s)
            delay = scheduled - time.monotonic()
            if delay > 0 and self._stop.wait(delay):
                break


class CyclicScheduler:
    """Thread-safe job_id → CyclicJob map. Stop is by job id."""

    def __init__(self) -> None:
        self._jobs: dict[str, CyclicJob] = {}
        self._lock = threading.Lock()

    def start(self, spec: TxSpec, period_ms: int, send: Callable[[TxSpec], None]) -> str:
        job_id = str(uuid.uuid4())
        job = CyclicJob(job_id, spec, period_ms, send)
        with self._lock:
            self._jobs[job_id] = job
        job.start()
        return job_id

    def stop(self, job_id: object) -> None:
        if not isinstance(job_id, str) or not job_id:
            raise TxError("invalid_payload", "tx.cyclic.stop requires payload.job_id")
        with self._lock:
            job = self._jobs.pop(job_id, None)
        if job is None:
            raise TxError("job_not_found", f"no cyclic job with id {job_id}")
        job.stop()

    def stop_bus(self, bus_id: str) -> None:
        with self._lock:
            victims = [job for job in self._jobs.values() if job.spec.bus_id == bus_id]
            for job in victims:
                self._jobs.pop(job.job_id, None)
        for job in victims:
            job.stop()

    def stop_all(self) -> None:
        with self._lock:
            victims = list(self._jobs.values())
            self._jobs.clear()
        for job in victims:
            job.stop()

    def job_ids(self) -> tuple[str, ...]:
        with self._lock:
            return tuple(self._jobs)
