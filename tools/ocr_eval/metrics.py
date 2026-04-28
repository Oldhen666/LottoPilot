"""Per-row metrics and failure categories."""

from __future__ import annotations

from enum import Enum
from typing import Any

from .dataset import RowTruth
from .row_result import RowOcrResult


def re_digits(s: str) -> str:
    return "".join(c for c in s if c.isdigit())


class ErrorCategory(str, Enum):
    OK = "OK"
    ROW_PARSE_FAIL = "ROW_PARSE_FAIL"
    WRONG_MAIN_COUNT = "WRONG_MAIN_COUNT"
    WRONG_PB_COUNT = "WRONG_PB_COUNT"
    DIGIT_SUBSTITUTION = "DIGIT_SUBSTITUTION"
    MERGED_GROUPS = "MERGED_GROUPS"
    SPLIT_GROUPS = "SPLIT_GROUPS"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    EMPTY_RESULT = "EMPTY_RESULT"
    NO_TRUTH = "NO_TRUTH"


def categorize(pred: RowOcrResult, truth: RowTruth | None, low_conf_threshold: float = 0.35) -> ErrorCategory:
    if truth is None:
        return ErrorCategory.NO_TRUTH
    if pred.confidence is not None and pred.confidence < low_conf_threshold:
        return ErrorCategory.LOW_CONFIDENCE
    raw = (pred.raw_text or "").strip()
    if not raw and not pred.main_numbers and not pred.powerball:
        return ErrorCategory.EMPTY_RESULT
    if not pred.valid_structure:
        m = pred.meta.get("mode", "")
        if "split_groups" in m or pred.warnings and any("SPLIT_GROUPS" in w for w in pred.warnings):
            return ErrorCategory.SPLIT_GROUPS
        if "merged" in raw.lower():
            return ErrorCategory.MERGED_GROUPS
        mains = pred.main_numbers
        if len(mains) != 5:
            return ErrorCategory.WRONG_MAIN_COUNT
        if not pred.powerball or len(pred.powerball) != 2:
            return ErrorCategory.WRONG_PB_COUNT
        return ErrorCategory.ROW_PARSE_FAIL
    # structure valid but may still be wrong vs truth
    return ErrorCategory.OK


def evaluate_vs_truth(truth: RowTruth, pred: RowOcrResult, *, low_conf_threshold: float = 0.35) -> dict[str, Any]:
    tm = [_norm(x) for x in truth.main_numbers[:5]]
    while len(tm) < 5:
        tm.append("")
    tp = _norm(truth.powerball)
    pm = [_norm(x) for x in pred.main_numbers[:5]]
    while len(pm) < 5:
        pm.append("")
    pp = _norm(pred.powerball)

    main_ok = [i for i in range(5) if tm[i] and pm[i] and tm[i] == pm[i]]
    main_acc = len(main_ok) / 5.0
    pb_ok = bool(tp and pp and tp == pp)

    td = "".join(tm) + tp
    pd = "".join(pm) + pp
    digit_hits = sum(1 for i in range(min(12, len(td), len(pd))) if td[i] == pd[i])
    digit_acc = digit_hits / 12.0

    exact = (
        len(pred.main_numbers) == 5
        and pred.valid_structure
        and all(tm[i] == pm[i] for i in range(5))
        and tp == pp
    )

    if exact:
        cat: ErrorCategory = ErrorCategory.OK
    elif pred.confidence is not None and pred.confidence < low_conf_threshold:
        cat = ErrorCategory.LOW_CONFIDENCE
    elif not pred.valid_structure:
        cat = categorize(pred, truth)
    else:
        cat = ErrorCategory.DIGIT_SUBSTITUTION

    return {
        "exact_row_match": exact,
        "main_correct_count": len(main_ok),
        "main_group_accuracy": main_acc,
        "powerball_correct": pb_ok,
        "digit_level_hits": digit_hits,
        "digit_level_total": 12,
        "digit_level_accuracy": digit_acc,
        "category": cat.value,
    }


def _norm(x: str) -> str:
    d = "".join(c for c in str(x) if c.isdigit())
    if len(d) == 0:
        return ""
    if len(d) >= 2:
        return d[-2:].zfill(2)
    return d.zfill(2)


def structural_validity(pred: RowOcrResult) -> bool:
    if len(pred.main_numbers) != 5:
        return False
    if not pred.powerball or len(pred.powerball) != 2:
        return False
    return all(len(m) == 2 and m.isdigit() for m in pred.main_numbers) and pred.powerball.isdigit()
