"""Reproducible lottery row OCR evaluation harness."""

from .config_specs import CONFIG_REGISTRY, list_config_names
from .dataset import RowTruth, Sample, load_dataset

__all__ = [
    "CONFIG_REGISTRY",
    "list_config_names",
    "RowTruth",
    "Sample",
    "load_dataset",
]
