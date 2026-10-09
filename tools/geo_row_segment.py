"""
Row segmentation after geo normalization (deskew → perspective → ROI).

Uses horizontal ink projection on a binarized mask, refines boundaries near projection minima,
crops grayscale/BGR row strips, optional per-row deskew, optional min-height resize.

Does not call OCR engines.

Typical CLI:
  python tools/geo_row_segment.py --input path/to/ticket.jpg --out-dir ./out
  python tools/geo_row_segment.py --diag-samples
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import cv2
import numpy as np

from ticket_geometry import (
    GeoPipelineConfig,
    binarize_for_pipeline,
    deskew_row_image,
    run_geometry_with_intermediates,
)


@dataclass
class SegmentConfig:
    expected_rows: int = 5
    binarize_mode: Literal["otsu", "otsu_after_clahe", "adaptive_gaussian", "adaptive_mean"] = "otsu_after_clahe"
    """Mask for horizontal projection (not necessarily what OCR sees)."""
    min_row_height_px: int = 48
    """If a crop is shorter, upscale to at least this height (width scaled)."""
    boundary_search_frac: float = 0.22
    """Fraction of one nominal band height to search for a projection minimum."""
    smooth_kernel: int = 21
    ink_extent_thresh_ratio: float = 0.28
    """Vertical extent: rows where projection exceeds max * this ratio count as ink."""


def _load_bgr(path: Path) -> np.ndarray:
    raw = np.fromfile(str(path), dtype=np.uint8)
    im = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(path)
    return im


def _smooth_1d(v: np.ndarray, k: int) -> np.ndarray:
    k = max(3, k | 1)
    ker = np.ones(k, dtype=np.float64) / k
    return np.convolve(v.astype(np.float64), ker, mode="same")


def _ink_horizontal_projection(gray: np.ndarray, binarize_mode: str) -> tuple[np.ndarray, np.ndarray]:
    """Returns (smooth_projection, ink_mask uint8 0/255 ink=white for debug)."""
    bw = binarize_for_pipeline(gray, binarize_mode)  # type: ignore[arg-type]
    assert bw is not None
    # Assume light background after Otsu on typical slips: ink is dark -> low value
    # Use foreground = dark pixels for projection sum
    ink = (bw < 128).astype(np.float64)
    proj = np.sum(ink, axis=1)
    return proj, (ink * 255).astype(np.uint8)


def _vertical_ink_extent(proj_smooth: np.ndarray, h: int, thresh_ratio: float) -> tuple[int, int]:
    mx = float(np.max(proj_smooth)) if proj_smooth.size else 0.0
    if mx < 1e-6:
        return 0, h
    thresh = mx * thresh_ratio
    ys = np.where(proj_smooth >= thresh)[0]
    if ys.size == 0:
        return 0, h
    return int(ys[0]), int(ys[-1] + 1)


def _row_boundaries(
    proj_smooth: np.ndarray,
    y0: int,
    y1: int,
    n_rows: int,
    search_frac: float,
) -> list[int]:
    """Returns strictly increasing y indices length n_rows+1 spanning [y0, y1]."""
    y0 = max(0, min(y0, y1 - 2))
    y1 = max(y0 + 2, y1)
    seg = proj_smooth[y0:y1]
    h = y1 - y0
    if h < n_rows * 4:
        return [y0 + int(round(i * h / n_rows)) for i in range(n_rows + 1)]

    band = h / n_rows
    win = max(3, int(band * search_frac))
    b: list[int] = [y0]
    for i in range(1, n_rows):
        target = y0 + int(round(i * band))
        lo = max(y0 + 1, target - win)
        hi = min(y1 - 1, target + win)
        sub = seg[lo - y0 : hi - y0 + 1]
        y_split = lo + int(np.argmin(sub)) if sub.size >= 2 else target
        min_gap = 2
        reserve = (n_rows - i) * min_gap
        y_split = max(b[-1] + min_gap, min(y_split, y1 - reserve))
        b.append(int(y_split))
    b.append(y1)
    return b


def _resize_min_height(bgr: np.ndarray, min_h: int) -> np.ndarray:
    h, w = bgr.shape[:2]
    if h >= min_h:
        return bgr
    scale = min_h / float(h)
    nw = max(1, int(round(w * scale)))
    nh = min_h
    return cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_CUBIC)


def segment_rows_from_geo_bgr(
    bgr: np.ndarray,
    cfg: SegmentConfig | None = None,
    *,
    row_deskew: bool = True,
) -> tuple[list[np.ndarray], dict]:
    """
    Segment play rows from an already geo-normalized BGR image (e.g. step3 ROI).
    Returns (list of row BGR crops bottom-to-top or top-to-bottom — here top-to-bottom), summary dict.
    """
    sc = cfg or SegmentConfig()
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    proj, ink_mask = _ink_horizontal_projection(gray, sc.binarize_mode)
    ps = _smooth_1d(proj, sc.smooth_kernel)
    h = gray.shape[0]
    y0, y1 = _vertical_ink_extent(ps, h, sc.ink_extent_thresh_ratio)
    bounds = _row_boundaries(ps, y0, y1, sc.expected_rows, sc.boundary_search_frac)

    rows: list[np.ndarray] = []
    meta_rows: list[dict] = []
    for i in range(sc.expected_rows):
        ya, yb = bounds[i], bounds[i + 1]
        crop = bgr[ya:yb, :].copy()
        ang = 0.0
        if row_deskew and crop.shape[0] >= 8 and crop.shape[1] >= 8:
            crop, ang = deskew_row_image(crop)
        crop = _resize_min_height(crop, sc.min_row_height_px)
        rows.append(crop)
        meta_rows.append({"y0": ya, "y1": yb, "deskew_deg": ang, "crop_wh": [crop.shape[1], crop.shape[0]]})

    summary = {
        "expected_rows": sc.expected_rows,
        "vertical_ink_extent": [y0, y1],
        "boundaries": bounds,
        "rows": meta_rows,
        "binarize_mode": sc.binarize_mode,
    }
    return rows, summary


def draw_boundaries_debug(bgr: np.ndarray, boundaries: list[int]) -> np.ndarray:
    vis = bgr.copy()
    h, w = vis.shape[:2]
    for y in boundaries:
        y = int(np.clip(y, 0, h - 1))
        cv2.line(vis, (0, y), (w - 1, y), (0, 255, 0), 2)
    return vis


def run_geo_and_segment(
    input_path: Path,
    out_dir: Path,
    *,
    geo: GeoPipelineConfig,
    seg: SegmentConfig,
    row_deskew: bool = True,
    save_geo_steps: bool = True,
) -> dict:
    """
    Load image → geometry (optional steps) → segment rows → write folder layout:

      out_dir/geo/step1_rotated.png ... step3_roi.png, ticket_for_row_sign.png, geo_meta.json
      out_dir/row_sign_geo_seg/rows/row_XX_clean.png
      out_dir/row_sign_geo_seg/seg_summary.json
      out_dir/row_sign_geo_seg/boundaries_overlay.png
    """
    bgr = _load_bgr(input_path)
    step1, step2, step3, gmeta = run_geometry_with_intermediates(bgr, geo)

    geo_dir = out_dir / "geo"
    seg_root = out_dir / "row_sign_geo_seg"
    rows_dir = seg_root / "rows"
    geo_dir.mkdir(parents=True, exist_ok=True)
    rows_dir.mkdir(parents=True, exist_ok=True)

    if save_geo_steps:
        cv2.imwrite(str(geo_dir / "step1_rotated.png"), step1)
        cv2.imwrite(str(geo_dir / "step2_flattened.png"), step2)
        cv2.imwrite(str(geo_dir / "step3_roi.png"), step3)
        cv2.imwrite(str(geo_dir / "ticket_for_row_sign.png"), step3)
        with open(geo_dir / "geo_meta.json", "w", encoding="utf-8") as f:
            json.dump({**gmeta, "input": str(input_path)}, f, indent=2, ensure_ascii=False)

    rows, smeta = segment_rows_from_geo_bgr(step3, seg, row_deskew=row_deskew)
    for i, row in enumerate(rows):
        cv2.imwrite(str(rows_dir / f"row_{i:02d}_clean.png"), row)

    gray = cv2.cvtColor(step3, cv2.COLOR_BGR2GRAY)
    proj, _ = _ink_horizontal_projection(gray, seg.binarize_mode)
    ps = _smooth_1d(proj, seg.smooth_kernel)
    smeta["projection_max"] = float(np.max(ps)) if ps.size else 0.0

    overlay = draw_boundaries_debug(step3, smeta["boundaries"])
    cv2.imwrite(str(seg_root / "boundaries_overlay.png"), overlay)

    with open(seg_root / "seg_summary.json", "w", encoding="utf-8") as f:
        json.dump(smeta, f, indent=2, ensure_ascii=False)

    return {"geo_meta": gmeta, "seg": smeta, "out_dir": str(out_dir)}


def main() -> int:
    ap = argparse.ArgumentParser(description="Geo-normalize ticket then segment play rows (projection).")
    ap.add_argument("--input", type=Path, help="Input ticket image.")
    ap.add_argument("--out-dir", type=Path, help="Output bundle root (geo/ + row_sign_geo_seg/).")
    ap.add_argument("--diag-samples", action="store_true", help="Process .diag_sample{1,2,3}/00_original.jpg into docs/geo_seg_outputs/.")
    ap.add_argument("--no-deskew", action="store_true")
    ap.add_argument("--no-perspective", action="store_true")
    ap.add_argument("--no-roi", action="store_true")
    ap.add_argument("--deskew-method", choices=("hough", "minrect"), default="hough")
    ap.add_argument("--roi-top", type=float, default=0.25)
    ap.add_argument("--roi-bottom", type=float, default=0.20)
    ap.add_argument("--expected-rows", type=int, default=5)
    ap.add_argument("--no-row-deskew", action="store_true")
    ap.add_argument(
        "--binarize",
        choices=("otsu", "otsu_after_clahe", "adaptive_gaussian", "adaptive_mean"),
        default="otsu_after_clahe",
    )
    args = ap.parse_args()

    repo = Path(__file__).resolve().parents[1]

    geo = GeoPipelineConfig(
        deskew=not args.no_deskew,
        perspective=not args.no_perspective,
        roi_crop=not args.no_roi,
        deskew_method=args.deskew_method,
        roi_remove_top_frac=args.roi_top,
        roi_remove_bottom_frac=args.roi_bottom,
    )
    seg = SegmentConfig(expected_rows=args.expected_rows, binarize_mode=args.binarize)

    if args.diag_samples:
        base = repo / "docs" / "geo_seg_outputs"
        base.mkdir(parents=True, exist_ok=True)
        for i in (1, 2, 3):
            inp = repo / f".diag_sample{i}" / "00_original.jpg"
            if not inp.is_file():
                print("Skip (missing):", inp, file=sys.stderr)
                continue
            out_dir = base / f"diag_sample{i}_geo_seg"
            print("Processing", inp, "->", out_dir)
            run_geo_and_segment(inp, out_dir, geo=geo, seg=seg, row_deskew=not args.no_row_deskew)
        print("Done. Outputs under:", base)
        return 0

    if args.input is None or args.out_dir is None:
        ap.print_help()
        print("Error: need --input and --out-dir, or use --diag-samples", file=sys.stderr)
        return 2

    if not args.input.is_file():
        print("Error: not a file:", args.input, file=sys.stderr)
        return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    run_geo_and_segment(args.input, args.out_dir, geo=geo, seg=seg, row_deskew=not args.no_row_deskew)
    print("Wrote:", args.out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
