#!/usr/bin/env python3
"""
Export a YOLOv8 row-detection checkpoint to TFLite for LottoPilot Android.

Usage (with ultralytics installed):
  pip install ultralytics
  python scripts/export_powerball_tflite.py --weights path/to/best.pt --out powerball_yolov8.tflite

Copy the output to:
  android/app/src/main/assets/models/powerball_yolov8.tflite

Class 0 should be the play row box; imgsz=640 matches the native letterbox in YoloTfliteModule.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--weights", required=True, help="Ultralytics .pt weights (e.g. best.pt)")
    p.add_argument("--out", default="powerball_yolov8.tflite", help="Output .tflite filename")
    args = p.parse_args()

    try:
        from ultralytics import YOLO
    except ImportError as e:
        raise SystemExit("Install ultralytics: pip install ultralytics") from e

    model = YOLO(args.weights)
    # int8=False keeps float32 I/O; easier to debug. Set int8=True + data=... for smaller models.
    exported_path = model.export(format="tflite", imgsz=640, nms=False, int8=False)
    exported = Path(exported_path)
    if not exported.is_file():
        raise SystemExit(f"Export failed: expected file at {exported_path}")
    dest = Path(args.out).resolve()
    shutil.copy2(exported, dest)
    print(f"Wrote {dest}")
    print("Copy to android/app/src/main/assets/models/powerball_yolov8.tflite")


if __name__ == "__main__":
    main()
