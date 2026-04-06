/**
 * Row band geometry from horizontal ink projection (layer 1).
 * Main column x splits are per-row in `rowDigitSegmentation.ts`, not here.
 */
import { horizontalProjectionInkInBand } from '../ticketPreprocess/pixelOps';

function smooth1d(a: Float32Array, win: number): Float32Array {
  if (win <= 1) return a;
  const half = Math.floor(win / 2);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let c = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < a.length) {
        s += a[j]!;
        c++;
      }
    }
    out[i] = c > 0 ? s / c : 0;
  }
  return out;
}

function meanMax(a: Float32Array): { mean: number; max: number } {
  let sum = 0;
  let maxV = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!;
    sum += v;
    if (v > maxV) maxV = v;
  }
  return { mean: a.length ? sum / a.length : 0, max: maxV };
}

/**
 * Local maxima with non-max suppression by index distance (keep higher value first).
 */
function pickPeaksNms(
  a: Float32Array,
  minProminence: number,
  minDist: number,
  maxPeaks: number,
): number[] {
  const cand: { i: number; v: number }[] = [];
  for (let i = 2; i < a.length - 2; i++) {
    const v = a[i]!;
    if (v < minProminence) continue;
    if (v < a[i - 1]! || v < a[i + 1]!) continue;
    if (v < a[i - 2]! || v < a[i + 2]!) continue;
    cand.push({ i, v });
  }
  cand.sort((x, y) => y.v - x.v);
  const picked: number[] = [];
  for (const c of cand) {
    if (picked.some((p) => Math.abs(p - c.i) < minDist)) continue;
    picked.push(c.i);
    if (picked.length >= maxPeaks) break;
  }
  picked.sort((x, y) => x - y);
  return picked;
}

function equalRowEdges(y0: number, y1: number, nRows: number): number[] {
  const h = y1 - y0;
  if (h < nRows * 6) return [];
  const step = h / nRows;
  const edges: number[] = [y0];
  for (let i = 1; i < nRows; i++) {
    edges.push(Math.round(y0 + i * step));
  }
  edges.push(y1);
  return edges;
}

/** Approximate one text-line thickness from horizontal ink profile at a peak (for multi-line split). */
function estimateLineHeightFromPeakProfile(smooth: Float32Array, peakIdx: number): number {
  const v = smooth[peakIdx]!;
  if (v < 1e-6) return Math.max(14, Math.floor(smooth.length / 5));
  const threshold = v * 0.42;
  let l = peakIdx;
  while (l > 0 && smooth[l]! >= threshold) l--;
  let r = peakIdx;
  while (r < smooth.length - 1 && smooth[r]! >= threshold) r++;
  const span = Math.max(1, r - l + 1);
  return Math.max(8, Math.min(span * 2, 200));
}

/**
 * Horizontal ink projection in main band: peaks ≈ text lines → row boundaries at mid-gaps.
 * Multi-line: relaxed second pass + height-based split when only one peak (no longer collapse to one row).
 */
export function estimateRowBandEdges(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  mx0: number,
  mx1: number,
  ry0: number,
  ry1: number,
  maxRows: number,
): number[] {
  const y0 = Math.max(0, Math.min(height, ry0));
  const y1 = Math.max(0, Math.min(height, ry1));
  if (y1 <= y0 + 8) return [];

  const full = horizontalProjectionInkInBand(gray, width, height, mx0, mx1);
  const sub = full.subarray(y0, y1);
  const bandH = y1 - y0;
  if (sub.length < 12) return equalRowEdges(y0, y1, maxRows);

  const smooth = smooth1d(sub, 7);
  const { mean, max: maxV } = meanMax(smooth);

  const minProm1 = Math.max(maxV * 0.1, mean * 0.78 + 0.8);
  const minDist1 = Math.max(6, Math.floor(sub.length / (maxRows * 1.25)));
  let peaks = pickPeaksNms(smooth, minProm1, minDist1, maxRows);

  if (peaks.length < 2) {
    const minProm2 = Math.max(4, maxV * 0.045, mean * 0.42 + 0.15);
    const minDist2 = Math.max(5, Math.floor(sub.length / (maxRows * 1.02)));
    const peaks2 = pickPeaksNms(smooth, minProm2, minDist2, maxRows);
    if (peaks2.length > peaks.length) {
      peaks = peaks2;
    }
  }

  /** Lowest horizontal projection between two line peaks — separates bands without merging ink. */
  const yBoundaryAtValleyBetweenPeaks = (peakA: number, peakB: number): number => {
    const lo = Math.min(peakA, peakB);
    const hi = Math.max(peakA, peakB);
    const from = Math.max(1, lo + 1);
    const to = Math.min(smooth.length - 2, hi - 1);
    if (from > to) {
      return y0 + Math.round((peakA + peakB) / 2);
    }
    let minI = from;
    let minV = smooth[from]!;
    for (let i = from; i <= to; i++) {
      const v = smooth[i]!;
      if (v < minV) {
        minV = v;
        minI = i;
      }
    }
    return y0 + minI;
  };

  const buildEdgesFromPeaks = (peakIdx: number[]): number[] => {
    if (peakIdx.length < 1) return [];
    if (peakIdx.length === 1) {
      const lineH = estimateLineHeightFromPeakProfile(smooth, peakIdx[0]!);
      const nGuess = Math.min(maxRows, Math.max(2, Math.round(bandH / Math.max(lineH * 1.28, 9))));
      if (nGuess >= 2 && bandH >= nGuess * 7) {
        return equalRowEdges(y0, y1, nGuess);
      }
      return [y0, y1];
    }
    const edges: number[] = [y0];
    for (let i = 0; i < peakIdx.length - 1; i++) {
      const b = yBoundaryAtValleyBetweenPeaks(peakIdx[i]!, peakIdx[i + 1]!);
      edges.push(Math.max(y0 + 1, Math.min(y1 - 1, b)));
    }
    edges.push(y1);
    for (let i = 1; i < edges.length; i++) {
      if (edges[i]! <= edges[i - 1]!) {
        return equalRowEdges(y0, y1, Math.min(peakIdx.length, maxRows));
      }
    }
    return edges;
  };

  if (peaks.length < 1) {
    if (bandH >= 40) {
      return equalRowEdges(y0, y1, Math.min(maxRows, Math.max(2, Math.floor(bandH / 28))));
    }
    return equalRowEdges(y0, y1, maxRows);
  }

  return buildEdgesFromPeaks(peaks);
}
