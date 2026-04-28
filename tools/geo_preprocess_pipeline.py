"""
CLI: geometric normalization before row_sign / segmentation.

Writes mandatory debug images:
  step1_rotated.png
  step2_flattened.png
  step3_roi.png
  rows/row_XX_rotated.png   (when --rows-dir is set)

Does not call EasyOCR, PaddleOCR, or ML Kit.

Example:
  python tools/geo_preprocess_pipeline.py --input ticket.jpg --out-dir ./geo_debug
  python tools/geo_preprocess_pipeline.py --input ticket.jpg --out-dir ./geo_debug --no-perspective
  python tools/geo_preprocess_pipeline.py --rows-dir ./rows_in --out-dir ./geo_debug
  python tools/geo_preprocess_pipeline.py --input ticket.jpg --rows-dir ./rows_in --out-dir ./geo_debug
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

from ticket_geometry import (
    GeoPipelineConfig,
    binarize_for_pipeline,
    deskew_segmented_row_files,
    run_geometry_with_intermediates,
)


def _load_bgr(path: Path) -> np.ndarray:
    raw = np.fromfile(str(path), dtype=np.uint8)
    im = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if im is None:
        raise FileNotFoundError(path)
    return im


def main() -> int:
    ap = argparse.ArgumentParser(description="Ticket geometry: deskew, perspective, ROI, row deskew.")
    ap.add_argument(
        "--input",
        type=Path,
        help="Input ticket image (use with --out-dir for steps 1–3).",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=Path("geo_debug"),
        help="Output directory for debug images and geo_meta.json.",
    )
    ap.add_argument("--no-deskew", action="store_true", help="Disable global deskew (step 1).")
    ap.add_argument("--no-perspective", action="store_true", help="Disable perspective flatten (step 2).")
    ap.add_argument("--no-roi", action="store_true", help="Disable ROI crop (step 3).")
    ap.add_argument(
        "--deskew-method",
        choices=("hough", "minrect"),
        default="hough",
        help="Global deskew method.",
    )
    ap.add_argument(
        "--roi-top",
        type=float,
        default=0.25,
        metavar="FRAC",
        help="Remove this fraction from top (default 0.25).",
    )
    ap.add_argument(
        "--roi-bottom",
        type=float,
        default=0.20,
        metavar="FRAC",
        help="Remove this fraction from bottom (default 0.20).",
    )
    ap.add_argument(
        "--rows-dir",
        type=Path,
        help="Folder with segmented row PNGs; writes rows/row_XX_rotated.png under out-dir.",
    )
    ap.add_argument(
        "--no-row-deskew",
        action="store_true",
        help="When using --rows-dir, skip per-row rotation.",
    )
    ap.add_argument(
        "--binarize-preview",
        choices=("none", "otsu", "otsu_after_clahe", "adaptive_gaussian", "adaptive_mean"),
        default="none",
        help="Optional: write step4_binarize_preview.png from final ROI grayscale (for segmentation tuning).",
    )
    args = ap.parse_args()

    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    meta: dict = {"steps": []}

    if args.input is None and args.rows_dir is None:
        print("Error: provide --input and/or --rows-dir", file=sys.stderr)
        return 2

    cfg = GeoPipelineConfig(
        deskew=not args.no_deskew,
        perspective=not args.no_perspective,
        roi_crop=not args.no_roi,
        deskew_method=args.deskew_method,
        roi_remove_top_frac=args.roi_top,
        roi_remove_bottom_frac=args.roi_bottom,
    )

    final_bgr: np.ndarray | None = None

    if args.input is not None:
        if not args.input.is_file():
            print(f"Error: not a file: {args.input}", file=sys.stderr)
            return 2
        bgr = _load_bgr(args.input)
        step1, step2, step3, gmeta = run_geometry_with_intermediates(bgr, cfg)
        meta.update(gmeta)
        meta["steps"].append("geometry_1_2_3")

        cv2.imwrite(str(out_dir / "step1_rotated.png"), step1)
        cv2.imwrite(str(out_dir / "step2_flattened.png"), step2)
        cv2.imwrite(str(out_dir / "step3_roi.png"), step3)
        final_bgr = step3

        if args.binarize_preview != "none":
            gray = cv2.cvtColor(step3, cv2.COLOR_BGR2GRAY)
            bw = binarize_for_pipeline(gray, args.binarize_preview)  # type: ignore[arg-type]
            if bw is not None:
                cv2.imwrite(str(out_dir / "step4_binarize_preview.png"), bw)

    if args.rows_dir is not None and not args.no_row_deskew:
        if not args.rows_dir.is_dir():
            print(f"Error: not a directory: {args.rows_dir}", file=sys.stderr)
            return 2
        row_results = deskew_segmented_row_files(args.rows_dir, out_dir, pattern="row_*.png")
        meta["row_deskew"] = [{"file": n, "angle_deg": a} for n, a in row_results]
        meta["steps"].append("row_deskew")
    elif args.rows_dir is not None:
        meta["row_deskew"] = []
        meta["steps"].append("row_deskew_skipped")

    with open(out_dir / "geo_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)

    if args.input is not None:
        # Recommended next input for row_sign_export / downstream scripts
        out_final = out_dir / "ticket_for_row_sign.png"
        if final_bgr is not None:
            cv2.imwrite(str(out_final), final_bgr)
        print("Wrote:", out_dir / "step1_rotated.png")
        print("Wrote:", out_dir / "step2_flattened.png")
        print("Wrote:", out_dir / "step3_roi.png")
        print("Wrote:", out_dir / "ticket_for_row_sign.png")
    if args.rows_dir is not None and not args.no_row_deskew:
        print("Wrote row deskew under:", out_dir / "rows")
    print("Wrote:", out_dir / "geo_meta.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
