"""
Read one play row image as **6 two-digit numbers** (5 white + 1 Powerball) with EasyOCR.

Strategy:
1. Sort detection boxes left → right, concatenate digits.
2. If we have ≥12 digits, take 6×2.
3. Otherwise run a **second pass on the right strip** (Powerball column) and merge.

This does not replace a dedicated detector; it reduces missed PB when the full-line model
stops after the main cluster.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import cv2
import numpy as np

import easyocr


def _bbox_cx(box: list | tuple) -> float:
    xs = [float(p[0]) for p in box]
    return sum(xs) / max(len(xs), 1)


def _load_bgr(path: Path) -> np.ndarray:
    raw = np.fromfile(str(path), dtype=np.uint8)
    im = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(path)
    return im


def _upscale_if_small(
    gray: np.ndarray,
    min_width: int = 200,
    min_height: int = 96,
) -> np.ndarray:
    """EasyOCR often returns no boxes on very short strips (e.g. 36 px tall previews)."""
    h, w = gray.shape[:2]
    sw = min_width / float(max(w, 1))
    sh = min_height / float(max(h, 1))
    scale = max(1.0, sw, sh)
    if scale <= 1.0:
        return gray
    nw = max(min_width, int(round(w * scale)))
    nh = max(min_height, int(round(h * scale)))
    return cv2.resize(gray, (nw, nh), interpolation=cv2.INTER_CUBIC)


def _digits_string(reader: easyocr.Reader, gray: np.ndarray, *, allowlist: str | None = "0123456789 ") -> str:
    kw: dict = {"detail": 1, "paragraph": False}
    if allowlist is not None:
        kw["allowlist"] = allowlist
    rows = reader.readtext(gray, **kw)
    rows = sorted(rows, key=lambda t: _bbox_cx(t[0]))
    return "".join(re.sub(r"\D", "", t[1]) for t in rows)


def _to_six_pairs(digit_str: str) -> list[str] | None:
    d = re.sub(r"\D", "", digit_str)
    if len(d) < 12:
        return None
    return [d[i : i + 2] for i in range(0, 12, 2)]


def read_six_pairs(reader: easyocr.Reader, gray: np.ndarray) -> tuple[list[str], dict]:
    h, w = int(gray.shape[0]), int(gray.shape[1])
    meta: dict = {"w": w, "h": h}

    ds = _digits_string(reader, _upscale_if_small(gray))
    meta["digits_full"] = ds
    six = _to_six_pairs(ds)
    if six:
        meta["mode"] = "full_12_digits"
        return six, meta

    # Split: **main** ≈ left 72% (5×2 digits) and **Powerball** ≈ right 28% (overlap allowed)
    main_cut = max(int(w * 0.72), w // 2)
    pb_x0 = max(0, int(w * 0.70))
    main = _upscale_if_small(gray[:, :main_cut])
    pb_strip = _upscale_if_small(gray[:, pb_x0:])

    ds_m = _digits_string(reader, main)
    # PB strip may contain "POWER" — use loose OCR then strip non-digits
    ds_p = _digits_string(reader, pb_strip, allowlist=None)
    meta["digits_main_roi"] = ds_m
    meta["digits_pb_roi"] = ds_p
    meta["mode"] = "split_main_pb"

    dm = re.sub(r"\D", "", ds_m)[:10]
    dp = re.sub(r"\D", "", ds_p)
    if len(dm) == 10 and len(dp) >= 2:
        merged = dm + dp[-2:]
        meta["digits_merged"] = merged
        six2 = _to_six_pairs(merged)
        if six2:
            return six2, meta

    # Full line had 10 digits but no PB in strip: try narrower PB focus (last 22%)
    if len(re.sub(r"\D", "", ds)) == 10:
        pb2 = _upscale_if_small(gray[:, int(w * 0.78) :])
        ds_p2 = _digits_string(reader, pb2, allowlist=None)
        meta["digits_pb_roi_narrow"] = ds_p2
        d2 = re.sub(r"\D", "", ds_p2)
        if len(d2) >= 2:
            merged = re.sub(r"\D", "", ds) + d2[-2:]
            meta["digits_merged"] = merged
            six3 = _to_six_pairs(merged)
            if six3:
                meta["mode"] = "full10_plus_pb_narrow"
                return six3, meta

    meta["mode"] = "incomplete"
    d = re.sub(r"\D", "", ds)
    fb = [d[i : i + 2] for i in range(0, len(d) - (len(d) % 2), 2)]
    return fb, meta


def main() -> int:
    ap = argparse.ArgumentParser(
        description="OCR one row strip → 6 two-digit numbers",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Example (use your real path, not a placeholder name):\n"
            r'  python tools\ocr_row_six_digits.py "C:\Users\xiang\Downloads\lottopilot_test\Powerball\CA\batch\processed_image\row_sign_4x_seg\rows\row_00_clean.png"'
        ),
    )
    ap.add_argument("image", type=Path, help="Path to row_XX_clean.png")
    args = ap.parse_args()

    img_path = args.image.expanduser()
    if not img_path.is_file():
        print(f"Error: file not found: {args.image}", file=sys.stderr)
        print(
            'Use the actual path to your PNG (the text 你的row_00_clean.png was only an example label).',
            file=sys.stderr,
        )
        print(
            r'Example: python tools\ocr_row_six_digits.py "...\processed_image\row_sign_4x_seg\rows\row_00_clean.png"',
            file=sys.stderr,
        )
        return 2

    bgr = _load_bgr(img_path)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    pairs, meta = read_six_pairs(reader, gray)
    print("mode:", meta.get("mode"))
    for k in (
        "digits_full",
        "digits_main_roi",
        "digits_pb_roi",
        "digits_pb_roi_narrow",
        "digits_merged",
    ):
        if k in meta:
            print(f"{k}: {meta[k]!r}")
    print("six_pairs:", pairs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
