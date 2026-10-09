"""Plain-text reports for ocr_geo_seg_read / ocr_paddle_geo_seg_read."""
from __future__ import annotations

from pathlib import Path
from typing import Any


def format_bundle_block(block: dict[str, Any], *, engine: str) -> str:
    lines: list[str] = []
    lines.append(f"engine={engine}")
    label = block.get("bundle") or block.get("rows_dir", "")
    lines.append(f"source={label}")
    lines.append(f"row_count={block.get('row_count', 0)}")
    lines.append("")
    for row in block.get("rows", []):
        lines.append(f"[{row.get('file')}]")
        lines.append(f"  mode: {row.get('mode')}")
        pairs = row.get("six_pairs") or []
        lines.append(f"  six_pairs: {' '.join(pairs) if pairs else '-'}")
        for k in ("digits_full", "digits_merged", "digits_main_roi", "digits_pb_roi", "digits_pb_roi_narrow"):
            if k in row:
                v = row[k]
                lines.append(f"  {k}: {v!s}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def format_combined(results: dict[str, Any], *, engine: str) -> str:
    lines: list[str] = [
        f"# OCR batch summary ({engine})",
        "",
    ]
    bundles = results.get("bundles") or []
    for i, block in enumerate(bundles):
        lines.append(format_bundle_block(block, engine=engine).rstrip())
        if i < len(bundles) - 1:
            lines.append("")
            lines.append("---")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_txt(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
