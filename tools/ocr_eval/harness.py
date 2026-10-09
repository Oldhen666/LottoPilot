"""End-to-end evaluation run."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2

_TOOLS = Path(__file__).resolve().parents[1]
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from ocr_row_six_digits import _load_bgr  # noqa: E402

from .artifacts import save_failure_artifacts
from .config_specs import CONFIG_REGISTRY
from .dataset import RowTruth, load_dataset
from .engines import EngineContext
from .metrics import evaluate_vs_truth
from .report_gen import build_summary, write_summary_files
from .runner import run_row_with_config


def _accum_config() -> dict[str, Any]:
    return {
        "rows_evaluated": 0,
        "exact_rows": 0,
        "sum_main_group": 0.0,
        "sum_digit_acc": 0.0,
        "pb_hits": 0,
        "invalid_structure_count": 0,
        "category_counts": defaultdict(int),
    }


def run_full_evaluation(
    dataset_root: Path,
    output_root: Path,
    config_names: list[str],
    *,
    export_failures: bool = True,
) -> dict[str, Any]:
    dataset_root = dataset_root.resolve()
    output_root = output_root.resolve()
    per_row_dir = output_root / "per_row"
    fail_root = output_root / "failures"
    per_row_dir.mkdir(parents=True, exist_ok=True)

    for c in config_names:
        if c not in CONFIG_REGISTRY:
            raise ValueError(f"Unknown config: {c}. Known: {sorted(CONFIG_REGISTRY.keys())}")

    samples = load_dataset(dataset_root)
    ctx = EngineContext()
    acc: dict[str, dict[str, Any]] = {c: _accum_config() for c in config_names}

    # For pairwise engine comparison on whole_row strategies
    ref_paddle = "paddle_whole_row" if "paddle_whole_row" in config_names else None
    ref_easy = "easyocr_whole_row" if "easyocr_whole_row" in config_names else None
    both_fail: list[str] = []
    paddle_only: list[str] = []
    easy_only: list[str] = []

    for sample in samples:
        for ri, row_path in enumerate(sample.row_paths):
            truth = sample.truths[ri] if ri < len(sample.truths) else None
            bgr = _load_bgr(row_path)
            gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
            row_key = f"{sample.sample_id}/row_{ri:02d}"
            row_payload: dict[str, Any] = {
                "sample_id": sample.sample_id,
                "row_index": ri,
                "image": str(row_path),
            }
            if truth is not None:
                row_payload["truth"] = {
                    "main_numbers": truth.main_numbers,
                    "powerball": truth.powerball,
                }
            else:
                row_payload["truth"] = None

            preds: dict[str, Any] = {}
            any_fail = False
            for cfg in config_names:
                pred = run_row_with_config(ctx, gray, cfg)
                preds[cfg] = pred.to_json_dict()
                if truth is not None:
                    ev = evaluate_vs_truth(truth, pred)
                    preds[cfg]["evaluation"] = ev
                    st = acc[cfg]
                    st["rows_evaluated"] += 1
                    if ev["exact_row_match"]:
                        st["exact_rows"] += 1
                    else:
                        any_fail = True
                    st["sum_main_group"] += ev["main_group_accuracy"]
                    st["sum_digit_acc"] += ev["digit_level_accuracy"]
                    if ev["powerball_correct"]:
                        st["pb_hits"] += 1
                    if not pred.valid_structure:
                        st["invalid_structure_count"] += 1
                    st["category_counts"][ev["category"]] += 1
                else:
                    preds[cfg]["evaluation"] = None

            row_payload["predictions"] = preds
            out_path = per_row_dir / f"{sample.sample_id}_row_{ri:02d}.json"
            out_path.write_text(json.dumps(row_payload, indent=2, ensure_ascii=False), encoding="utf-8")

            if export_failures and truth is not None and any_fail:
                fd = fail_root / sample.sample_id / f"row_{ri:02d}"
                tdict = row_payload.get("truth")
                save_failure_artifacts(row_path, fd, truth_json=tdict)

            # Reference comparison
            if truth is not None and ref_paddle and ref_easy:
                pp = preds.get(ref_paddle, {}).get("evaluation") or {}
                pe = preds.get(ref_easy, {}).get("evaluation") or {}
                ok_p = pp.get("exact_row_match") is True
                ok_e = pe.get("exact_row_match") is True
                if not ok_p and not ok_e:
                    both_fail.append(row_key)
                elif ok_p and not ok_e:
                    paddle_only.append(row_key)
                elif ok_e and not ok_p:
                    easy_only.append(row_key)

    per_config_out: dict[str, Any] = {}
    for cfg in config_names:
        st = acc[cfg]
        n = max(st["rows_evaluated"], 1)
        per_config_out[cfg] = {
            "rows_evaluated": st["rows_evaluated"],
            "exact_row_accuracy": st["exact_rows"] / n if st["rows_evaluated"] else 0.0,
            "mean_main_group_accuracy": st["sum_main_group"] / n if st["rows_evaluated"] else 0.0,
            "powerball_accuracy": st["pb_hits"] / n if st["rows_evaluated"] else 0.0,
            "mean_digit_level_accuracy": st["sum_digit_acc"] / n if st["rows_evaluated"] else 0.0,
            "invalid_structure_count": st["invalid_structure_count"],
            "category_histogram": dict(st["category_counts"]),
        }

    comparison: dict[str, Any] = {
        "both_engines_fail_on_rows_exact_match": both_fail,
        "paddle_whole_row_only_right": paddle_only,
        "easyocr_whole_row_only_right": easy_only,
        "note": "Pairwise lists use paddle_whole_row vs easyocr_whole_row when both are in config_names.",
    }

    summary = build_summary(per_config_out, comparison)
    write_summary_files(summary, output_root)
    return summary
