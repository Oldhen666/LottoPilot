#!/usr/bin/env python3
"""
OCR evaluation harness CLI.

Default dataset/output (Windows):
  C:\\Users\\<you>\\Downloads\\lottopilot_test\\Powerball\\CA\\batch\\example_dataset
  C:\\Users\\<you>\\Downloads\\lottopilot_test\\Powerball\\CA\\batch\\test_outputs\\run_<timestamp>

Override root with env: LOTTOPILOT_OCR_BATCH_ROOT

Examples:
  python tools/run_ocr_eval.py
  python tools/run_ocr_eval.py --configs easyocr_whole_row paddle_whole_row
  python tools/run_ocr_eval.py --dataset D:/data/my_dataset --out D:/out/run1
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO / "tools") not in sys.path:
    sys.path.insert(0, str(_REPO / "tools"))

from ocr_eval.config_specs import list_config_names  # noqa: E402
from ocr_eval.defaults import default_dataset_dir, default_output_dir  # noqa: E402
from ocr_eval.harness import run_full_evaluation  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Lottery row OCR evaluation harness.")
    ap.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="Dataset root (sample_*/rows/, truth.json). Default: batch/example_dataset under Downloads.",
    )
    ap.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output directory. Default: batch/test_outputs/run_<timestamp>.",
    )
    ap.add_argument(
        "--configs",
        nargs="*",
        help=f"Named configs (default: all). Options: {', '.join(list_config_names())}",
    )
    ap.add_argument("--no-failure-artifacts", action="store_true", help="Do not copy crops for failed rows.")
    args = ap.parse_args()

    dataset = args.dataset or default_dataset_dir()
    out_dir = args.out or default_output_dir()
    if not dataset.is_dir():
        print(f"Error: dataset not found: {dataset}", file=sys.stderr)
        print("Set --dataset or LOTTOPILOT_OCR_BATCH_ROOT / place example_dataset under batch folder.", file=sys.stderr)
        return 2

    configs = args.configs if args.configs else list_config_names()
    summary = run_full_evaluation(
        dataset,
        out_dir,
        configs,
        export_failures=not args.no_failure_artifacts,
    )
    print("Wrote:", out_dir / "summary.txt")
    print("Wrote:", out_dir / "summary.json")
    print(json.dumps(summary.get("recommendation", {}), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
