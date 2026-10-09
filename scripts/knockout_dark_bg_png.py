"""
Make dark pixels transparent (for line-art icons exported on black).
Usage: python scripts/knockout_dark_bg_png.py path/to.png [--max 40]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("png", type=Path)
    p.add_argument("--max", type=int, default=40, help="Max channel value treated as background")
    args = p.parse_args()

    path = args.png.resolve()
    img = Image.open(path).convert("RGBA")
    px = img.load()
    w, h = img.size
    mx = args.max
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if max(r, g, b) <= mx:
                px[x, y] = (r, g, b, 0)
    img.save(path, "PNG")
    print(f"Updated {path} (knocked out pixels with max(R,G,B) <= {mx})")


if __name__ == "__main__":
    main()
