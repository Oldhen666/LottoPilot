"""Unified row OCR result structure."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RowOcrResult:
    main_numbers: list[str]
    powerball: str
    raw_text: str
    confidence: float | None
    warnings: list[str]
    valid_structure: bool
    meta: dict[str, Any] = field(default_factory=dict)

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "main_numbers": self.main_numbers,
            "powerball": self.powerball,
            "raw_text": self.raw_text,
            "confidence": self.confidence,
            "warnings": self.warnings,
            "valid": self.valid_structure,
            "meta": self.meta,
        }
