"""Lazy-loaded OCR engine instances."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class EngineContext:
    easyocr_reader: Any | None = None
    paddle_ocr: Any | None = None

    def ensure_easyocr(self) -> Any:
        if self.easyocr_reader is None:
            import easyocr

            self.easyocr_reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        return self.easyocr_reader

    def ensure_paddle(self) -> Any:
        if self.paddle_ocr is None:
            from paddle_row_reader import build_paddle_ocr

            self.paddle_ocr = build_paddle_ocr(use_gpu=False)
        return self.paddle_ocr
