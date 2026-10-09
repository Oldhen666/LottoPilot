"""
Batch EasyOCR on row_*_clean.png from geo_seg_outputs (or a custom rows directory).

Reuses read_six_pairs from ocr_row_six_digits.py (6× two-digit groups per row).

Default output: UTF-8 .txt summaries (combined + per bundle). Use --json to also write .json.

  python tools/ocr_geo_seg_read.py
  python tools/ocr_geo_seg_read.py --bundle docs/geo_seg_outputs/diag_sample1_geo_seg
  python tools/ocr_geo_seg_read.py --rows-dir path/to/rows
  python tools/ocr_geo_seg_read.py --json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

_TOOLS = Path(__file__).resolve().parent
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from ocr_row_six_digits import _load_bgr, read_six_pairs  # noqa: E402
from ocr_seg_summary_txt import format_bundle_block, format_combined, write_txt  # noqa: E402


def _find_bundles(repo: Path) -> list[Path]:
    root = repo / "docs" / "geo_seg_outputs"
    if not root.is_dir():
        return []
    out: list[Path] = []
    for p in sorted(root.iterdir()):
        if not p.is_dir():
            continue
        rows = p / "row_sign_geo_seg" / "rows"
        if rows.is_dir() and any(rows.glob("row_*_clean.png")):
            out.append(p)
    return out


def _read_bundle(reader, bundle_dir: Path) -> dict:
    rows_dir = bundle_dir / "row_sign_geo_seg" / "rows"
    paths = sorted(rows_dir.glob("row_*_clean.png"))
    rows_out: list[dict] = []
    for img_path in paths:
        bgr = _load_bgr(img_path)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        pairs, meta = read_six_pairs(reader, gray)
        row: dict = {
            "file": img_path.name,
            "six_pairs": pairs,
            "mode": meta.get("mode"),
        }
        for k in ("digits_full", "digits_merged", "digits_main_roi", "digits_pb_roi"):
            if k in meta:
                row[k] = meta[k]
        rows_out.append(row)
    return {"bundle": str(bundle_dir), "row_count": len(rows_out), "rows": rows_out}


def _read_rows_dir(reader, rows_dir: Path) -> dict:
    paths = sorted(rows_dir.glob("row_*_clean.png"))
    rows_out: list[dict] = []
    for img_path in paths:
        bgr = _load_bgr(img_path)
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        pairs, meta = read_six_pairs(reader, gray)
        row = {
            "file": img_path.name,
            "six_pairs": pairs,
            "mode": meta.get("mode"),
        }
        for k in ("digits_full", "digits_merged", "digits_main_roi", "digits_pb_roi"):
            if k in meta:
                row[k] = meta[k]
        rows_out.append(row)
    return {"rows_dir": str(rows_dir), "row_count": len(rows_out), "rows": rows_out}


def main() -> int:
    try:
        import easyocr
    except ImportError:
        print("Error: easyocr is required. Install: pip install easyocr", file=sys.stderr)
        return 2

    ap = argparse.ArgumentParser(description="EasyOCR batch read on geo seg row strips.")
    ap.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Repo root (default: parent of tools/).",
    )
    ap.add_argument(
        "--bundle",
        type=Path,
        action="append",
        help="Single bundle dir (…/diag_sampleN_geo_seg). Repeatable.",
    )
    ap.add_argument("--rows-dir", type=Path, help="Only read this rows/ folder (no bundle scan).")
    ap.add_argument(
        "--out",
        type=Path,
        help="Combined summary .txt (default: docs/geo_seg_outputs/ocr_read.txt).",
    )
    ap.add_argument(
        "--json",
        action="store_true",
        help="Also write ocr_read.json (combined + per bundle).",
    )
    ap.add_argument(
        "--out-json",
        type=Path,
        help="Combined JSON path when using --json (default next to --out with .json).",
    )
    ap.add_argument("--gpu", action="store_true", help="Use GPU for EasyOCR if available.")
    args = ap.parse_args()

    repo = args.repo.resolve()

    print("Loading EasyOCR (first run may download models)...", flush=True)
    reader = easyocr.Reader(["en"], gpu=args.gpu, verbose=False)

    results: dict = {"bundles": [], "engine": "easyocr"}

    if args.rows_dir is not None:
        rd = args.rows_dir.resolve()
        if not rd.is_dir():
            print("Error: not a directory:", rd, file=sys.stderr)
            return 2
        block = _read_rows_dir(reader, rd)
        results["bundles"].append(block)
        out_txt = args.out or (rd.parent / "ocr_read.txt")
    else:
        bundles = []
        if args.bundle:
            bundles = [b.resolve() for b in args.bundle]
        else:
            bundles = _find_bundles(repo)
        if not bundles:
            print("Error: no bundles under docs/geo_seg_outputs — run geo_row_segment.py --diag-samples first.", file=sys.stderr)
            return 2
        for bd in bundles:
            rdir = bd / "row_sign_geo_seg" / "rows"
            if not rdir.is_dir():
                print("Skip (no rows):", bd, file=sys.stderr)
                continue
            print("Reading:", bd.name, flush=True)
            block = _read_bundle(reader, bd)
            results["bundles"].append(block)
            per_txt = bd / "row_sign_geo_seg" / "ocr_read.txt"
            write_txt(per_txt, format_bundle_block(block, engine="easyocr"))
            print("  Wrote:", per_txt)
            if args.json:
                per_json = bd / "row_sign_geo_seg" / "ocr_read.json"
                with open(per_json, "w", encoding="utf-8") as f:
                    json.dump(block, f, indent=2, ensure_ascii=False)
                print("  Wrote:", per_json)
        out_txt = args.out or (repo / "docs" / "geo_seg_outputs" / "ocr_read.txt")

    write_txt(out_txt, format_combined(results, engine="easyocr"))
    print("Wrote:", out_txt)
    if args.json:
        jpath = args.out_json or out_txt.with_suffix(".json")
        with open(jpath, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print("Wrote:", jpath)

    # Human-readable summary
    for block in results["bundles"]:
        label = block.get("bundle") or block.get("rows_dir", "?")
        print()
        print("===", Path(label).name if label else "?", "===")
        for row in block.get("rows", []):
            pairs = row.get("six_pairs") or []
            ps = " ".join(pairs) if pairs else "(none)"
            print(f"  {row.get('file')}: [{ps}]  mode={row.get('mode')}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
