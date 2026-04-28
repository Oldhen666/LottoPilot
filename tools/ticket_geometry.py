"""
Geometric normalization for lottery ticket images (OpenCV).

Designed to run **before** row_sign / segmentation / OCR. Each step is optional and
callable independently. Does not invoke any OCR engine.

Typical order:
  1. deskew_global_*  → 2. flatten_perspective  → 3. crop_play_roi
  After row segmentation: 4. deskew_row_image
  Optional binarization helpers for projection/segmentation: binarize_*
  After char segmentation: normalize_char_cell
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import cv2
import numpy as np


# --- Config -----------------------------------------------------------------


@dataclass
class GeoPipelineConfig:
    """Toggle and tune each geometry stage."""

    deskew: bool = True
    deskew_method: Literal["hough", "minrect"] = "hough"
    """hough: dominant angle from Hough lines; minrect: angle from largest ink contour."""

    perspective: bool = True
    perspective_canny_low: int = 50
    perspective_canny_high: int = 150
    approx_epsilon_frac: float = 0.02

    roi_crop: bool = True
    roi_remove_top_frac: float = 0.25
    """Fraction of height to crop from the top (header/logo)."""
    roi_remove_bottom_frac: float = 0.20
    """Fraction of height to crop from the bottom (barcode/footer)."""

    binarize_mode: Literal["none", "otsu", "otsu_after_clahe", "adaptive_gaussian", "adaptive_mean"] = (
        "otsu_after_clahe"
    )
    """For segmentation / projection; keep `none` to pass grayscale through."""

    char_normalize_size: int = 64
    """Default side length for normalize_char_cell."""


# --- Step 1: Global deskew --------------------------------------------------


def deskew_global_hough(
    bgr: np.ndarray,
    *,
    canny_low: int = 50,
    canny_high: int = 150,
    hough_threshold: int = 80,
    min_line_length: int = max(30, 1),
    max_line_gap: int = 10,
    min_abs_angle_deg: float = 0.25,
    max_abs_angle_deg: float = 45.0,
) -> tuple[np.ndarray, float]:
    """
    Estimate skew from near-horizontal Hough line segments; rotate so rows are horizontal.
    Returns (rotated_bgr, angle_deg applied, counter-clockwise positive in OpenCV convention).
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(blur, canny_low, canny_high)
    h, w = edges.shape[:2]
    min_line_length = max(min_line_length, int(min(h, w) * 0.08))
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=hough_threshold,
        minLineLength=min_line_length,
        maxLineGap=max_line_gap,
    )
    angles: list[float] = []
    if lines is not None:
        for ln in lines:
            x1, y1, x2, y2 = ln[0]
            t = math.degrees(math.atan2(float(y2 - y1), float(x2 - x1)))
            if abs(t) > max_abs_angle_deg:
                continue
            # Near-horizontal: map angles to [-45, 45]
            if t > 45:
                t -= 180
            elif t < -45:
                t += 180
            if abs(t) <= max_abs_angle_deg:
                angles.append(t)
    if not angles:
        return bgr.copy(), 0.0
    angle = float(np.median(np.array(angles, dtype=np.float64)))
    if abs(angle) < min_abs_angle_deg:
        return bgr.copy(), 0.0
    return _rotate_bound(bgr, -angle), angle


def deskew_global_minrect(bgr: np.ndarray) -> tuple[np.ndarray, float]:
    """Use minAreaRect on the largest dark contour (ticket body / ink blob)."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return bgr.copy(), 0.0
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.05 * bgr.shape[0] * bgr.shape[1]:
        return bgr.copy(), 0.0
    rect = cv2.minAreaRect(c)
    angle = float(rect[-1])
    (rw, rh) = rect[1]
    if rw < rh:
        angle += 90.0
    if angle < -45:
        angle += 90.0
    elif angle > 45:
        angle -= 90.0
    if abs(angle) < 0.2:
        return bgr.copy(), 0.0
    return _rotate_bound(bgr, -angle), angle


def deskew_global_auto(
    bgr: np.ndarray,
    method: Literal["hough", "minrect"] = "hough",
) -> tuple[np.ndarray, float]:
    if method == "minrect":
        return deskew_global_minrect(bgr)
    return deskew_global_hough(bgr)


def _rotate_bound(image: np.ndarray, angle_deg: float) -> np.ndarray:
    h, w = image.shape[:2]
    center = (w / 2.0, h / 2.0)
    m = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    cos = abs(m[0, 0])
    sin = abs(m[0, 1])
    nw = int((h * sin) + (w * cos))
    nh = int((h * cos) + (w * sin))
    m[0, 2] += (nw / 2) - center[0]
    m[1, 2] += (nh / 2) - center[1]
    return cv2.warpAffine(
        image,
        m,
        (nw, nh),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


# --- Step 2: Perspective flatten --------------------------------------------


def _order_quad_pts(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    ordered = np.zeros((4, 2), dtype=np.float32)
    ordered[0] = pts[np.argmin(s)]
    ordered[2] = pts[np.argmax(s)]
    ordered[1] = pts[np.argmin(diff)]
    ordered[3] = pts[np.argmax(diff)]
    return ordered


def flatten_perspective(
    bgr: np.ndarray,
    *,
    canny_low: int = 50,
    canny_high: int = 150,
    approx_epsilon_frac: float = 0.02,
    min_quad_area_frac: float = 0.15,
) -> tuple[np.ndarray, bool]:
    """
    Find largest quadrilateral contour and warp to top-down view.
    Returns (warped_bgr, success). On failure returns (copy of input, False).
    """
    h0, w0 = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blur, canny_low, canny_high)
    cnts, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return bgr.copy(), False
    cnts = sorted(cnts, key=cv2.contourArea, reverse=True)
    quad: np.ndarray | None = None
    min_area = min_quad_area_frac * float(w0 * h0)
    for c in cnts[:12]:
        if cv2.contourArea(c) < min_area:
            continue
        peri = cv2.arcLength(c, True)
        eps = approx_epsilon_frac * peri
        approx = cv2.approxPolyDP(c, eps, True)
        if len(approx) == 4:
            quad = approx.reshape(4, 2).astype(np.float32)
            break
    if quad is None:
        return bgr.copy(), False

    rect = _order_quad_pts(quad)
    (tl, tr, br, bl) = rect
    width_a = float(np.linalg.norm(br - bl))
    width_b = float(np.linalg.norm(tr - tl))
    max_w = int(max(width_a, width_b))
    height_a = float(np.linalg.norm(tr - br))
    height_b = float(np.linalg.norm(tl - bl))
    max_h = int(max(height_a, height_b))
    max_w = max(max_w, 1)
    max_h = max(max_h, 1)

    dst = np.array(
        [[0, 0], [max_w - 1, 0], [max_w - 1, max_h - 1], [0, max_h - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(bgr, m, (max_w, max_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return warped, True


# --- Step 3: ROI crop -------------------------------------------------------


def crop_play_roi(
    bgr: np.ndarray,
    *,
    remove_top_frac: float = 0.25,
    remove_bottom_frac: float = 0.20,
) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """
    Keep middle band; remove top/bottom fractions (configurable).
    Returns (cropped_bgr, (x, y, w, h)) in original image coords.
    """
    h, w = bgr.shape[:2]
    rt = max(0.0, min(0.49, float(remove_top_frac)))
    rb = max(0.0, min(0.49, float(remove_bottom_frac)))
    y0 = int(round(h * rt))
    y1 = int(round(h * (1.0 - rb)))
    if y1 <= y0 + 8:
        return bgr.copy(), (0, 0, w, h)
    crop = bgr[y0:y1, 0:w]
    return crop, (0, y0, w, y1 - y0)


# --- Step 4: Row-level deskew -----------------------------------------------


def deskew_row_image(bgr: np.ndarray) -> tuple[np.ndarray, float]:
    """
    Rotate a single row crop so text axis is horizontal using minAreaRect on largest ink contour.
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    cnts, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return bgr.copy(), 0.0
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.02 * gray.size:
        return bgr.copy(), 0.0
    rect = cv2.minAreaRect(c)
    angle = float(rect[-1])
    rw, rh = rect[1]
    if rw < rh:
        angle += 90.0
    if angle < -45:
        angle += 90.0
    elif angle > 45:
        angle -= 90.0
    if abs(angle) < 0.15:
        return bgr.copy(), 0.0
    return _rotate_bound(bgr, -angle), angle


# --- Step 5: Binarization (for segmentation / projection, not forced OCR) ---


def enhance_local_contrast_clahe(gray: np.ndarray, clip_limit: float = 2.0, tile: int = 8) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile, tile))
    return clahe.apply(gray)


def binarize_otsu(gray: np.ndarray) -> np.ndarray:
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return bw


def binarize_otsu_after_clahe(gray: np.ndarray) -> np.ndarray:
    g = enhance_local_contrast_clahe(gray)
    return binarize_otsu(g)


def binarize_adaptive_gaussian(gray: np.ndarray, block_size: int = 31, c: int = 5) -> np.ndarray:
    bs = block_size if block_size % 2 == 1 else block_size + 1
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, bs, c)


def binarize_adaptive_mean(gray: np.ndarray, block_size: int = 31, c: int = 5) -> np.ndarray:
    bs = block_size if block_size % 2 == 1 else block_size + 1
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, bs, c)


def binarize_for_pipeline(
    gray: np.ndarray,
    mode: Literal["none", "otsu", "otsu_after_clahe", "adaptive_gaussian", "adaptive_mean"],
) -> np.ndarray | None:
    """Returns binary image, or None if mode is none (caller keeps grayscale)."""
    m = mode if isinstance(mode, str) else mode
    if m == "none":
        return None
    if m == "otsu":
        return binarize_otsu(gray)
    if m == "otsu_after_clahe":
        return binarize_otsu_after_clahe(gray)
    if m == "adaptive_gaussian":
        return binarize_adaptive_gaussian(gray)
    if m == "adaptive_mean":
        return binarize_adaptive_mean(gray)
    return binarize_otsu_after_clahe(gray)


# --- Step 6: Char cell normalization ----------------------------------------


def normalize_char_cell(
    gray_or_bgr: np.ndarray,
    *,
    out_size: int = 64,
    pad_value: int = 255,
) -> np.ndarray:
    """
    Letterbox a single character (or digit) patch to out_size × out_size, aspect preserved.
    Input may be grayscale or BGR; output is BGR uint8.
    """
    if gray_or_bgr.ndim == 2:
        cell = cv2.cvtColor(gray_or_bgr, cv2.COLOR_GRAY2BGR)
    else:
        cell = gray_or_bgr.copy()
    h, w = cell.shape[:2]
    if h < 2 or w < 2:
        return np.full((out_size, out_size, 3), pad_value, dtype=np.uint8)
    scale = min(out_size / w, out_size / h)
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    resized = cv2.resize(cell, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_CUBIC)
    out = np.full((out_size, out_size, 3), pad_value, dtype=np.uint8)
    y0 = (out_size - nh) // 2
    x0 = (out_size - nw) // 2
    out[y0 : y0 + nh, x0 : x0 + nw] = resized
    return out


# --- High-level runner (steps 1–3) ------------------------------------------


def run_geometry_before_row_sign(
    bgr: np.ndarray,
    config: GeoPipelineConfig | None = None,
) -> tuple[np.ndarray, dict]:
    """
    Apply enabled stages in order: deskew → perspective → ROI.
    Returns (result_bgr, meta) where meta includes angles and flags actually applied.
    """
    _, _, out, meta = run_geometry_with_intermediates(bgr, config)
    return out, meta


def run_geometry_with_intermediates(
    bgr: np.ndarray,
    config: GeoPipelineConfig | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, dict]:
    """
    Same as run_geometry_before_row_sign but also returns intermediate images for debug:
    (step1_after_deskew, step2_after_perspective, step3_final, meta).

    If a stage is disabled, the corresponding intermediate equals the previous stage output.
    If perspective fails to find a quad, step2 falls back to step1 (unchanged geometry).
    """
    cfg = config or GeoPipelineConfig()
    meta: dict = {
        "deskew_angle": 0.0,
        "perspective_applied": False,
        "roi_box": None,
        "deskew_enabled": cfg.deskew,
        "perspective_enabled": cfg.perspective,
        "roi_enabled": cfg.roi_crop,
    }

    step1 = bgr.copy()
    if cfg.deskew:
        step1, ang = deskew_global_auto(step1, cfg.deskew_method)
        meta["deskew_angle"] = ang

    step2 = step1.copy()
    if cfg.perspective:
        warped, ok = flatten_perspective(
            step1,
            canny_low=cfg.perspective_canny_low,
            canny_high=cfg.perspective_canny_high,
            approx_epsilon_frac=cfg.approx_epsilon_frac,
        )
        meta["perspective_applied"] = ok
        if ok:
            step2 = warped

    step3 = step2.copy()
    if cfg.roi_crop:
        step3, box = crop_play_roi(
            step2,
            remove_top_frac=cfg.roi_remove_top_frac,
            remove_bottom_frac=cfg.roi_remove_bottom_frac,
        )
        meta["roi_box"] = box

    return step1, step2, step3, meta


def deskew_segmented_row_files(
    rows_dir: str | Path,
    out_dir: str | Path,
    *,
    pattern: str = "row_*.png",
) -> list[tuple[str, float]]:
    """
    For each row image matching pattern, write rows/row_XX_rotated.png (preserves sort order).
    Returns list of (filename, angle_deg).
    """
    rd = Path(rows_dir)
    od = Path(out_dir)
    od.mkdir(parents=True, exist_ok=True)
    rows_sub = od / "rows"
    rows_sub.mkdir(parents=True, exist_ok=True)

    paths = sorted(rd.glob(pattern))
    results: list[tuple[str, float]] = []
    for i, p in enumerate(paths):
        bgr = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        fixed, ang = deskew_row_image(bgr)
        stem = p.stem
        mo = re.match(r"row_(\d+)", stem)
        idx = int(mo.group(1)) if mo else i
        out_name = f"row_{idx:02d}_rotated.png"
        cv2.imwrite(str(rows_sub / out_name), fixed)
        results.append((out_name, ang))
    return results
