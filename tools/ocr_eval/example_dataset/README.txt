示例数据集已迁移到本机 batch 目录（与 OCR 评估默认路径一致）：

  C:\Users\xiang\Downloads\lottopilot_test\Powerball\CA\batch\example_dataset

在仓库中运行评估（使用默认路径）：

  python tools/run_ocr_eval.py

或通过环境变量覆盖根目录：

  set LOTTOPILOT_OCR_BATCH_ROOT=D:\path\to\Powerball\CA\batch
  python tools/run_ocr_eval.py
