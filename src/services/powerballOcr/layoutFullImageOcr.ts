/**
 * Full-image ML Kit OCR → adaptive Y-clustered rows → main column vs Powerball column → parse.
 * No per-row image crops; uses element/line bounding boxes from the native OCR payload.
 */
import type { ParsedTicket } from '../ocr';
import { PB_MAIN_COUNT } from './constants';
import type { PbTemplateFamily } from './types';
import {
  parseMainNumbersOnlyFromZoneText,
  parsePowerballRowWithFamily,
  parsePowerballSpecialFromColumnText,
} from './usParseLine';

export type LayoutTextFragment = {
  text: string;
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
};

export type RowAcceptanceStatus = 'accepted' | 'rejected_incomplete' | 'skipped_empty';

export type LayoutOcrRowDebug = {
  rowIndex: number;
  yCenter: number;
  joinedText: string;
  mainZoneText: string;
  powerballZoneText: string;
  fragmentTexts: string[];
  parsedMain: number[];
  parsedSpecial: number | null;
  powerballDetected: boolean;
  usedSpatialSplit: boolean;
  warnings: string[];
  status: RowAcceptanceStatus;
  discardReason?: string;
};

export type DiscardedRowInfo = {
  rowIndex: number;
  yCenter: number;
  reason: string;
  joinedText: string;
  parsedMain: number[];
  parsedSpecial: number | null;
  powerballDetected: boolean;
};

export type LayoutOcrParseResult = {
  ticket: ParsedTicket | null;
  rows: LayoutOcrRowDebug[];
  warnings: string[];
  fragmentCount: number;
  fragmentSample: Array<{ text: string; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }>;
  /** Every OCR box used for layout (full play-area coverage for diagnostics). */
  ocrBoxesPlayArea: Array<{ text: string; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }>;
  rowGrouping: {
    ySepThresholdPx: number;
    retriedFinerSplit: boolean;
    clusterCount: number;
    imageHeightPx: number;
  };
  completeness: {
    expectedPlayRows: number;
    acceptedPlayRows: number;
    clusterRowsDetected: number;
    warnings: string[];
  };
  discardedRows: DiscardedRowInfo[];
};

type Corner = { x: number; y: number };

function bboxFromCorners(corners: Corner[]): { cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; h: number } {
  if (!corners.length) return { cx: 0, cy: 0, x0: 0, y0: 0, x1: 0, y1: 0, h: 8 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const h = Math.max(6, maxY - minY);
  return { cx, cy, x0: minX, y0: minY, x1: maxX, y1: maxY, h };
}

function parseCorners(raw: unknown): Corner[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const pts: Corner[] = [];
  for (const c of raw) {
    const o = c as { x?: unknown; y?: unknown };
    const x = typeof o?.x === 'number' ? o.x : Number(o?.x);
    const y = typeof o?.y === 'number' ? o.y : Number(o?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
  }
  return pts.length >= 2 ? pts : null;
}

function pushFragment(out: LayoutTextFragment[], text: string, cornersRaw: unknown): void {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return;
  const corners = parseCorners(cornersRaw);
  if (!corners) return;
  const b = bboxFromCorners(corners);
  out.push({
    text: t,
    cx: b.cx,
    cy: b.cy,
    x0: b.x0,
    y0: b.y0,
    x1: b.x1,
    y1: b.y1,
    h: b.h,
  });
}

/**
 * Collect line- and element-level fragments with geometry (native ML Kit / expo-mlkit-ocr shape).
 */
export function extractLayoutTextFragments(rawNative: unknown): LayoutTextFragment[] {
  const out: LayoutTextFragment[] = [];
  const root = rawNative as { blocks?: unknown };
  const blocks = root?.blocks;
  if (!Array.isArray(blocks)) return out;

  for (const block of blocks) {
    const b = block as { lines?: unknown; text?: unknown; cornerPoints?: unknown };
    const lines = b?.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      pushFragment(out, String(b?.text ?? ''), b?.cornerPoints);
      continue;
    }
    for (const line of lines) {
      const ln = line as { text?: unknown; elements?: unknown; cornerPoints?: unknown };
      const elements = ln?.elements;
      if (Array.isArray(elements) && elements.length > 0) {
        for (const el of elements) {
          const e = el as { text?: unknown; cornerPoints?: unknown };
          pushFragment(out, String(e?.text ?? ''), e?.cornerPoints);
        }
      } else {
        pushFragment(out, String(ln?.text ?? ''), ln?.cornerPoints);
      }
    }
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 12;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Drop obvious headers / disclaimers; do not drop long play lines (many digits). */
function isLikelyNoiseFragment(f: LayoutTextFragment): boolean {
  const t = f.text;
  const digitCount = t.match(/\d/g)?.length ?? 0;
  if (t.length > 72 && digitCount < 5) return true;
  if (/^(POWERBALL|POWER\s*PLAY|DRAW|SCAN|VALID|VOID|RETAILER)\b/i.test(t) && digitCount < 2) return true;
  return false;
}

function clusterWithThreshold(usable: LayoutTextFragment[], threshold: number): LayoutTextFragment[][] {
  const sorted = [...usable].sort((a, b) => a.cy - b.cy);
  const clusters: LayoutTextFragment[][] = [];
  for (const f of sorted) {
    const last = clusters[clusters.length - 1];
    const prev = last?.[last.length - 1];
    if (!last || prev == null || f.cy - prev.cy > threshold) {
      clusters.push([f]);
    } else {
      last.push(f);
    }
  }
  return clusters;
}

function initialYThreshold(usable: LayoutTextFragment[], imageHeight: number): number {
  const hs = usable.map((f) => f.h).filter((h) => h > 0);
  const medH = median(hs.length ? hs : [12]);
  const fromText = Math.max(6, medH * 0.36);
  const capByImage = imageHeight * 0.024;
  return Math.min(fromText, capByImage);
}

/**
 * Cluster fragments into horizontal bands. Retries with a stricter threshold when too few rows
 * vs expected play lines (common failure: merged adjacent plays).
 */
export function clusterFragmentsIntoRowsAdaptive(
  fragments: LayoutTextFragment[],
  imageHeight: number,
  options: { minPlayRowsHint: number },
): { clusters: LayoutTextFragment[][]; ySepThresholdPx: number; retriedFinerSplit: boolean } {
  const usable = fragments.filter((f) => !isLikelyNoiseFragment(f));
  if (usable.length === 0) {
    return { clusters: [], ySepThresholdPx: 0, retriedFinerSplit: false };
  }

  let threshold = initialYThreshold(usable, imageHeight);
  let clusters = clusterWithThreshold(usable, threshold);
  let retried = false;

  if (
    clusters.length < options.minPlayRowsHint &&
    usable.length >= options.minPlayRowsHint * 2 &&
    clusters.length < usable.length
  ) {
    const tighter = Math.max(4, threshold * 0.55);
    if (tighter < threshold - 0.5) {
      const c2 = clusterWithThreshold(usable, tighter);
      if (c2.length > clusters.length) {
        clusters = c2;
        threshold = tighter;
        retried = true;
      }
    }
  }

  return { clusters, ySepThresholdPx: threshold, retriedFinerSplit: retried };
}

/** @deprecated use clusterFragmentsIntoRowsAdaptive */
export function clusterFragmentsIntoRows(fragments: LayoutTextFragment[]): LayoutTextFragment[][] {
  const h =
    fragments.length > 0 ? Math.max(120, ...fragments.map((f) => Math.max(f.y1, f.cy + f.h / 2))) : 800;
  return clusterFragmentsIntoRowsAdaptive(fragments, h, { minPlayRowsHint: 5 }).clusters;
}

/** Prefer left edge of a "POWER" OCR box (CA-style column); else legacy 0.73 width fraction. */
function mainPbSplitEdgePx(cluster: LayoutTextFragment[], imageWidth: number): number {
  const POWER_RE = /\bPOWER\b/i;
  const powerFrags = cluster.filter((f) => POWER_RE.test(f.text));
  if (powerFrags.length > 0) {
    const left = Math.min(...powerFrags.map((f) => f.x0));
    return Math.round(Math.max(imageWidth * 0.52, Math.min(left - 4, imageWidth * 0.84)));
  }
  return Math.round(imageWidth * 0.73);
}

function splitMainAndPowerballFragments(
  cluster: LayoutTextFragment[],
  imageWidth: number,
): { mainFrags: LayoutTextFragment[]; pbFrags: LayoutTextFragment[]; usedSpatial: boolean } {
  if (imageWidth < 80) {
    const sorted = [...cluster].sort((a, b) => a.cx - b.cx);
    return { mainFrags: sorted, pbFrags: [], usedSpatial: false };
  }
  const edge = mainPbSplitEdgePx(cluster, imageWidth);
  const mainFrags = cluster.filter((f) => f.cx < edge);
  const pbFrags = cluster.filter((f) => f.cx >= edge);
  return { mainFrags, pbFrags, usedSpatial: true };
}

function rowWarnings(
  parsed: { main: number[]; special: number | null },
  mainCount: number,
  mainMax: number,
  specialMin: number,
  specialMax: number,
): string[] {
  const w: string[] = [];
  if (parsed.main.length > 0 && parsed.main.length < mainCount) {
    w.push(`incomplete_mains_${parsed.main.length}_of_${mainCount}`);
  }
  if (parsed.main.length === mainCount && new Set(parsed.main).size !== mainCount) {
    w.push('duplicate_main_numbers');
  }
  if (parsed.main.some((n) => n < 1 || n > mainMax)) {
    w.push('main_out_of_range');
  }
  if (parsed.special != null && (parsed.special < specialMin || parsed.special > specialMax)) {
    w.push('special_out_of_range');
  }
  if (parsed.main.length === mainCount && parsed.special == null) {
    w.push('missing_powerball');
  }
  return w;
}

function parseOnePlayRow(
  cluster: LayoutTextFragment[],
  imageWidth: number,
  family: PbTemplateFamily,
  options: {
    mainCount: number;
    mainMax: number;
    specialMin: number;
    specialMax: number;
  },
): {
  joinedText: string;
  mainZoneText: string;
  powerballZoneText: string;
  parsedMain: number[];
  parsedSpecial: number | null;
  powerballDetected: boolean;
  usedSpatialSplit: boolean;
  warnings: string[];
} {
  const sorted = [...cluster].sort((a, b) => a.cx - b.cx);
  const joinedText = sorted.map((f) => f.text).join(' ');
  const { mainFrags, pbFrags, usedSpatial } = splitMainAndPowerballFragments(cluster, imageWidth);
  const mainSorted = [...mainFrags].sort((a, b) => a.cx - b.cx);
  const pbSorted = [...pbFrags].sort((a, b) => a.cx - b.cx);
  const mainZoneText = mainSorted.map((f) => f.text).join(' ');
  const powerballZoneText = pbSorted.map((f) => f.text).join(' ');

  let mains: number[];
  let special: number | null;

  if (mainSorted.length > 0) {
    mains = parseMainNumbersOnlyFromZoneText(
      mainZoneText,
      family,
      options.mainCount,
      options.mainMax,
      options.specialMin,
      options.specialMax,
    );
    special = parsePowerballSpecialFromColumnText(powerballZoneText, options.specialMin, options.specialMax);
    if (special == null && joinedText.length > 0) {
      special = parsePowerballSpecialFromColumnText(joinedText, options.specialMin, options.specialMax);
    }
  } else {
    const fb = parsePowerballRowWithFamily(joinedText, family);
    mains = fb.main;
    special = fb.special;
  }

  /**
   * Scheme 2: PB column OCR may duplicate a main (e.g. 25→15 when 15 is already a white ball);
   * full-row parse often still yields the correct PB — prefer it when column special ∈ mains and line special ∉ mains.
   */
  if (mains.length === options.mainCount && special != null) {
    const lineParsed = parsePowerballRowWithFamily(joinedText, family);
    if (
      lineParsed.special != null &&
      lineParsed.special !== special &&
      mains.includes(special) &&
      !mains.includes(lineParsed.special) &&
      lineParsed.special >= options.specialMin &&
      lineParsed.special <= options.specialMax
    ) {
      special = lineParsed.special;
    }
  }

  if (mains.length < options.mainCount || special == null) {
    const fb = parsePowerballRowWithFamily(joinedText, family);
    if (mains.length < options.mainCount && fb.main.length > mains.length) {
      mains = fb.main;
    }
    if (mains.length < options.mainCount && fb.main.length === options.mainCount) {
      mains = fb.main;
    }
    if (special == null && fb.special != null) {
      special = fb.special;
    }
  }

  const powerballDetected = special != null && special >= options.specialMin && special <= options.specialMax;
  const warnings = rowWarnings({ main: mains, special }, options.mainCount, options.mainMax, options.specialMin, options.specialMax);

  return {
    joinedText,
    mainZoneText,
    powerballZoneText,
    parsedMain: mains,
    parsedSpecial: special,
    powerballDetected,
    usedSpatialSplit: usedSpatial,
    warnings,
  };
}

/**
 * Build ParsedTicket from spatially grouped OCR rows; prefers physically upper rows first.
 */
export function parseTicketFromLayoutFullImage(
  rawNative: unknown,
  family: PbTemplateFamily,
  options: {
    mainCount: number;
    mainMax: number;
    specialMin: number;
    specialMax: number;
    playsPerTicket: number;
  },
  layoutSize: { width: number; height: number },
): LayoutOcrParseResult {
  const { width: imageWidth, height: imageHeight } = layoutSize;
  const fragments = extractLayoutTextFragments(rawNative);
  const warnings: string[] = [];
  const completenessWarnings: string[] = [];

  const ocrBoxesPlayArea = fragments.map((f) => ({
    text: f.text.length > 64 ? `${f.text.slice(0, 64)}…` : f.text,
    cx: f.cx,
    cy: f.cy,
    x0: f.x0,
    y0: f.y0,
    x1: f.x1,
    y1: f.y1,
  }));

  if (fragments.length === 0) {
    warnings.push('no_layout_fragments');
    completenessWarnings.push('no_ocr_fragments');
    return {
      ticket: null,
      rows: [],
      warnings,
      fragmentCount: 0,
      fragmentSample: [],
      ocrBoxesPlayArea,
      rowGrouping: { ySepThresholdPx: 0, retriedFinerSplit: false, clusterCount: 0, imageHeightPx: imageHeight },
      completeness: {
        expectedPlayRows: options.playsPerTicket,
        acceptedPlayRows: 0,
        clusterRowsDetected: 0,
        warnings: completenessWarnings,
      },
      discardedRows: [],
    };
  }

  const fragmentSample = fragments.slice(0, 80).map((f) => ({
    text: f.text.length > 48 ? `${f.text.slice(0, 48)}…` : f.text,
    cx: f.cx,
    cy: f.cy,
    x0: f.x0,
    y0: f.y0,
    x1: f.x1,
    y1: f.y1,
  }));

  const { clusters: rowClusters, ySepThresholdPx, retriedFinerSplit } = clusterFragmentsIntoRowsAdaptive(
    fragments,
    imageHeight,
    { minPlayRowsHint: options.playsPerTicket },
  );

  if (rowClusters.length < options.playsPerTicket) {
    completenessWarnings.push(
      `fewer_row_clusters_than_expected:${rowClusters.length}_lt_${options.playsPerTicket}`,
    );
  }

  const rowsWorking: LayoutOcrRowDebug[] = [];
  let idx = 0;
  for (const cluster of rowClusters) {
    idx++;
    const yCenter = median(cluster.map((f) => f.cy));
    const parsed = parseOnePlayRow(cluster, imageWidth, family, options);
    const validMains =
      parsed.parsedMain.length === options.mainCount &&
      new Set(parsed.parsedMain).size === options.mainCount &&
      parsed.parsedMain.every((n) => n >= 1 && n <= options.mainMax);
    const validPb =
      parsed.parsedSpecial != null &&
      parsed.parsedSpecial >= options.specialMin &&
      parsed.parsedSpecial <= options.specialMax;

    let status: RowAcceptanceStatus = 'rejected_incomplete';
    let discardReason: string | undefined;
    if (cluster.length === 0 || parsed.joinedText.trim().length === 0) {
      status = 'skipped_empty';
      discardReason = 'empty_cluster';
    } else if (validMains && validPb) {
      status = 'accepted';
    } else if (!validMains) {
      discardReason = `invalid_mains_${parsed.parsedMain.length}`;
    } else {
      discardReason = 'missing_or_invalid_powerball';
    }

    rowsWorking.push({
      rowIndex: idx,
      yCenter,
      joinedText: parsed.joinedText,
      mainZoneText: parsed.mainZoneText,
      powerballZoneText: parsed.powerballZoneText,
      fragmentTexts: [...cluster].sort((a, b) => a.cx - b.cx).map((f) => f.text),
      parsedMain: parsed.parsedMain,
      parsedSpecial: parsed.parsedSpecial,
      powerballDetected: parsed.powerballDetected,
      usedSpatialSplit: parsed.usedSpatialSplit,
      warnings: parsed.warnings,
      status,
      discardReason,
    });
  }

  rowsWorking.sort((a, b) => a.yCenter - b.yCenter);
  for (let i = 0; i < rowsWorking.length; i++) {
    rowsWorking[i]!.rowIndex = i + 1;
  }

  const validRows = rowsWorking.filter((r) => r.status === 'accepted');

  const playLines = Math.min(options.playsPerTicket, validRows.length);
  const chosen = validRows.slice(0, playLines);

  const discardedRows: DiscardedRowInfo[] = rowsWorking
    .filter((r) => !chosen.some((c) => c.rowIndex === r.rowIndex))
    .map((r) => ({
      rowIndex: r.rowIndex,
      yCenter: r.yCenter,
      reason: r.discardReason ?? r.status,
      joinedText: r.joinedText.length > 160 ? `${r.joinedText.slice(0, 160)}…` : r.joinedText,
      parsedMain: r.parsedMain,
      parsedSpecial: r.parsedSpecial,
      powerballDetected: r.powerballDetected,
    }));

  if (chosen.length < options.playsPerTicket) {
    completenessWarnings.push(
      `accepted_only_${chosen.length}_of_${options.playsPerTicket}_expected_play_rows`,
    );
  }
  if (rowClusters.length < options.playsPerTicket && rowClusters.length > 0) {
    completenessWarnings.push('possible_merged_rows_or_missing_lower_ocr');
  }

  if (validRows.length < rowClusters.length) {
    warnings.push('some_rows_failed_validation');
  }

  if (chosen.length === 0) {
    warnings.push('no_complete_play_rows_from_layout');
    return {
      ticket: null,
      rows: rowsWorking,
      warnings,
      fragmentCount: fragments.length,
      fragmentSample,
      ocrBoxesPlayArea,
      rowGrouping: {
        ySepThresholdPx,
        retriedFinerSplit,
        clusterCount: rowClusters.length,
        imageHeightPx: imageHeight,
      },
      completeness: {
        expectedPlayRows: options.playsPerTicket,
        acceptedPlayRows: 0,
        clusterRowsDetected: rowClusters.length,
        warnings: completenessWarnings,
      },
      discardedRows,
    };
  }

  const allSets = chosen.map((r) => r.parsedMain.slice(0, PB_MAIN_COUNT));
  const specialsPerLine = chosen.map((r) => (r.parsedSpecial != null ? r.parsedSpecial : 0));
  const conf = Math.min(0.94, 0.5 + chosen.length * 0.08);
  const rawText = chosen.map((r) => r.joinedText).join('\n');

  const ticket: ParsedTicket = {
    mainNumbers: allSets[0]!,
    allSets,
    specialsPerLine,
    confidence: conf,
    rawText,
  };

  return {
    ticket,
    rows: rowsWorking,
    warnings,
    fragmentCount: fragments.length,
    fragmentSample,
    ocrBoxesPlayArea,
    rowGrouping: {
      ySepThresholdPx,
      retriedFinerSplit,
      clusterCount: rowClusters.length,
      imageHeightPx: imageHeight,
    },
    completeness: {
      expectedPlayRows: options.playsPerTicket,
      acceptedPlayRows: chosen.length,
      clusterRowsDetected: rowClusters.length,
      warnings: completenessWarnings,
    },
    discardedRows,
  };
}
