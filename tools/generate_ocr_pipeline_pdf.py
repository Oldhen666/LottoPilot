"""
One-off: generate OCR / segmentation pipeline overview PDF (Simplified Chinese).
Run: python tools/generate_ocr_pipeline_pdf.py
Output: docs/OCR流水线步骤与技术.pdf
"""
from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def _register_cn_font() -> str:
    candidates = [
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
    ]
    for p in candidates:
        if p.is_file():
            name = "CN"
            try:
                pdfmetrics.registerFont(TTFont(name, str(p)))
                return name
            except Exception:
                continue
    return "Helvetica"


def _p(text: str, style) -> Paragraph:
    return Paragraph(text.replace("\n", "<br/>"), style)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    out_dir = root / "docs"
    out_dir.mkdir(exist_ok=True)
    out_pdf = out_dir / "OCR流水线步骤与技术.pdf"

    font = _register_cn_font()
    styles = getSampleStyleSheet()
    normal = ParagraphStyle(
        "cn",
        parent=styles["Normal"],
        fontName=font,
        fontSize=10,
        leading=14,
        alignment=TA_JUSTIFY,
    )
    h1 = ParagraphStyle(
        "h1",
        parent=styles["Heading1"],
        fontName=font,
        fontSize=16,
        leading=20,
        spaceAfter=8,
    )
    h2 = ParagraphStyle(
        "h2",
        parent=styles["Heading2"],
        fontName=font,
        fontSize=12,
        leading=16,
        spaceBefore=10,
        spaceAfter=6,
    )
    bullet = ParagraphStyle(
        "bull",
        parent=normal,
        leftIndent=12,
        bulletIndent=6,
    )

    doc = SimpleDocTemplate(
        str(out_pdf),
        pagesize=A4,
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )
    story: list = []

    story.append(_p("<b>彩票票面 OCR 与分段 — 步骤与技术总览</b>", h1))
    story.append(
        _p(
            "本文档汇总 LottoPilot 移动端与本地批处理实验脚本中涉及的<strong>处理步骤</strong>与<strong>技术栈</strong>，"
            "便于对照代码与调参。生成日期以运行脚本时为准。",
            normal,
        )
    )
    story.append(Spacer(1, 0.4 * cm))

    # --- App ---
    story.append(_p("一、移动端应用（LottoPilot / React Native）", h2))
    for line in [
        "<b>运行环境：</b>React Native、Expo；OCR 在设备端执行（非 Web）。",
        "<b>核心 OCR：</b>Google ML Kit Text Recognition（<code>expo-mlkit-ocr</code>），返回文本块/行结构。",
        "<b>输入约束：</b>输入图最小边长不足时会放大以满足 ML Kit 要求（见 <code>ensureMlKitMinDimensions</code>）。",
        "<b>Powerball 分层流水线（<code>powerballOcr/pipeline.ts</code>）：</b>",
    ]:
        story.append(_p(line, normal))
        story.append(Spacer(1, 0.15 * cm))

    for item in [
        "Layer1 预处理（<code>layer1Preprocess.ts</code>）：JPEG/像素读入 → 灰度与水印淡化灰度 → 文档展平（flatten）→ 墨区裁边 → 页眉/页脚带抑制 → <b>轻度 CLAHE</b>（tile 网格对比度增强）→ 输出多路灰度变体 URI 供 OCR。",
        "快速全文 OCR + 模板族（<code>classifyPbTemplateFamily</code>）、锚点提示（<code>collectAnchorHintsFromText</code>）。",
        "多变体并行 ML Kit OCR，按解析评分选最优变体；可选详细结果（<code>recognizeTicketTextDetailed</code>）。",
        "布局解析（<code>layoutFullImageOcr</code>）：基于几何与 Y 聚类等的整图行级解析，与全文解析结果融合。",
        "可选诊断包：导出中间图与 <code>summary.json</code>（<code>diagnosticBundle</code> 等）。",
    ]:
        story.append(_p(f"• {item}", bullet))
        story.append(Spacer(1, 0.12 * cm))

    story.append(Spacer(1, 0.3 * cm))
    story.append(_p("二、通用 OCR 封装（<code>src/services/ocr.ts</code>）", h2))
    story.append(
        _p(
            "将 ML Kit 结果解析为结构化票面（主区号码、特别号等），含玩法参数（主号个数、上限、特别号范围等）与校验/评分逻辑。",
            normal,
        )
    )
    story.append(Spacer(1, 0.3 * cm))

    # --- Batch ---
    story.append(_p("三、本地批处理（<code>lottopilot_test/.../batch</code>，Python + OpenCV）", h2))
    story.append(
        _p(
            "用于从已纠偏票图导出 <b>row_sign</b> 横条、<b>4× 放大</b>与<b>按行裁切</b>，供离线 EasyOCR / PaddleOCR 实验。",
            normal,
        )
    )
    story.append(Spacer(1, 0.2 * cm))

    batch_rows = [
        ["脚本 / 模块", "步骤与技术要点"],
        [
            "<code>row_sign_export.py</code>",
            "左侧行标 A–E：优先 <b>PaddleOCR</b>（可选依赖）；未安装时用 <b>连通域 CC</b> 在左条带内找墨点作锚点；"
            "按行锚与 play 带建树状横条 → <code>row_sign.png</code>；"
            "<b>双三次插值 4×</b> → <code>row_sign_4x.png</code>；"
            "4× 后调用 <code>ink_enhance.enhance_bgr_ink_for_ocr</code>。",
        ],
        [
            "<code>ink_enhance.py</code>",
            "<b>LAB</b> 色彩空间对 <b>L 通道 CLAHE</b>；对偏暗笔画做轻度压暗（非二值化），保留灰度抗锯齿供后续 Otsu。",
        ],
        [
            "<code>row_sign_4x_segment.py</code>",
            "整图 <b>Otsu 二值</b> + 平滑 <b>水平投影</b> 找墨带；<b>EXPECTED_PLAY_ROWS=5</b> 归一化行带；"
            "行边冗余修剪、接缝像素微调、墨区收紧、可选行带重叠（<code>ROW_CONTEXT_TARGET_HEIGHT_PX</code>）；"
            "首行二次加高；行内 <b>垂直投影</b> 分栏/宽块再切双位；"
            "可选 <b>裁行后按投影收紧主墨线</b>（削弱顶缘杂墨）；"
            "灰度行图 <b>resize</b> 至最小高度 <code>MIN_ROW_HEIGHT_OCR</code> 输出 <code>row_XX_clean.png</code>；"
            "<code>summary.json</code> 记录参数与坐标。",
        ],
    ]
    t = Table(batch_rows, colWidths=[4.2 * cm, 12.3 * cm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                ("FONTNAME", (0, 0), (-1, -1), font),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 0.35 * cm))

    story.append(_p("四、实验用 Python OCR 脚本（LottoPilot <code>tools/</code>）", h2))
    for item in [
        "<code>ocr_easyocr_row_assets.py</code>：<b>EasyOCR</b>（PyTorch），数字白名单，批量读 <code>row_*_clean</code>。",
        "<code>ocr_row_six_digits.py</code>：整行 12 位切 6 组两位数；不足时主区/ Powerball 窄条二次识别合并。",
        "<code>generate_ocr_pipeline_pdf.py</code>：本 PDF 生成器（ReportLab）。",
    ]:
        story.append(_p(f"• {item}", bullet))
        story.append(Spacer(1, 0.12 * cm))

    story.append(Spacer(1, 0.25 * cm))
    story.append(_p("五、PaddleOCR（可选，本机实验）", h2))
    story.append(
        _p(
            "若已安装 <b>PaddlePaddle</b> + <b>PaddleOCR</b>（新版多为 <b>PaddleX + PP-OCRv5</b> 管线），"
            "对细长条图建议关闭文档方向/矫正（<code>use_doc_orientation_classify=False</code> 等），避免整图被误旋转。"
            "部分环境因 Windows 路径长度限制需将包装在短路径（如 <code>C:\\pp2</code>）并设置 <code>PYTHONPATH</code>。",
            normal,
        )
    )
    story.append(Spacer(1, 0.25 * cm))

    story.append(_p("六、主要第三方库一览", h2))
    lib_data = [
        ["领域", "技术 / 库"],
        ["移动端", "React Native, Expo, expo-mlkit-ocr"],
        ["批处理图像", "Python 3, OpenCV (cv2), NumPy"],
        ["实验 OCR", "EasyOCR (torch), PaddleOCR / PaddlePaddle（可选）"],
        ["PDF 生成", "ReportLab"],
    ]
    t2 = Table(lib_data, colWidths=[4 * cm, 12.5 * cm])
    t2.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                ("FONTNAME", (0, 0), (-1, -1), font),
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    story.append(t2)

    doc.build(story)
    print("Wrote", out_pdf)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
