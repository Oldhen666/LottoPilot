/**
 * Layer 4: anchor-based crops + per-cell OCR + voting (layout first, OCR second).
 * Each play row uses a tight horizontal gray strip only — segmentation and crops never
 * read pixels from adjacent rows (no cross-row cell mixing).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { extractGrayBand } from '../ticketPreprocess/pixelOps';
import { deleteUriIfLocal } from '../ticketPreprocess/codec';
import { layoutZonesForFamily } from './anchors';
import {
  PB_MAIN_COUNT,
  PB_MAIN_MAX,
  PB_MAX_PLAY_ROWS,
  PB_SPECIAL_MAX,
  PB_SPECIAL_MIN,
  PB_SPLIT_VARIANTS,
} from './constants';
import { listRefinedRowSpansForLayer4 } from './rowRefinement';
import { scoreMainCellOcr, scorePbCellOcr } from './cellOcrScore';
import { estimateRowBandEdges } from './rowGeometry';
import { expandMainZoneHorizontally, segmentMainColumnXEdgesForRow } from './rowDigitSegmentation';
import { recognizeTicketText } from './mlkitRecognize';
import type { PbAnchorHints, PbTemplateFamily, RowParseCandidate } from './types';
import { parsePowerballRowWithFamily } from './usParseLine';
import {
  computeMainCellCropRect,
  computeMainCellRetryCropRect,
  computePbCellCropRect,
  shouldRetryMainCellOcr,
} from './cellCrop';

function scoreRow(main: number[], special: number | null): number {
  let s = 0;
  const validMain = main.filter((n) => n >= 1 && n <= PB_MAIN_MAX);
  s += validMain.length * 12;
  if (validMain.length === PB_MAIN_COUNT) s += 40;
  if (special != null && special >= PB_SPECIAL_MIN && special <= PB_SPECIAL_MAX) s += 35;
  if (new Set(validMain).size !== validMain.length) s -= 80;
  return s;
}

/** Full valid play line: 5 distinct mains in range + one Powerball in range. */
function isValidParsedPowerballRow(main: number[], special: number | null): boolean {
  if (main.length !== PB_MAIN_COUNT) return false;
  if (new Set(main).size !== PB_MAIN_COUNT) return false;
  for (const n of main) {
    if (!Number.isFinite(n) || n < 1 || n > PB_MAIN_MAX) return false;
  }
  if (special == null || !Number.isFinite(special) || special < PB_SPECIAL_MIN || special > PB_SPECIAL_MAX) {
    return false;
  }
  return true;
}

/** Exported for scan diagnostic bundle (same crop as split OCR). */
export async function cropTicketRegionForOcr(
  sourceUri: string,
  x0: number,
  y0: number,
  w: number,
  h: number,
): Promise<string | null> {
  if (w < 6 || h < 6) return null;
  try {
    const r = await ImageManipulator.manipulateAsync(
      sourceUri,
      [{ crop: { originX: x0, originY: y0, width: w, height: h } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
    );
    return r.uri;
  } catch {
    return null;
  }
}

export type Layer4Result = {
  rows: RowParseCandidate[];
};

/** Row geometry for diagnostics (no global main xEdges — use per-row segmentation). */
export type Layer4PlayGrid = {
  mx0: number;
  mx1: number;
  px0: number;
  px1: number;
  ry0: number;
  ry1: number;
  rowEdges: number[];
  nRows: number;
};

export function computeLayer4PlayGrid(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  family: PbTemplateFamily,
  hints: PbAnchorHints,
): Layer4PlayGrid | null {
  const { mainZone, pbZone, rowZone } = layoutZonesForFamily(family, hints);
  const mx0 = Math.floor(mainZone.x0 * width);
  const mx1 = Math.floor(mainZone.x1 * width);
  const px0 = Math.floor(pbZone.x0 * width);
  const px1 = Math.floor(pbZone.x1 * width);
  const ry0 = Math.floor(rowZone.y0 * height);
  const ry1 = Math.floor(rowZone.y1 * height);
  const rowEdges = estimateRowBandEdges(gray, width, height, mx0, mx1, ry0, ry1, PB_MAX_PLAY_ROWS);
  if (rowEdges.length < 2) return null;
  const nRows = Math.min(PB_MAX_PLAY_ROWS, rowEdges.length - 1);
  return { mx0, mx1, px0, px1, ry0, ry1, rowEdges, nRows };
}

/**
 * OCR one play line. `rowStrip` is only rows [yGlobal, yGlobal+rowH) — all geometry is local y in [0,rowH);
 * absolute crop uses yGlobal for the variant image.
 */
async function runCellMatrixForRow(
  rowStrip: Uint8ClampedArray,
  fullWidth: number,
  rowH: number,
  yGlobal: number,
  xEdges: number[],
  zoneMx0: number,
  zoneMx1: number,
  px0: number,
  px1: number,
  variantUris: string[],
  splitN: number,
  family: PbTemplateFamily,
): Promise<RowParseCandidate> {
  const cellMatrix: string[][] = [];
  for (let vi = 0; vi < splitN; vi++) {
    const uri = variantUris[vi]!;
    const parts: string[] = [];
    for (let c = 0; c < PB_MAIN_COUNT; c++) {
      const cx0 = Math.floor(xEdges[c]!);
      const cx1 = Math.floor(xEdges[c + 1]!);
      const crop = computeMainCellCropRect(
        rowStrip,
        fullWidth,
        rowH,
        cx0,
        cx1,
        0,
        rowH,
        zoneMx0,
        zoneMx1,
      );
      let u = await cropTicketRegionForOcr(uri, crop.x0, crop.y0 + yGlobal, crop.width, crop.height);
      let cellText = '';
      if (u) {
        try {
          const o = await recognizeTicketText(u);
          cellText = (o.text ?? '').trim();
          if (shouldRetryMainCellOcr(cellText)) {
            const retry = computeMainCellRetryCropRect(
              rowStrip,
              fullWidth,
              rowH,
              cx0,
              cx1,
              0,
              rowH,
              zoneMx0,
              zoneMx1,
            );
            const u2 = await cropTicketRegionForOcr(uri, retry.x0, retry.y0 + yGlobal, retry.width, retry.height);
            if (u2) {
              try {
                const o2 = await recognizeTicketText(u2);
                const t2 = (o2.text ?? '').trim();
                if (scoreMainCellOcr(t2) > scoreMainCellOcr(cellText)) {
                  cellText = t2;
                }
              } finally {
                await deleteUriIfLocal(u2);
              }
            }
          }
          parts.push(cellText);
        } finally {
          await deleteUriIfLocal(u);
        }
      } else {
        parts.push('');
      }
    }
    const pbCrop = computePbCellCropRect(rowStrip, fullWidth, rowH, px0, px1, 0, rowH);
    const pu = await cropTicketRegionForOcr(uri, pbCrop.x0, pbCrop.y0 + yGlobal, pbCrop.width, pbCrop.height);
    if (pu) {
      try {
        const o = await recognizeTicketText(pu);
        parts.push((o.text ?? '').trim());
      } finally {
        await deleteUriIfLocal(pu);
      }
    } else {
      parts.push('');
    }
    cellMatrix.push(parts);
  }

  const mergedMains: string[] = [];
  for (let c = 0; c < PB_MAIN_COUNT; c++) {
    let best = '';
    let bestSc = -Infinity;
    for (let vi = 0; vi < splitN; vi++) {
      const txt = cellMatrix[vi]![c] ?? '';
      const sc = scoreMainCellOcr(txt);
      if (sc > bestSc || (sc === bestSc && txt.length < best.length)) {
        bestSc = sc;
        best = txt;
      }
    }
    mergedMains.push(best);
  }
  let mergedPb = '';
  let mergedPbSc = -Infinity;
  const pbIdx = PB_MAIN_COUNT;
  for (let vi = 0; vi < splitN; vi++) {
    const txt = cellMatrix[vi]![pbIdx] ?? '';
    const sc = scorePbCellOcr(txt);
    if (sc > mergedPbSc || (sc === mergedPbSc && txt.length < mergedPb.length)) {
      mergedPbSc = sc;
      mergedPb = txt;
    }
  }

  const mergedLine = [...mergedMains, mergedPb].join(' ');
  const parsedMerged = parsePowerballRowWithFamily(mergedLine, family);
  let bestCand: RowParseCandidate = {
    main: parsedMerged.main,
    special: parsedMerged.special,
    score: scoreRow(parsedMerged.main, parsedMerged.special),
  };

  for (let vi = 0; vi < splitN; vi++) {
    const lineVi = (cellMatrix[vi] ?? []).join(' ');
    const p = parsePowerballRowWithFamily(lineVi, family);
    const sc = scoreRow(p.main, p.special);
    if (sc > bestCand.score) {
      bestCand = { main: p.main, special: p.special, score: sc };
    }
  }

  return bestCand;
}

/**
 * Split recognition: one gray strip per row; column segmentation only inside that strip.
 */
export async function runLayer4SplitRecognition(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  variantUris: string[],
  family: PbTemplateFamily,
  hints: PbAnchorHints,
): Promise<Layer4Result> {
  const grid = computeLayer4PlayGrid(gray, width, height, family, hints);
  if (!grid) {
    return { rows: [] };
  }
  const { mx0, mx1, px0, px1, rowEdges } = grid;

  const nRows = grid.nRows;
  const splitN = Math.min(PB_SPLIT_VARIANTS, variantUris.length);

  const refinedSpans = listRefinedRowSpansForLayer4(
    gray,
    width,
    height,
    rowEdges,
    nRows,
    mx0,
    mx1,
    px0,
    px1,
    PB_MAX_PLAY_ROWS,
  );

  const rows: RowParseCandidate[] = [];

  for (let ri = 0; ri < refinedSpans.length; ri++) {
    const { y0: yA, y1: yB } = refinedSpans[ri]!;
    if (yB - yA < 10) continue;

    const rowStrip = extractGrayBand(gray, width, height, yA, yB);
    const rowH = yB - yA;
    if (rowStrip.length !== width * rowH) continue;

    let mx0r = mx0;
    let mx1r = mx1;
    let bestCand: RowParseCandidate | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const seg = segmentMainColumnXEdgesForRow(rowStrip, width, rowH, mx0r, mx1r, 0, rowH);
      const xEdges = seg.edges;
      const cand = await runCellMatrixForRow(
        rowStrip,
        width,
        rowH,
        yA,
        xEdges,
        mx0r,
        mx1r,
        px0,
        px1,
        variantUris,
        splitN,
        family,
      );
      bestCand = cand;
      if (isValidParsedPowerballRow(cand.main, cand.special)) {
        break;
      }
      if (attempt === 0) {
        const ex = expandMainZoneHorizontally(mx0r, mx1r, width, 0.12);
        mx0r = ex.mx0;
        mx1r = ex.mx1;
      }
    }

    if (bestCand && isValidParsedPowerballRow(bestCand.main, bestCand.special)) {
      rows.push(bestCand);
    }
  }

  return { rows };
}
