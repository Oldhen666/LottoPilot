"""Default dataset/output locations under the user's batch folder (Downloads)."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path


def batch_root() -> Path:
    """Override with env LOTTOPILOT_OCR_BATCH_ROOT for non-Windows or custom layout."""
    env = os.environ.get("LOTTOPILOT_OCR_BATCH_ROOT")
    if env:
        return Path(env)
    return Path(r"C:\Users\xiang\Downloads\lottopilot_test\Powerball\CA\batch")


def default_dataset_dir() -> Path:
    return batch_root() / "example_dataset"


def default_output_dir() -> Path:
    """Timestamped run folder under batch/test_outputs/."""
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return batch_root() / "test_outputs" / f"run_{stamp}"
