# Vendor SocketCAN matrix (T15)

VanillaBus talks to **Linux SocketCAN only** (`can0`, `vcan0`, …) through
python-can. There is no Peak PCAN-Basic, Kvaser CANlib, or HMS ECI backend
in this repository (those stay POST-MVP). Do **not** install vendor
character-device stacks as the default path.

Documented host: **Ubuntu 22.04 or 24.04**.

## Adapter matrix

| Vendor | SocketCAN module | Kernel | Ubuntu 22.04 / 24.04 | Default for VanillaBus |
| --- | --- | --- | --- | --- |
| PEAK-System | `peak_usb` (USB), also `peak_pci` / `peak_pciefd` | **Mainline** (`CONFIG_CAN_PEAK_USB`, …) | In-tree module | Yes — SocketCAN `canX` |
| Kvaser | `kvaser_usb` (USB), also `kvaser_pci` / `kvaser_pciefd` | **Mainline** (`CONFIG_CAN_KVASER_USB`, …) | In-tree module | Yes — SocketCAN `canX` |
| IXXAT / HMS | `ix_usb_can` (HMS SocketCAN) | **Out-of-tree / DKMS** | **Both 22.04 and 24.04**: not shipped. Distro kernels have **no** `CONFIG_CAN_IXXAT_USB`. | Yes — after HMS OOT/DKMS install |
| Virtual | `vcan` / `vxcan` | Mainline | In-tree | Yes — `scripts/setup-vcan.sh` |

Never recommend:

- PEAK **chardev** (`pcan`, `/dev/pcan*`, PCAN-Basic)
- Kvaser **LinuxCAN** (`leaf`, `mhydra`, CANlib)

Those stacks blacklist the mainline SocketCAN modules and hide `canX` from
`bus.list`.

## Confirm the module

```bash
# PEAK
modinfo peak_usb
lsmod | grep peak
grep CONFIG_CAN_PEAK /boot/config-$(uname -r)

# Kvaser
modinfo kvaser_usb
lsmod | grep kvaser
grep CONFIG_CAN_KVASER /boot/config-$(uname -r)

# IXXAT (OOT — expect "not found" until DKMS is installed)
modinfo ix_usb_can
lsmod | grep ix_usb_can
grep CONFIG_CAN_IXXAT_USB /boot/config-$(uname -r)   # typically empty on 22.04/24.04
dkms status | grep -i ix_usb || true

# Any SocketCAN iface
ip -details link show type can
ls -l /sys/class/net/can0/device/driver   # driver name = kind hint
```

`bus.list` reports `kind` / `driver` / `vendor` / `module` from that sysfs
driver symlink. `vcan*` is classified as vendor `virtual`.

## PEAK (mainline `peak_usb`)

PCAN-USB / USB FD / USB Pro appear as `canX` once `peak_usb` is loaded.
Bring the iface up **before** Connect (the engine will not `ip link set up`):

```bash
sudo modprobe peak_usb
sudo ip link set can0 up type can bitrate 500000
```

The optional Peak Linux driver (chardev, default `make` without
`NET=NETDEV_SUPPORT`) installs `/etc/modprobe.d/blacklist-peak.conf` and
often `/etc/modprobe.d/pcan.conf`. That **blacklists** `peak_usb`,
`peak_pci`, and `peak_pciefd`. VanillaBus then cannot see the adapter.

### Uninstall Peak chardev (restore SocketCAN)

```bash
# From the peak-linux-driver source tree used to install:
sudo make uninstall
sudo rm -f /etc/modprobe.d/blacklist-peak.conf /etc/modprobe.d/pcan.conf
sudo rmmod pcan 2>/dev/null || true
sudo modprobe peak_usb
# Replug the adapter or reboot if canX still missing.
```

Do not use Peak's NetDev build as the default either — mainline `peak_usb`
is enough.

## Kvaser (mainline `kvaser_usb`)

Leaf / U100 / many USB interfaces appear as `canX` with `kvaser_usb`.

```bash
sudo modprobe kvaser_usb
sudo ip link set can0 up type can bitrate 500000
```

Kvaser **LinuxCAN** writes `/etc/modprobe.d/kvaser.conf` with:

```
blacklist kvaser_usb
blacklist kvaser_pci
blacklist kvaser_pciefd
```

and loads proprietary modules (`leaf`, `mhydra`, …). That is the usual
reason a Kvaser dongle never shows up in VanillaBus.

### Uninstall LinuxCAN (restore SocketCAN)

```bash
# From the linuxcan source tree:
sudo make uninstall
# If leftover:
sudo rm -f /etc/modprobe.d/kvaser.conf
sudo rmmod leaf mhydra usbcanII pcican pcicanII 2>/dev/null || true
sudo modprobe kvaser_usb
```

Do not install CANlib / LinuxCAN for VanillaBus.

## IXXAT / HMS (OOT/DKMS on 22.04 **and** 24.04)

Ubuntu 22.04 (5.15) and 24.04 (6.8 generic) **do not** ship an IXXAT
SocketCAN module. `grep CONFIG_CAN_IXXAT_USB /boot/config-$(uname -r)` is
empty. A mainline patch series exists upstream; it is **not** the path on
these Ubuntu releases.

Install HMS's SocketCAN driver (GPL, no proprietary blob):

[https://github.com/hms-networks/ixxat-socketcan-usb](https://github.com/hms-networks/ixxat-socketcan-usb)

```bash
sudo apt install -y linux-headers-$(uname -r) build-essential dkms
git clone https://github.com/hms-networks/ixxat-socketcan-usb.git
cd ixxat-socketcan-usb
make all
sudo make install          # uses DKMS when `dkms` is installed (module ix_usb_can)
sudo modprobe ix_usb_can
sudo ip link set can0 up type can bitrate 500000
```

Confirm:

```bash
modinfo ix_usb_can
dkms status | grep ix_usb_can
ls -l /sys/class/net/can0/device/driver   # should resolve to ix_usb_can
```

VanillaBus does **not** vendor this module and will not build kernel
modules in-repo. HMS **ECI** (proprietary userspace) is out of scope.

## Blacklist detection

`bus.list` scans `/etc/modprobe.d/*.conf` for `blacklist` / `install` lines
that name `peak_usb`, `peak_pci`, `peak_pciefd`, `kvaser_usb`, `kvaser_pci`,
or `kvaser_pciefd`. It also looks under `/sys/module` for loaded
proprietary modules (`pcan`, `leaf`, `mhydra`, …).

Hits are attached as:

- per-interface `blacklist` + `blacklist_reason` when the iface vendor
  matches
- optional payload `warnings[]` so the header can warn even when no
  `canX` was created

The Connect dropdown shows a short `vendor · driver` hint and an amber
warning when a hit is present. See [ipc.md](ipc.md).

## Bring-up

Interfaces must already be **UP** before `bus.open`. See
[privileges.md](privileges.md). CAN FD hardware can run classic CAN for
MVP; FD is a docs checklist only — [can-fd.md](can-fd.md).
