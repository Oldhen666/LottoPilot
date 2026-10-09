"""Dispatch named config to engine + strategy."""

from __future__ import annotations

import numpy as np

from .config_specs import CONFIG_REGISTRY, EvalConfig
from .engines import EngineContext
from .row_result import RowOcrResult
from .strategies import (
    run_easy_split_groups,
    run_easy_split_regions,
    run_easy_whole_row,
    run_paddle_split_groups,
    run_paddle_split_regions,
    run_paddle_whole_row,
)


def run_row_with_config(ctx: EngineContext, gray: np.ndarray, config_name: str) -> RowOcrResult:
    cfg: EvalConfig = CONFIG_REGISTRY[config_name]
    if cfg.engine == "easyocr":
        r = ctx.ensure_easyocr()
        if cfg.strategy == "whole_row":
            return run_easy_whole_row(r, gray)
        if cfg.strategy == "split_regions":
            return run_easy_split_regions(r, gray)
        return run_easy_split_groups(r, gray)
    ocr = ctx.ensure_paddle()
    if cfg.strategy == "whole_row":
        return run_paddle_whole_row(ocr, gray)
    if cfg.strategy == "split_regions":
        return run_paddle_split_regions(ocr, gray)
    return run_paddle_split_groups(ocr, gray)
