"""
PaddleOCR adapter for the same 6×two-digit row strategy as ocr_row_six_digits (EasyOCR).

Narrow row strips: prefer disabling doc orientation / unwarping when the installed API supports it.
"""
from __future__ import annotations

import re
from typing import Any

import cv2
import numpy as np


def _bbox_cx(box: list | tuple | np.ndarray) -> float:
    if box is None:
        return 0.0
    arr = np.asarray(box, dtype=np.float64).reshape(-1, 2)
    return float(np.mean(arr[:, 0]))


def _load_bgr(path) -> np.ndarray:
    from pathlib import Path

    p = Path(path)
    raw = np.fromfile(str(p), dtype=np.uint8)
    im = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(p)
    return im


def _upscale_if_small(
    gray: np.ndarray,
    min_width: int = 200,
    min_height: int = 96,
) -> np.ndarray:
    h, w = gray.shape[:2]
    sw = min_width / float(max(w, 1))
    sh = min_height / float(max(h, 1))
    scale = max(1.0, sw, sh)
    if scale <= 1.0:
        return gray
    nw = max(min_width, int(round(w * scale)))
    nh = max(min_height, int(round(h * scale)))
    return cv2.resize(gray, (nw, nh), interpolation=cv2.INTER_CUBIC)


def _gray_to_rgb(gray: np.ndarray) -> np.ndarray:
    if gray.ndim == 2:
        return cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)
    return cv2.cvtColor(gray, cv2.COLOR_BGR2RGB)


def _flatten_paddle_result(result: Any) -> list[tuple[Any, str]]:
    """Normalize ocr() return value to list of (box, text)."""
    lines: list[tuple[Any, str]] = []
    if result is None:
        return lines

    # PaddleX / dict-style
    if isinstance(result, dict):
        texts = result.get("rec_texts") or result.get("texts") or []
        boxes = result.get("rec_polys") or result.get("dt_polys") or result.get("boxes") or []
        for i, t in enumerate(texts):
            box = boxes[i] if i < len(boxes) else None
            lines.append((box, str(t)))
        return lines

    # List of pages (classic 2.x)
    pages = result if isinstance(result, (list, tuple)) else [result]
    for page in pages:
        if page is None:
            continue
        if isinstance(page, dict):
            for t, b in zip(page.get("rec_texts", []), page.get("rec_polys", []), strict=False):
                lines.append((b, str(t)))
            continue
        for item in page:
            if item is None:
                continue
            if not isinstance(item, (list, tuple)) or len(item) < 2:
                continue
            box, tc = item[0], item[1]
            if isinstance(tc, (list, tuple)) and len(tc) >= 1:
                text = str(tc[0])
            else:
                text = str(tc)
            lines.append((box, text))
    return lines


def _call_paddle_ocr(ocr: Any, rgb: np.ndarray) -> Any:
    if hasattr(ocr, "ocr"):
        return ocr.ocr(rgb)
    if hasattr(ocr, "predict"):
        return ocr.predict(rgb)
    raise AttributeError("PaddleOCR instance has neither ocr() nor predict()")


def _digits_string_paddle(ocr: Any, gray: np.ndarray, *, allowlist: str | None = "0123456789 ") -> str:
    rgb = _gray_to_rgb(_upscale_if_small(gray))
    raw = _call_paddle_ocr(ocr, rgb)
    pairs = _flatten_paddle_result(raw)
    pairs.sort(key=lambda t: _bbox_cx(t[0]))
    s = "".join(re.sub(r"\D", "", t[1]) for t in pairs)
    if allowlist is not None and allowlist.strip() == "0123456789 ":
        return s
    return "".join(re.sub(r"\D", "", t[1]) for t in pairs)


def _to_six_pairs(digit_str: str) -> list[str] | None:
    d = re.sub(r"\D", "", digit_str)
    if len(d) < 12:
        return None
    return [d[i : i + 2] for i in range(0, 12, 2)]


def read_six_pairs_paddle(ocr: Any, gray: np.ndarray) -> tuple[list[str], dict]:
    """Same strategy as EasyOCR read_six_pairs, using PaddleOCR for line detection + recognition."""
    h, w = int(gray.shape[0]), int(gray.shape[1])
    meta: dict = {"w": w, "h": h, "engine": "paddleocr"}

    ds = _digits_string_paddle(ocr, gray, allowlist="0123456789 ")
    meta["digits_full"] = ds
    six = _to_six_pairs(ds)
    if six:
        meta["mode"] = "full_12_digits"
        return six, meta

    main_cut = max(int(w * 0.72), w // 2)
    pb_x0 = max(0, int(w * 0.70))
    main = _upscale_if_small(gray[:, :main_cut])
    pb_strip = _upscale_if_small(gray[:, pb_x0:])

    ds_m = _digits_string_paddle(ocr, main, allowlist="0123456789 ")
    ds_p = _digits_string_paddle(ocr, pb_strip, allowlist=None)
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

    if len(re.sub(r"\D", "", ds)) == 10:
        pb2 = _upscale_if_small(gray[:, int(w * 0.78) :])
        ds_p2 = _digits_string_paddle(ocr, pb2, allowlist=None)
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


def build_paddle_ocr(*, use_gpu: bool = False) -> Any:
    """Construct PaddleOCR with best-effort kwargs for narrow strips (no doc rotate/unwarp)."""
    from paddleocr import PaddleOCR

    # New PaddleOCR (PaddleX pipeline) rejects unknown keys (e.g. show_log); older needs use_angle_cls.
    # Paddle 3.3 + CPU: oneDNN/PIR can throw NotImplementedError unless MKLDNN is off
    # (see PaddlePaddle/Paddle#77340, PaddleOCR#17539).
    candidates: list[dict[str, Any]] = [
        {
            "lang": "en",
            "use_gpu": use_gpu,
            "enable_mkldnn": False,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {
            "lang": "en",
            "use_gpu": use_gpu,
            "enable_mkldnn": False,
            "use_angle_cls": False,
        },
        {"lang": "en", "use_gpu": use_gpu, "enable_mkldnn": False},
        {"lang": "en", "enable_mkldnn": False},
        {"lang": "en", "use_gpu": use_gpu},
        {"lang": "en"},
    ]
    last_err: Exception | None = None
    for kw in candidates:
        try:
            return PaddleOCR(**kw)
        except (TypeError, ValueError) as e:
            last_err = e
            continue
    raise RuntimeError(f"Could not construct PaddleOCR: {last_err}")
