"""
Parsing strategies on a single row gray image.

whole_row: existing read_six_pairs behavior.
split_regions: always OCR main band + PB band (no short-circuit on full-line 12 digits).
split_groups: five vertical slices on main band + PB strip.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import cv2
import numpy as np

_TOOLS = Path(__file__).resolve().parents[1]
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from ocr_row_six_digits import (  # noqa: E402
    _digits_string,
    _to_six_pairs,
    _upscale_if_small,
    read_six_pairs as easy_read_six_pairs,
)
from paddle_row_reader import (  # noqa: E402
    _digits_string_paddle,
    read_six_pairs_paddle as paddle_read_six_pairs,
)

from .row_result import RowOcrResult


def _pairs_to_row_result(pairs: list[str], raw: str, conf: float | None, meta: dict, warnings: list[str]) -> RowOcrResult:
    valid = len(pairs) == 6 and all(len(p) == 2 and p.isdigit() for p in pairs)
    mains = [pairs[i] for i in range(5)] if len(pairs) >= 5 else []
    pb = pairs[5] if len(pairs) >= 6 else ""
    if len(pairs) != 6:
        warnings = warnings + ["EXPECTED_6_GROUPS"]
    return RowOcrResult(
        main_numbers=mains,
        powerball=pb,
        raw_text=raw,
        confidence=conf,
        warnings=warnings,
        valid_structure=valid,
        meta=meta,
    )


def _easy_confidence_from_read(reader, gray) -> float | None:
    import easyocr

    rows = reader.readtext(gray, detail=1, paragraph=False, allowlist="0123456789 ")
    if not rows:
        return None
    confs = [float(t[2]) for t in rows if len(t) > 2 and t[2] is not None]
    return sum(confs) / len(confs) if confs else None


def run_easy_whole_row(reader, gray: np.ndarray) -> RowOcrResult:
    pairs, meta = easy_read_six_pairs(reader, gray)
    raw = meta.get("digits_merged") or meta.get("digits_full") or ""
    conf = _easy_confidence_from_read(reader, _upscale_if_small(gray))
    return _pairs_to_row_result(pairs, str(raw), conf, meta, [])


def run_paddle_whole_row(ocr, gray: np.ndarray) -> RowOcrResult:
    pairs, meta = paddle_read_six_pairs(ocr, gray)
    raw = meta.get("digits_merged") or meta.get("digits_full") or ""
    return _pairs_to_row_result(pairs, str(raw), None, meta, [])


def _split_regions_merge_easy(reader, gray: np.ndarray) -> tuple[list[str], str, dict]:
    h, w = gray.shape[:2]
    main_cut = max(int(w * 0.72), w // 2)
    pb_x0 = max(0, int(w * 0.70))
    main = _upscale_if_small(gray[:, :main_cut])
    pb_strip = _upscale_if_small(gray[:, pb_x0:])
    ds_m = _digits_string(reader, main, allowlist="0123456789 ")
    ds_p = _digits_string(reader, pb_strip, allowlist=None)
    meta = {"digits_main_roi": ds_m, "digits_pb_roi": ds_p, "mode": "split_main_pb_forced"}
    dm = re.sub(r"\D", "", ds_m)[:10]
    dp = re.sub(r"\D", "", ds_p)
    pairs: list[str] = []
    if len(dm) >= 10:
        pairs = [dm[i : i + 2] for i in range(0, 10, 2)]
        if len(dp) >= 2:
            pairs.append(dp[-2:])
    raw = dm + dp
    return pairs, raw, meta


def _split_regions_merge_paddle(ocr, gray: np.ndarray) -> tuple[list[str], str, dict]:
    h, w = gray.shape[:2]
    main_cut = max(int(w * 0.72), w // 2)
    pb_x0 = max(0, int(w * 0.70))
    main = _upscale_if_small(gray[:, :main_cut])
    pb_strip = _upscale_if_small(gray[:, pb_x0:])
    ds_m = _digits_string_paddle(ocr, main, allowlist="0123456789 ")
    ds_p = _digits_string_paddle(ocr, pb_strip, allowlist=None)
    meta = {"digits_main_roi": ds_m, "digits_pb_roi": ds_p, "mode": "split_main_pb_forced"}
    dm = re.sub(r"\D", "", ds_m)[:10]
    dp = re.sub(r"\D", "", ds_p)
    pairs = []
    if len(dm) >= 10:
        pairs = [dm[i : i + 2] for i in range(0, 10, 2)]
        if len(dp) >= 2:
            pairs.append(dp[-2:])
    raw = dm + dp
    return pairs, raw, meta


def run_easy_split_regions(reader, gray: np.ndarray) -> RowOcrResult:
    pairs, raw, meta = _split_regions_merge_easy(reader, gray)
    conf = _easy_confidence_from_read(reader, _upscale_if_small(gray))
    w = pairs if len(pairs) == 6 else []
    return _pairs_to_row_result(w, raw, conf, meta, [] if len(pairs) == 6 else ["SPLIT_REGIONS_INCOMPLETE"])


def run_paddle_split_regions(ocr, gray: np.ndarray) -> RowOcrResult:
    pairs, raw, meta = _split_regions_merge_paddle(ocr, gray)
    w = pairs if len(pairs) == 6 else []
    return _pairs_to_row_result(w, raw, None, meta, [] if len(pairs) == 6 else ["SPLIT_REGIONS_INCOMPLETE"])


def _five_vertical_slices(gray_main: np.ndarray) -> list[np.ndarray]:
    """Equal-width 5 columns on main band (robust default)."""
    h, w = gray_main.shape[:2]
    if w < 10:
        return []
    cols: list[np.ndarray] = []
    for i in range(5):
        x0 = int(i * w / 5)
        x1 = int((i + 1) * w / 5)
        cols.append(gray_main[:, x0:x1])
    return cols


def _ocr_two_digits_easy(reader, patch: np.ndarray) -> str:
    p = _upscale_if_small(patch)
    s = _digits_string(reader, p, allowlist="0123456789 ")
    d = re.sub(r"\D", "", s)
    if len(d) >= 2:
        return d[-2:].zfill(2)
    if len(d) == 1:
        return d.zfill(2)
    return ""


def _ocr_two_digits_paddle(ocr, patch: np.ndarray) -> str:
    p = _upscale_if_small(patch)
    s = _digits_string_paddle(ocr, p, allowlist="0123456789 ")
    d = re.sub(r"\D", "", s)
    if len(d) >= 2:
        return d[-2:].zfill(2)
    if len(d) == 1:
        return d.zfill(2)
    return ""


def run_easy_split_groups(reader, gray: np.ndarray) -> RowOcrResult:
    h, w = gray.shape[:2]
    main_w = max(int(w * 0.72), w // 2)
    main = gray[:, :main_w]
    pb_strip = gray[:, max(0, int(w * 0.70)) :]
    patches = _five_vertical_slices(main)
    mains: list[str] = []
    for p in patches:
        mains.append(_ocr_two_digits_easy(reader, p))
    ds_p = _digits_string(reader, _upscale_if_small(pb_strip), allowlist=None)
    dp = re.sub(r"\D", "", ds_p)
    pb = dp[-2:].zfill(2) if len(dp) >= 2 else ""
    pairs = mains + [pb] if len(mains) == 5 else []
    raw = "".join(mains) + pb
    meta = {"mode": "split_groups_equal5", "main_slices": mains, "pb_raw": ds_p}
    valid = len(pairs) == 6 and all(len(x) == 2 and x.isdigit() for x in pairs)
    return RowOcrResult(
        main_numbers=pairs[:5] if len(pairs) >= 5 else mains,
        powerball=pairs[5] if len(pairs) >= 6 else pb,
        raw_text=raw,
        confidence=_easy_confidence_from_read(reader, _upscale_if_small(gray)),
        warnings=[] if valid else ["SPLIT_GROUPS_INCOMPLETE"],
        valid_structure=valid,
        meta=meta,
    )


def run_paddle_split_groups(ocr, gray: np.ndarray) -> RowOcrResult:
    h, w = gray.shape[:2]
    main_w = max(int(w * 0.72), w // 2)
    main = gray[:, :main_w]
    pb_strip = gray[:, max(0, int(w * 0.70)) :]
    patches = _five_vertical_slices(main)
    mains = [_ocr_two_digits_paddle(ocr, p) for p in patches]
    ds_p = _digits_string_paddle(ocr, _upscale_if_small(pb_strip), allowlist=None)
    dp = re.sub(r"\D", "", ds_p)
    pb = dp[-2:].zfill(2) if len(dp) >= 2 else ""
    pairs = mains + [pb] if len(mains) == 5 else []
    raw = "".join(mains) + pb
    meta = {"mode": "split_groups_equal5", "main_slices": mains, "pb_raw": ds_p}
    valid = len(pairs) == 6 and all(len(x) == 2 and x.isdigit() for x in pairs)
    return RowOcrResult(
        main_numbers=pairs[:5] if len(pairs) >= 5 else mains,
        powerball=pairs[5] if len(pairs) >= 6 else pb,
        raw_text=raw,
        confidence=None,
        warnings=[] if valid else ["SPLIT_GROUPS_INCOMPLETE"],
        valid_structure=valid,
        meta=meta,
    )
