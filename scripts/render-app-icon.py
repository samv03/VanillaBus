#!/usr/bin/env python3
"""Rasterize VanillaBus icon masters from the concept-A PNG.

Writes:
  build/icon.png           1024×1024 master (rounded square, transparent corners)
  build/icons/{size}x{size}.png  Linux icon set for electron-builder
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO / "build" / "icon-concept-a.png"
MASTER_SIZE = 1024
# ~22% corner radius — same language as the concept squircle.
CORNER_RATIO = 0.22
BG = (13, 17, 23, 255)  # --bg #0d1117
LINUX_SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)


def snap_background(im: Image.Image) -> Image.Image:
    """Flatten near-black canvas noise to the app background color."""
    src = im.convert("RGBA")
    pixels = src.load()
    w, h = src.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            # Trace cutouts and charcoal field — keep them a single dark.
            if max(r, g, b) < 40 and b - r < 30:
                pixels[x, y] = BG
    return src


def apply_rounded_mask(im: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", im.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), radius=radius, fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out


def render_master(source: Path) -> Image.Image:
    raw = Image.open(source).convert("RGBA")
    if raw.size != (MASTER_SIZE, MASTER_SIZE):
        raw = raw.resize((MASTER_SIZE, MASTER_SIZE), Image.Resampling.LANCZOS)
    snapped = snap_background(raw)
    return apply_rounded_mask(snapped, radius=round(MASTER_SIZE * CORNER_RATIO))


def write_icons(master: Image.Image, dest_root: Path) -> None:
    dest_root.mkdir(parents=True, exist_ok=True)
    icons = dest_root / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    master.save(dest_root / "icon.png", "PNG")
    for size in LINUX_SIZES:
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(icons / f"{size}x{size}.png", "PNG")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--dest", type=Path, default=REPO / "build")
    args = parser.parse_args()
    if not args.source.is_file():
        raise SystemExit(f"icon source missing: {args.source}")
    write_icons(render_master(args.source), args.dest)
    print(f"wrote {args.dest / 'icon.png'} and {args.dest / 'icons'}")


if __name__ == "__main__":
    main()
