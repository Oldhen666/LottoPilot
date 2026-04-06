/**
 * Per-scan debug bundle: images + summary JSON on device (Powerball layered path only).
 * Does not change OCR behavior — writes artifacts for failure analysis.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { copyAsync, documentDirectory, makeDirectoryAsync, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { deleteUriIfLocal, writeGrayAsJpegUri } from '../ticketPreprocess/codec';
import { drawHorizontalGuideLines, drawRectanglesOutline, extractGrayBand } from '../ticketPreprocess/pixelOps';
import {
  computeMainCellCropRect,
  computeNominalMainCellCropRect,
  computePbCellCropRect,
} from './cellCrop';
import type { ParsedTicket } from '../ocr';
import { scoreMainCellOcr, scorePbCellOcr } from './cellOcrScore';
import { PB_MAIN_COUNT, PB_MAX_PLAY_ROWS, PB_SPLIT_VARIANTS } from './constants';
import { listRefinedRowSpansForLayer4 } from './rowRefinement';
import { computeLayer4PlayGrid } from './layer4Split';
import { segmentMainColumnXEdgesForRow } from './rowDigitSegmentation';
import type { PowerballLayer1 } from './layer1Preprocess';
import { recognizeTicketTextDetailed } from './mlkitRecognize';
import type { PbAnchorHints, PbTemplateFamily, RowParseCandidate } from './types';

export type TicketScanDiagnosticResult = {
  folderUri: string;
  summary: Record<string, unknown>;
};

async function cropRegionToPngFile(
  sourceUri: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
  destPath: string,
): Promise<void> {
  if (w < 4 || h < 4) return;
  const r = await ImageManipulator.manipulateAsync(
    sourceUri,
    [{ crop: { originX: x0, originY: y0, width: w, height: h } }],
    { compress: 1, format: ImageManipulator.SaveFormat.PNG },
  );
  await copyAsync({ from: r.uri, to: destPath });
  await deleteUriIfLocal(r.uri);
}

function chosenVariantIndexForCell(
  texts: string[],
  kind: 'main' | 'pb',
): { chosenIndex: number; scores: number[] } {
  const scores = texts.map((t, i) => (kind === 'main' ? scoreMainCellOcr(t) : scorePbCellOcr(t)));
  let best = 0;
  let bestSc = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const sc = scores[i]!;
    const txt = texts[i] ?? '';
    const prev = texts[best] ?? '';
    if (sc > bestSc || (sc === bestSc && txt.length < prev.length)) {
      bestSc = sc;
      best = i;
    }
  }
  return { chosenIndex: best, scores };
}

/**
 * Writes `scan_debug/scan_<ts>/` under documentDirectory with images + summary.json.
 */
export async function writePowerballScanDiagnosticBundle(params: {
  originalImageUri: string;
  layer1: PowerballLayer1;
  family: PbTemplateFamily;
  hints: PbAnchorHints;
  layer4RowsAll: RowParseCandidate[];
  finalParsed: ParsedTicket | null;
  parseSource: 'layered_split' | 'full_image_fallback' | 'none';
}): Promise<TicketScanDiagnosticResult | null> {
  if (Platform.OS === 'web' || !documentDirectory) return null;
  const snap = params.layer1.diagnosticSnapshots;
  if (!snap) {
    return null;
  }

  const ts = Date.now();
  const folderUri = `${documentDirectory}scan_debug/scan_${ts}/`;
  await makeDirectoryAsync(folderUri, { intermediates: true });

  const rel = (name: string) => `${folderUri}${name}`;

  try {
    await copyAsync({ from: params.originalImageUri, to: rel('00_original.jpg') });
  } catch {
    await writeAsStringAsync(rel('00_original_copy_failed.txt'), params.originalImageUri, {
      encoding: EncodingType.UTF8,
    });
  }

  await writeGrayAsJpegUri(snap.afterFlatten.gray, snap.afterFlatten.width, snap.afterFlatten.height, 88).then(
    async (u) => {
      await copyAsync({ from: u, to: rel('01_perspective_corrected.jpg') });
      await deleteUriIfLocal(u);
    },
  );

  const norm = snap.normalizedForRegions;
  await writeGrayAsJpegUri(norm.gray, norm.width, norm.height, 88).then(async (u) => {
    await copyAsync({ from: u, to: rel('02_normalized_for_regions.jpg') });
    await deleteUriIfLocal(u);
  });

  const grid = computeLayer4PlayGrid(
    params.layer1.gray,
    params.layer1.width,
    params.layer1.height,
    params.family,
    params.hints,
  );
  if (grid) {
    const overlay = drawHorizontalGuideLines(
      norm.gray,
      norm.width,
      norm.height,
      grid.rowEdges,
      2,
    );
    await writeGrayAsJpegUri(overlay, norm.width, norm.height, 88).then(async (u) => {
      await copyAsync({ from: u, to: rel('03_row_bands_overlay.jpg') });
      await deleteUriIfLocal(u);
    });

    const refinedSpans = listRefinedRowSpansForLayer4(
      params.layer1.gray,
      params.layer1.width,
      params.layer1.height,
      grid.rowEdges,
      grid.nRows,
      grid.mx0,
      grid.mx1,
      grid.px0,
      grid.px1,
      PB_MAX_PLAY_ROWS,
    );
    const boxRects: { x0: number; y0: number; x1: number; y1: number }[] = [];
    for (let ri = 0; ri < refinedSpans.length; ri++) {
      const yA = refinedSpans[ri]!.y0;
      const yB = refinedSpans[ri]!.y1;
      if (yB - yA < 10) continue;
      const rowH = yB - yA;
      const rowStrip = extractGrayBand(params.layer1.gray, norm.width, norm.height, yA, yB);
      if (rowStrip.length !== norm.width * rowH) continue;
      const rowSeg = segmentMainColumnXEdgesForRow(rowStrip, norm.width, rowH, grid.mx0, grid.mx1, 0, rowH);
      const xEdgesRow = rowSeg.edges;
      for (let c = 0; c < PB_MAIN_COUNT; c++) {
        const cx0 = Math.floor(xEdgesRow[c]!);
        const cx1 = Math.floor(xEdgesRow[c + 1]!);
        const cr = computeMainCellCropRect(
          rowStrip,
          norm.width,
          rowH,
          cx0,
          cx1,
          0,
          rowH,
          grid.mx0,
          grid.mx1,
        );
        boxRects.push({
          x0: cr.x0,
          y0: cr.y0 + yA,
          x1: cr.x0 + cr.width,
          y1: cr.y0 + cr.height + yA,
        });
      }
      const pbc = computePbCellCropRect(rowStrip, norm.width, rowH, grid.px0, grid.px1, 0, rowH);
      boxRects.push({
        x0: pbc.x0,
        y0: pbc.y0 + yA,
        x1: pbc.x0 + pbc.width,
        y1: pbc.y0 + pbc.height + yA,
      });
    }
    const boxOverlay = drawRectanglesOutline(norm.gray, norm.width, norm.height, boxRects, 2);
    await writeGrayAsJpegUri(boxOverlay, norm.width, norm.height, 88).then(async (u) => {
      await copyAsync({ from: u, to: rel('04_cell_boxes_overlay.jpg') });
      await deleteUriIfLocal(u);
    });
  }

  const splitN = Math.min(PB_SPLIT_VARIANTS, params.layer1.variantUris.length);
  const variantLabels = params.layer1.labels;

  const cellsJson: Record<string, unknown>[] = [];

  if (grid && splitN > 0) {
    const { mx0, mx1, px0, px1 } = grid;

    const refinedSpans = listRefinedRowSpansForLayer4(
      params.layer1.gray,
      params.layer1.width,
      params.layer1.height,
      grid.rowEdges,
      grid.nRows,
      grid.mx0,
      grid.mx1,
      grid.px0,
      grid.px1,
      PB_MAX_PLAY_ROWS,
    );

    await makeDirectoryAsync(`${folderUri}cell_compare`, { intermediates: true });

    for (let ri = 0; ri < refinedSpans.length; ri++) {
      const yA = refinedSpans[ri]!.y0;
      const yB = refinedSpans[ri]!.y1;
      if (yB - yA < 10) continue;
      const row1 = ri + 1;
      const rowH = yB - yA;
      const rowStrip = extractGrayBand(params.layer1.gray, params.layer1.width, params.layer1.height, yA, yB);
      if (rowStrip.length !== params.layer1.width * rowH) continue;
      const rowSeg = segmentMainColumnXEdgesForRow(rowStrip, params.layer1.width, rowH, mx0, mx1, 0, rowH);
      const xEdges = rowSeg.edges;

      for (let c = 0; c < PB_MAIN_COUNT; c++) {
        const cx0 = Math.floor(xEdges[c]!);
        const cx1 = Math.floor(xEdges[c + 1]!);
        const padded = computeMainCellCropRect(
          rowStrip,
          params.layer1.width,
          rowH,
          cx0,
          cx1,
          0,
          rowH,
          mx0,
          mx1,
        );
        const ocrTexts: string[] = [];
        const confidences: (number | null)[] = [];
        const variantDetails: Record<string, unknown>[] = [];

        for (let vi = 0; vi < splitN; vi++) {
          const uri = params.layer1.variantUris[vi]!;
          const label = variantLabels[vi] ?? `variant_${vi}`;
          const fileName = `row_${row1}_cell_${c + 1}_variant_${vi}.png`;
          const outPath = rel(fileName);
          try {
            if (ri === 0 && vi === 0) {
              const nom = computeNominalMainCellCropRect(cx0, cx1, 0, rowH, params.layer1.width, rowH, mx0, mx1);
              await cropRegionToPngFile(uri, nom.x0, nom.y0 + yA, nom.width, nom.height, rel(`cell_compare/row1_cell_${c + 1}_nominal_v0.png`));
              await cropRegionToPngFile(uri, padded.x0, padded.y0 + yA, padded.width, padded.height, rel(`cell_compare/row1_cell_${c + 1}_padded_v0.png`));
            }
            await cropRegionToPngFile(uri, padded.x0, padded.y0 + yA, padded.width, padded.height, outPath);
            const det = await recognizeTicketTextDetailed(outPath);
            ocrTexts.push((det.text ?? '').trim());
            confidences.push(det.confidence);
            variantDetails.push({
              variantIndex: vi,
              variantLabel: label,
              rawText: (det.text ?? '').trim(),
              confidence: det.confidence,
              mlKitPayloadHadConfidenceField: det.confidence != null,
            });
          } catch {
            ocrTexts.push('');
            confidences.push(null);
            variantDetails.push({ variantIndex: vi, variantLabel: label, rawText: '', confidence: null });
          }
        }

        const { chosenIndex, scores } = chosenVariantIndexForCell(ocrTexts, 'main');
        cellsJson.push({
          rowIndex: row1,
          cellIndex: c + 1,
          kind: 'main',
          columnSegmentMethod: rowSeg.meta.method,
          cropRectPadded: { x0: padded.x0, y0: padded.y0 + yA, width: padded.width, height: padded.height },
          cropCompareRow1:
            row1 === 1
              ? {
                  nominalFile: `cell_compare/row1_cell_${c + 1}_nominal_v0.png`,
                  paddedFile: `cell_compare/row1_cell_${c + 1}_padded_v0.png`,
                }
              : undefined,
          cropFiles: Array.from({ length: splitN }, (_, vi) => `row_${row1}_cell_${c + 1}_variant_${vi}.png`),
          variantOcr: variantDetails,
          chosenVariantIndex: chosenIndex,
          chosenVariantLabel: variantLabels[chosenIndex] ?? null,
          heuristicScores: scores,
          ocrConfidencesPerVariant: confidences,
        });
      }

      const pbPadded = computePbCellCropRect(rowStrip, params.layer1.width, rowH, px0, px1, 0, rowH);
      const ocrPb: string[] = [];
      const confPb: (number | null)[] = [];
      const variantDetailsPb: Record<string, unknown>[] = [];

      for (let vi = 0; vi < splitN; vi++) {
        const uri = params.layer1.variantUris[vi]!;
        const label = variantLabels[vi] ?? `variant_${vi}`;
        const fileName = `row_${row1}_powerball_variant_${vi}.png`;
        const outPath = rel(fileName);
        try {
          if (row1 === 1 && vi === 0) {
            const nomPb = computeNominalMainCellCropRect(px0, px1, 0, rowH, params.layer1.width, rowH, px0, px1);
            await cropRegionToPngFile(uri, nomPb.x0, nomPb.y0 + yA, nomPb.width, nomPb.height, rel(`cell_compare/row1_powerball_nominal_v0.png`));
            await cropRegionToPngFile(uri, pbPadded.x0, pbPadded.y0 + yA, pbPadded.width, pbPadded.height, rel(`cell_compare/row1_powerball_padded_v0.png`));
          }
          await cropRegionToPngFile(uri, pbPadded.x0, pbPadded.y0 + yA, pbPadded.width, pbPadded.height, outPath);
          const det = await recognizeTicketTextDetailed(outPath);
          ocrPb.push((det.text ?? '').trim());
          confPb.push(det.confidence);
          variantDetailsPb.push({
            variantIndex: vi,
            variantLabel: label,
            rawText: (det.text ?? '').trim(),
            confidence: det.confidence,
          });
        } catch {
          ocrPb.push('');
          confPb.push(null);
          variantDetailsPb.push({ variantIndex: vi, variantLabel: label, rawText: '', confidence: null });
        }
      }

      const pbPick = chosenVariantIndexForCell(ocrPb, 'pb');
      cellsJson.push({
        rowIndex: row1,
        cellIndex: 'powerball',
        kind: 'powerball',
        cropRectPadded: { x0: pbPadded.x0, y0: pbPadded.y0 + yA, width: pbPadded.width, height: pbPadded.height },
        cropCompareRow1:
          row1 === 1
            ? { nominalFile: 'cell_compare/row1_powerball_nominal_v0.png', paddedFile: 'cell_compare/row1_powerball_padded_v0.png' }
            : undefined,
        cropFiles: Array.from({ length: splitN }, (_, vi) => `row_${row1}_powerball_variant_${vi}.png`),
        variantOcr: variantDetailsPb,
        chosenVariantIndex: pbPick.chosenIndex,
        chosenVariantLabel: variantLabels[pbPick.chosenIndex] ?? null,
        heuristicScores: pbPick.scores,
        ocrConfidencesPerVariant: confPb,
      });
    }
  }

  const mergedPerRow = params.layer4RowsAll.map((row, idx) => ({
    rowIndex: idx + 1,
    parsedMain: row.main,
    parsedSpecial: row.special,
    score: row.score,
  }));

  const summary: Record<string, unknown> = {
    version: 1,
    timestamp: new Date(ts).toISOString(),
    platform: Platform.OS,
    flattenMode: snap.afterFlatten.flattenMode,
    parseSource: params.parseSource,
    detectedRows: grid
      ? {
          rowEdgesY: grid.rowEdges,
          nRows: grid.nRows,
          mainColumnSegmentsPerRow: Array.from({ length: grid.nRows }, (_, r) => {
            const yA = grid.rowEdges[r]!;
            const yB = grid.rowEdges[r + 1]!;
            if (yB - yA < 10) return null;
            const rowH = yB - yA;
            const rowStrip = extractGrayBand(params.layer1.gray, params.layer1.width, params.layer1.height, yA, yB);
            if (rowStrip.length !== params.layer1.width * rowH) return null;
            const seg = segmentMainColumnXEdgesForRow(rowStrip, params.layer1.width, rowH, grid.mx0, grid.mx1, 0, rowH);
            return { edges: seg.edges, method: seg.meta.method };
          }),
          playRect: {
            mx0: grid.mx0,
            mx1: grid.mx1,
            px0: grid.px0,
            px1: grid.px1,
            ry0: grid.ry0,
            ry1: grid.ry1,
          },
        }
      : null,
    variantLabels,
    cells: cellsJson,
    layer4RowCandidates: params.layer4RowsAll.map((r) => ({
      main: r.main,
      special: r.special,
      score: r.score,
    })),
    mergedPerRow,
    finalParsed: params.finalParsed
      ? {
          mainNumbers: params.finalParsed.mainNumbers,
          allSets: params.finalParsed.allSets,
          specialsPerLine: params.finalParsed.specialsPerLine,
          confidence: params.finalParsed.confidence,
          drawDate: params.finalParsed.drawDate,
        }
      : null,
    notes: {
      ocrConfidence:
        'Per-cell confidence is best-effort from expo-mlkit-ocr native payload; null means not exposed on this build.',
      exportHint:
        'This path is app-private (not listed in Files / 下载). Use the Check screen button "Share diagnostic ZIP" to save to Downloads or another app.',
      cellCrop:
        'Main columns: per-row valley / connected-components / equal-ink segmentation (see summary mainColumnSegmentsPerRow). Crops use ink + padding; 04_cell_boxes_overlay.jpg uses per-row edges.',
    },
  };

  await writeAsStringAsync(rel('summary.json'), JSON.stringify(summary, null, 2), {
    encoding: EncodingType.UTF8,
  });

  return { folderUri, summary };
}

/**
 * When the layered pipeline throws before `writePowerballScanDiagnosticBundle` completes, still write
 * 00–02 JPEGs (+ 03/04 if family/hints exist) and summary.json so the user can pack a ZIP.
 */
export async function writePowerballScanDiagnosticBundleMinimal(params: {
  originalImageUri: string;
  layer1: PowerballLayer1;
  error: unknown;
  family?: PbTemplateFamily;
  hints?: PbAnchorHints;
}): Promise<TicketScanDiagnosticResult | null> {
  if (Platform.OS === 'web' || !documentDirectory) return null;
  const snap = params.layer1.diagnosticSnapshots;
  if (!snap) return null;

  const ts = Date.now();
  const folderUri = `${documentDirectory}scan_debug/scan_${ts}/`;
  await makeDirectoryAsync(folderUri, { intermediates: true });
  const rel = (name: string) => `${folderUri}${name}`;

  try {
    await copyAsync({ from: params.originalImageUri, to: rel('00_original.jpg') });
  } catch {
    await writeAsStringAsync(rel('00_original_copy_failed.txt'), params.originalImageUri, {
      encoding: EncodingType.UTF8,
    });
  }

  await writeGrayAsJpegUri(snap.afterFlatten.gray, snap.afterFlatten.width, snap.afterFlatten.height, 88).then(
    async (u) => {
      await copyAsync({ from: u, to: rel('01_perspective_corrected.jpg') });
      await deleteUriIfLocal(u);
    },
  );

  const norm = snap.normalizedForRegions;
  await writeGrayAsJpegUri(norm.gray, norm.width, norm.height, 88).then(async (u) => {
    await copyAsync({ from: u, to: rel('02_normalized_for_regions.jpg') });
    await deleteUriIfLocal(u);
  });

  let grid: ReturnType<typeof computeLayer4PlayGrid> = null;
  if (params.family != null && params.hints != null) {
    grid = computeLayer4PlayGrid(
      params.layer1.gray,
      params.layer1.width,
      params.layer1.height,
      params.family,
      params.hints,
    );
    if (grid) {
      const overlay = drawHorizontalGuideLines(norm.gray, norm.width, norm.height, grid.rowEdges, 2);
      await writeGrayAsJpegUri(overlay, norm.width, norm.height, 88).then(async (u) => {
        await copyAsync({ from: u, to: rel('03_row_bands_overlay.jpg') });
        await deleteUriIfLocal(u);
      });

      const refinedSpansMin = listRefinedRowSpansForLayer4(
        params.layer1.gray,
        params.layer1.width,
        params.layer1.height,
        grid.rowEdges,
        grid.nRows,
        grid.mx0,
        grid.mx1,
        grid.px0,
        grid.px1,
        PB_MAX_PLAY_ROWS,
      );
      const boxRects: { x0: number; y0: number; x1: number; y1: number }[] = [];
      for (let ri = 0; ri < refinedSpansMin.length; ri++) {
        const yA = refinedSpansMin[ri]!.y0;
        const yB = refinedSpansMin[ri]!.y1;
        if (yB - yA < 10) continue;
        const rowH = yB - yA;
        const rowStrip = extractGrayBand(params.layer1.gray, norm.width, norm.height, yA, yB);
        if (rowStrip.length !== norm.width * rowH) continue;
        const rowSeg = segmentMainColumnXEdgesForRow(rowStrip, norm.width, rowH, grid.mx0, grid.mx1, 0, rowH);
        const xEdgesRow = rowSeg.edges;
        for (let c = 0; c < PB_MAIN_COUNT; c++) {
          const cx0 = Math.floor(xEdgesRow[c]!);
          const cx1 = Math.floor(xEdgesRow[c + 1]!);
          const cr = computeMainCellCropRect(
            rowStrip,
            norm.width,
            rowH,
            cx0,
            cx1,
            0,
            rowH,
            grid.mx0,
            grid.mx1,
          );
          boxRects.push({
            x0: cr.x0,
            y0: cr.y0 + yA,
            x1: cr.x0 + cr.width,
            y1: cr.y0 + cr.height + yA,
          });
        }
        const pbc = computePbCellCropRect(rowStrip, norm.width, rowH, grid.px0, grid.px1, 0, rowH);
        boxRects.push({
          x0: pbc.x0,
          y0: pbc.y0 + yA,
          x1: pbc.x0 + pbc.width,
          y1: pbc.y0 + pbc.height + yA,
        });
      }
      const boxOverlay = drawRectanglesOutline(norm.gray, norm.width, norm.height, boxRects, 2);
      await writeGrayAsJpegUri(boxOverlay, norm.width, norm.height, 88).then(async (u) => {
        await copyAsync({ from: u, to: rel('04_cell_boxes_overlay.jpg') });
        await deleteUriIfLocal(u);
      });
    }
  }

  const summary: Record<string, unknown> = {
    ok: false,
    reason: 'pipeline_error',
    message: params.error instanceof Error ? params.error.message : String(params.error),
    version: 1,
    timestamp: new Date(ts).toISOString(),
    platform: Platform.OS,
    flattenMode: snap.afterFlatten.flattenMode,
    hadFamilyHints: params.family != null && params.hints != null,
    detectedRows: grid
      ? {
          rowEdgesY: grid.rowEdges,
          nRows: grid.nRows,
          playRect: {
            mx0: grid.mx0,
            mx1: grid.mx1,
            px0: grid.px0,
            px1: grid.px1,
            ry0: grid.ry0,
            ry1: grid.ry1,
          },
        }
      : null,
    notes:
      '最小诊断包：完整 pipeline 在写入 per-cell PNG / 全量 summary 前失败；仍含 00–02 与（若可能）03–04。',
  };

  await writeAsStringAsync(rel('summary.json'), JSON.stringify(summary, null, 2), {
    encoding: EncodingType.UTF8,
  });

  return { folderUri, summary };
}
