"""summary.json / summary.txt + data-driven recommendation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def build_summary(
    per_config_stats: dict[str, dict[str, Any]],
    comparison: dict[str, Any],
) -> dict[str, Any]:
    return {
        "per_configuration": per_config_stats,
        "comparison": comparison,
        "recommendation": _recommend(per_config_stats),
    }


def _recommend(per_config_stats: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Pick best config by exact_row_rate, then mean digit accuracy."""
    best_name = ""
    best_score = (-1.0, -1.0)
    for name, st in per_config_stats.items():
        er = float(st.get("exact_row_accuracy", 0.0))
        da = float(st.get("mean_digit_level_accuracy", 0.0))
        key = (er, da)
        if key > best_score:
            best_score = key
            best_name = name
    lines: list[str] = []
    if best_name:
        lines.append(
            f"Best configuration by exact-row accuracy (tie-break: digit-level): {best_name} "
            f"(exact={per_config_stats[best_name].get('exact_row_accuracy')}, "
            f"digit_acc={per_config_stats[best_name].get('mean_digit_level_accuracy')})."
        )
    paddle = [n for n in per_config_stats if n.startswith("paddle")]
    easy = [n for n in per_config_stats if n.startswith("easyocr")]
    if paddle and easy:
        pe = max(per_config_stats[n].get("exact_row_accuracy", 0) for n in paddle)
        ee = max(per_config_stats[n].get("exact_row_accuracy", 0) for n in easy)
        if pe > ee:
            lines.append(f"PaddleOCR configs peak exact-row accuracy ({pe:.4f}) exceeds EasyOCR peak ({ee:.4f}).")
        elif ee > pe:
            lines.append(f"EasyOCR configs peak exact-row accuracy ({ee:.4f}) exceeds PaddleOCR peak ({pe:.4f}).")
        else:
            lines.append("PaddleOCR and EasyOCR peak exact-row accuracy are equal; see per-strategy breakdown.")
    wr = [n for n in per_config_stats if n.endswith("whole_row")]
    sr = [n for n in per_config_stats if n.endswith("split_regions")]
    sg = [n for n in per_config_stats if n.endswith("split_groups")]
    for label, group in ("whole_row", wr), ("split_regions", sr), ("split_groups", sg):
        if group:
            mx = max(per_config_stats[n].get("exact_row_accuracy", 0) for n in group)
            lines.append(f"Max exact-row accuracy among {label} strategies: {mx:.4f}.")
    return {"best_configuration": best_name, "text_lines": lines}


def write_summary_files(summary: dict[str, Any], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    jp = out_dir / "summary.json"
    jp.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    tp = out_dir / "summary.txt"
    lines: list[str] = []
    lines.append("=== OCR Evaluation Summary ===")
    lines.append("")
    pc = summary.get("per_configuration") or {}
    for name in sorted(pc.keys()):
        st = pc[name]
        lines.append(f"[{name}]")
        lines.append(f"  rows_evaluated: {st.get('rows_evaluated', 0)}")
        lines.append(f"  exact_row_accuracy: {st.get('exact_row_accuracy', 0):.4f}")
        lines.append(f"  mean_main_group_accuracy: {st.get('mean_main_group_accuracy', 0):.4f}")
        lines.append(f"  powerball_accuracy: {st.get('powerball_accuracy', 0):.4f}")
        lines.append(f"  mean_digit_level_accuracy: {st.get('mean_digit_level_accuracy', 0):.4f}")
        lines.append(f"  invalid_structure_count: {st.get('invalid_structure_count', 0)}")
        lines.append("")
    comp = summary.get("comparison") or {}
    lines.append("=== Pairwise row outcomes (truth rows only) ===")
    for k, v in comp.items():
        lines.append(f"  {k}: {v}")
    lines.append("")
    rec = summary.get("recommendation") or {}
    lines.append("=== Recommendation (metrics-based) ===")
    for t in rec.get("text_lines") or []:
        lines.append(f"  {t}")
    lines.append("")
    tp.write_text("\n".join(lines), encoding="utf-8")
