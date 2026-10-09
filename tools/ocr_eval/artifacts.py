"""Save debug crops for failed rows."""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

_TOOLS = Path(__file__).resolve().parents[1]
if str(_TOOLS) not in sys.path:
    sys.path.insert(0, str(_TOOLS))

from ocr_row_six_digits import _load_bgr  # noqa: E402


def save_failure_artifacts(
    row_image_path: Path,
    out_dir: Path,
    *,
    truth_json: dict | None = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(row_image_path, out_dir / "row_clean.png")
    if truth_json is not None:
        import json

        (out_dir / "truth_fragment.json").write_text(
            json.dumps(truth_json, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
    bgr = _load_bgr(row_image_path)
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]
    main_w = max(int(w * 0.72), w // 2)
    main_crop = gray[:, :main_w]
    pb_crop = gray[:, max(0, int(w * 0.70)) :]
    cv2.imwrite(str(out_dir / "main_region_gray.png"), main_crop)
    cv2.imwrite(str(out_dir / "powerball_region_gray.png"), pb_crop)
