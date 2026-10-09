"""Named evaluation configurations (engine + parsing strategy)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Engine = Literal["paddle", "easyocr"]
Strategy = Literal["whole_row", "split_regions", "split_groups"]


@dataclass(frozen=True)
class EvalConfig:
    name: str
    engine: Engine
    strategy: Strategy


# Ablation matrix: engine × strategy
def _build_registry() -> dict[str, EvalConfig]:
    out: dict[str, EvalConfig] = {}
    for eng in ("paddle", "easyocr"):
        for strat in ("whole_row", "split_regions", "split_groups"):
            name = f"{eng}_{strat}"
            out[name] = EvalConfig(name=name, engine=eng, strategy=strat)  # type: ignore[arg-type]
    return out


CONFIG_REGISTRY: dict[str, EvalConfig] = _build_registry()


def list_config_names() -> list[str]:
    return sorted(CONFIG_REGISTRY.keys())
