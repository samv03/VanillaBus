# CAN FD checklist (T15 docs)

VanillaBus MVP is **classic CAN** on SocketCAN. FrameEvent already carries
`is_fd` and `brs` so later work can fill them; `rate_ms` is keyed by
`(busId, can_id, is_eff)` and **does not** include `is_fd` until FD is
enabled.

This task documents when FD would matter. It does **not** change
`bus.open` to request FD, set a data bitrate, or treat FD adapters as a
separate backend.

## When FD fields matter

| Field | Classic | FD |
| --- | --- | --- |
| `is_fd` | always `false` | `true` on FD frames |
| `brs` | `false` | bit-rate switch on that frame |
| `dlc` / payload | 0–8 bytes | up to 64 bytes |
| Kernel iface | `mtu 16` | `mtu 72` after `fd on` |
| `rate_ms` key | `(busId, can_id, is_eff)` | same until FD is enabled |

python-can SocketCAN needs `fd=True` (and the iface already configured
with a data bitrate) before FD frames TX/RX correctly. VanillaBus does
not pass that today.

## MVP adapters — classic is enough

Every named adapter in the [vendor matrix](socketcan-vendors.md) speaks
classic CAN:

| Adapter / module | FD-capable SKUs exist? | MVP path |
| --- | --- | --- |
| PEAK `peak_usb` | Yes (PCAN-USB FD, USB Pro FD, …) | Classic `bitrate` + `ip link set up type can` |
| Kvaser `kvaser_usb` | Yes (Leaf v2 FD, U100, …) | Same |
| IXXAT `ix_usb_can` | Yes (USB-to-CAN FD) | Same |
| `vcan` | Kernel can create `vcan` with FD MTU | Classic `vcan` is the documented test iface |

An FD dongle still enumerates as `canX` and works in classic mode if you
bring it up **without** `fd on`. VanillaBus therefore does **not**
implement FD open in T15.

## Operator checklist (when you actually need FD later)

1. Confirm the hardware SKU is FD (Peak USB FD, Kvaser U100, IXXAT USB-to-CAN FD, …).
2. Confirm the SocketCAN module is loaded (`peak_usb` / `kvaser_usb` / `ix_usb_can`) — not chardev / LinuxCAN.
3. Bring the iface up with both bitrates:

   ```bash
   sudo ip link set can0 up type can bitrate 500000 sample-point 0.75 \
     dbitrate 2000000 dsample-point 0.8 fd on
   ip -details link show can0   # expect mtu 72
   ```

4. Engine / python-can would need `fd=True` on `bus.open` (not implemented).
5. Extend `rate_ms` key with `is_fd` so classic and FD IDs do not collide.
6. Trace / TX UI already shows `is_fd` / `brs` on FrameEvent; pack/unpack
   of 64-byte payloads is a later change.

Until those engine steps exist, stay on classic CAN. Do not install
vendor FD SDKs (PCAN-Basic FD, CANlib, ECI) for VanillaBus.
