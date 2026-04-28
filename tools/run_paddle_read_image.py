#!/usr/bin/env python3
"""Run PaddleOCR on one row strip image; print raw texts and six-pairs parse (same as paddle_row_reader)."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO / "tools") not in sys.path:
    sys.path.insert(0, str(_REPO / "tools"))

import cv2
import numpy as np

# Avoid oneDNN + PIR edge cases on some Windows CPU builds (NotImplementedError in det).
os.environ.setdefault("FLAGS_use_mkldnn", "0")
import paddle

paddle.set_flags({"FLAGS_use_mkldnn": False})

from paddle_row_reader import (
    _bbox_cx,
    _call_paddle_ocr,
    _flatten_paddle_result,
    _gray_to_rgb,
    _load_bgr,
    _upscale_if_small,
    build_paddle_ocr,
    read_six_pairs_paddle,
)


def _auto_prep_row_gray(gray: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """
    Paddle det/rec is trained mainly for dark ink on light background.
    Light-on-dark row strips: invert. Very short rows: upscale height for stable boxes.
    """
    notes: list[str] = []
    g = gray
    if float(g.mean()) < 127.5:
        g = 255 - g
        notes.append("inverted_light_ink_on_dark_bg")
    h, w = g.shape[:2]
    min_h = 96
    if h < min_h:
        sc = min_h / float(h)
        nw = max(1, int(round(w * sc)))
        nh = max(min_h, int(round(h * sc)))
        g = cv2.resize(g, (nw, nh), interpolation=cv2.INTER_CUBIC)
        notes.append(f"upscaled_to_{nh}px_h")
    return g, notes


def main() -> int:
    ap = argparse.ArgumentParser(description="PaddleOCR on a single row PNG/JPEG.")
    ap.add_argument("image", type=Path, help="Path to image (e.g. row strip after 4×+seg)")
    ap.add_argument("--gpu", action="store_true", help="Use GPU if available")
    ap.add_argument(
        "--no-auto-prep",
        action="store_true",
        help="Do not invert dark-background strips or upscale short rows (raw gray only)",
    )
    args = ap.parse_args()
    p = args.image.expanduser().resolve()
    if not p.is_file():
        print("Not found:", p, file=sys.stderr)
        return 2

    bgr = _load_bgr(p)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    print("size_in:", gray.shape[1], "x", gray.shape[0], "mean_gray:", f"{gray.mean():.1f}")

    if args.no_auto_prep:
        work = gray
        prep: list[str] = []
    else:
        work, prep = _auto_prep_row_gray(gray)
        if prep:
            print("prep:", ", ".join(prep))
            print("size_work:", work.shape[1], "x", work.shape[0])

    ocr = build_paddle_ocr(use_gpu=args.gpu)
    pairs, meta = read_six_pairs_paddle(ocr, work)
    print("--- six_pairs (5 main + PB) ---")
    print(pairs)
    print("--- meta ---")
    for k, v in meta.items():
        print(f"  {k}: {v!r}")

    rgb = _gray_to_rgb(_upscale_if_small(work))
    raw = _call_paddle_ocr(ocr, rgb)
    flat = _flatten_paddle_result(raw)
    flat.sort(key=lambda t: _bbox_cx(t[0]))
    print("--- raw left→right ---")
    for _, t in flat:
        print(" ", repr(t))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
