"""Load canonical dataset: sample_*/rows/row_*_clean.png + truth.json"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


def _norm_two_digit(s: str) -> str:
    s = re.sub(r"\D", "", str(s))
    if len(s) == 0:
        return ""
    if len(s) == 1:
        return s.zfill(2)
    if len(s) >= 2:
        return s[-2:].zfill(2) if len(s) > 2 else s.zfill(2)
    return s.zfill(2)


@dataclass
class RowTruth:
    main_numbers: list[str]  # 5 strings, each 2-digit normalized
    powerball: str

    @staticmethod
    def from_dict(d: dict) -> "RowTruth":
        mains = [_norm_two_digit(x) for x in (d.get("main_numbers") or [])]
        while len(mains) < 5:
            mains.append("")
        mains = mains[:5]
        pb = _norm_two_digit(d.get("powerball", ""))
        return RowTruth(main_numbers=mains, powerball=pb)


@dataclass
class Sample:
    sample_id: str
    root: Path
    row_paths: list[Path]  # sorted row_00_clean.png ...
    truths: list[RowTruth | None]  # aligned by row index; None if missing in truth.json


def load_truth_file(path: Path) -> list[RowTruth | None]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("rows") or []
    out: list[RowTruth | None] = []
    for r in rows:
        if not r:
            out.append(None)
            continue
        out.append(RowTruth.from_dict(r))
    return out


def load_dataset(dataset_root: Path) -> list[Sample]:
    """Each subfolder of dataset_root is a sample (e.g. sample_001)."""
    dataset_root = dataset_root.resolve()
    samples: list[Sample] = []
    for child in sorted(dataset_root.iterdir()):
        if not child.is_dir():
            continue
        rows_dir = child / "rows"
        if not rows_dir.is_dir():
            continue
        truth_path = child / "truth.json"
        truths: list[RowTruth | None] = []
        if truth_path.is_file():
            truths = load_truth_file(truth_path)
        row_paths = sorted(rows_dir.glob("row_*_clean.png"))
        if not row_paths:
            continue
        # align truths to rows: pad with None
        n = len(row_paths)
        while len(truths) < n:
            truths.append(None)
        truths = truths[:n]
        samples.append(Sample(sample_id=child.name, root=child, row_paths=row_paths, truths=truths))
    return samples
