# Lottery row OCR evaluation harness

## Default locations (Windows)

Dataset and evaluation outputs live under your **Downloads** batch folder:

| 用途 | 路径 |
|------|------|
| 示例数据集 | `C:\Users\<用户名>\Downloads\lottopilot_test\Powerball\CA\batch\example_dataset` |
| 评估输出 | `C:\Users\<用户名>\Downloads\lottopilot_test\Powerball\CA\batch\test_outputs\run_<时间戳>\` |

Override the batch root with environment variable **`LOTTOPILOT_OCR_BATCH_ROOT`** (absolute path to `.../Powerball/CA/batch`).

## Dataset layout

```
example_dataset/
  sample_001/
    rows/
      row_00_clean.png
      ...
    truth.json
```

`truth.json`:

```json
{
  "rows": [
    { "main_numbers": ["35","44","48","50","59"], "powerball": "16" }
  ]
}
```

Rows align by index with sorted `row_*_clean.png`.

## Run

From repository root — **omit `--dataset` / `--out` to use defaults above**:

```bash
python tools/run_ocr_eval.py
python tools/run_ocr_eval.py --configs paddle_whole_row easyocr_whole_row
```

Explicit paths:

```bash
python tools/run_ocr_eval.py --dataset D:/data/dataset --out D:/out/run1
python tools/run_ocr_eval.py --no-failure-artifacts
```

## Named configurations

| Name | Engine | Strategy |
|------|--------|----------|
| `easyocr_whole_row` | EasyOCR | Full strip, 6×2 heuristic |
| `easyocr_split_regions` | EasyOCR | Main ROI + PB ROI |
| `easyocr_split_groups` | EasyOCR | Five equal columns + PB strip |
| `paddle_whole_row` | PaddleOCR | Same as whole_row |
| `paddle_split_regions` | PaddleOCR | Main + PB |
| `paddle_split_groups` | PaddleOCR | Five columns + PB |

## Output layout

Each run writes under `test_outputs/run_<timestamp>/` (unless `--out` is set):

```
  summary.txt
  summary.json
  per_row/
  failures/
```

## Metrics

See `metrics.py`: exact row, main groups, PB, digit-level, error categories.

Recommendation in `summary.json` is metrics-based.
