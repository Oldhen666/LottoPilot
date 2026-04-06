/**
 * Refine coarse horizontal row bands so each strip contains at most one line of digits.
 * Uses vertical ink projection + connected components to split stacked text and tighten height.
 */
import type { PbAnchorHints } from './types';

const INK_THRESHOLD = 218;
const MIN_SPAN_H = 8;
const PAD_Y = 2;

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

function medianPositive(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return 14;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

/** Per-row ink count in main ∪ PB columns (no double count). */
function verticalInkProjectionUnion(
  gray: Uint8ClampedArray,
  width: number,
  yA: number,
  yB: number,
  mx0: number,
  mx1: number,
  px0: number,
  px1: number,
): Float32Array {
  const h = yB - yA;
  const xa = Math.min(mx0, px0);
  const xb = Math.max(mx1, px1);
  const proj = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    const row = (yA + y) * width;
    let s = 0;
    for (let x = xa; x < xb; x++) {
      const inMain = x >= mx0 && x < mx1;
      const inPb = x >= px0 && x < px1;
      if ((inMain || inPb) && gray[row + x]! < INK_THRESHOLD) s++;
    }
    proj[y] = s;
  }
  return proj;
}

/** Contiguous runs where proj[i] >= thr. */
function runsAboveThreshold(proj: Float32Array, thr: number): { s: number; e: number }[] {
  const runs: { s: number; e: number }[] = [];
  let i = 0;
  while (i < proj.length) {
    if (proj[i]! < thr) {
      i++;
      continue;
    }
    const s = i;
    while (i < proj.length && proj[i]! >= thr) i++;
    const e = i - 1;
    if (e - s + 1 >= 4) runs.push({ s, e });
  }
  return runs;
}

/** Shrink [s,e] to rows with any ink above looseThr. */
function tightenRunY(
  proj: Float32Array,
  s: number,
  e: number,
  looseThr: number,
): { s: number; e: number } {
  let lo = s;
  let hi = e;
  while (lo < hi && proj[lo]! < looseThr) lo++;
  while (hi > lo && proj[hi]! < looseThr) hi--;
  return { s: lo, e: hi };
}

type CcBox = { minY: number; maxY: number; minX: number; maxX: number };

function connectedComponentsInUnionRect(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  yA: number,
  yB: number,
  mx0: number,
  mx1: number,
  px0: number,
  px1: number,
): CcBox[] {
  const xa = Math.max(0, Math.min(mx0, px0));
  const xb = Math.min(width, Math.max(mx1, px1));
  const ya = Math.max(0, yA);
  const yb = Math.min(height, yB);
  const w = xb - xa;
  const h = yb - ya;
  if (w < 2 || h < 2) return [];

  const vis = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  const boxes: CcBox[] = [];

  const idx = (lx: number, ly: number) => ly * w + lx;

  for (let ly = 0; ly < h; ly++) {
    const gy = ya + ly;
    const rowOff = gy * width;
    for (let lx = 0; lx < w; lx++) {
      const gx = xa + lx;
      const inMain = gx >= mx0 && gx < mx1;
      const inPb = gx >= px0 && gx < px1;
      if (!(inMain || inPb)) continue;
      const p = idx(lx, ly);
      if (vis[p]) continue;
      if (gray[rowOff + gx]! >= INK_THRESHOLD) continue;

      let qh = 0;
      let qt = 0;
      qx[qt] = lx;
      qy[qt] = ly;
      qt++;
      vis[p] = 1;

      let minX = gx;
      let maxX = gx;
      let minY = gy;
      let maxY = gy;

      while (qh < qt) {
        const lx0 = qx[qh]!;
        const ly0 = qy[qh]!;
        qh++;
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          const nlx = lx0 + dx;
          const nly = ly0 + dy;
          if (nlx < 0 || nlx >= w || nly < 0 || nly >= h) continue;
          const np = idx(nlx, nly);
          if (vis[np]) continue;
          const ngx = xa + nlx;
          const ngy = ya + nly;
          const nMain = ngx >= mx0 && ngx < mx1;
          const nPb = ngx >= px0 && ngx < px1;
          if (!(nMain || nPb)) continue;
          if (gray[ngy * width + ngx]! >= INK_THRESHOLD) continue;
          vis[np] = 1;
          qx[qt] = nlx;
          qy[qt] = nly;
          qt++;
          if (ngx < minX) minX = ngx;
          if (ngx > maxX) maxX = ngx;
          if (ngy < minY) minY = ngy;
          if (ngy > maxY) maxY = ngy;
        }
      }

      const bh = maxY - minY + 1;
      const bw = maxX - minX + 1;
      if (bh >= 3 && bw >= 2 && bh < h * 0.98) {
        boxes.push({ minY, maxY, minX, maxX });
      }
    }
  }

  return boxes;
}

/** Group CCs into horizontal text lines (separate vertical clusters). */
function clusterBoxesIntoLines(boxes: CcBox[], bandH: number): CcBox[][] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2);
  const heights = sorted.map((b) => b.maxY - b.minY + 1);
  const medH = medianPositive(heights);
  const gapSep = Math.max(4, Math.min(0.42 * medH, bandH * 0.22));

  const lines: CcBox[][] = [];
  let cur: CcBox[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i]!;
    const prevBottom = Math.max(...cur.map((c) => c.maxY));
    if (b.minY - prevBottom > gapSep) {
      lines.push(cur);
      cur = [b];
    } else {
      cur.push(b);
    }
  }
  lines.push(cur);
  return lines;
}

function mergeLineBoxes(line: CcBox[]): { minY: number; maxY: number } {
  let minY = line[0]!.minY;
  let maxY = line[0]!.maxY;
  for (const b of line) {
    if (b.minY < minY) minY = b.minY;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minY, maxY };
}

/**
 * Within [yA,yB), return one or more vertical spans that each contain a single digit line.
 * Global coordinates; y1 exclusive.
 */
export function refineRowBandToSingleLineSpans(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  yA: number,
  yB: number,
  mx0: number,
  mx1: number,
  px0: number,
  px1: number,
): { y0: number; y1: number }[] {
  const y0 = Math.max(0, Math.min(height, yA));
  const y1 = Math.max(0, Math.min(height, yB));
  if (y1 <= y0 + 6) return [];

  const bandH = y1 - y0;
  const proj = verticalInkProjectionUnion(gray, width, y0, y1, mx0, mx1, px0, px1);
  const smooth = smooth1d(proj, 3);
  let maxV = 0;
  let sum = 0;
  for (let i = 0; i < smooth.length; i++) {
    const v = smooth[i]!;
    sum += v;
    if (v > maxV) maxV = v;
  }
  const meanV = smooth.length ? sum / smooth.length : 0;
  const thr = Math.max(maxV * 0.072, meanV * 0.32, 0.35);
  const looseThr = Math.max(thr * 0.22, 0.12);

  let runs = runsAboveThreshold(smooth, thr);
  for (let pass = 0; pass < 2 && runs.length >= 2; pass++) {
    const merged: { s: number; e: number }[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && r.s - last.e - 1 <= 2) {
        last.e = r.e;
      } else {
        merged.push({ ...r });
      }
    }
    runs = merged;
  }

  const toGlobalSpans = (rs: { s: number; e: number }[]): { y0: number; y1: number }[] => {
    const out: { y0: number; y1: number }[] = [];
    for (const r of rs) {
      const t = tightenRunY(smooth, r.s, r.e, looseThr);
      if (t.e < t.s) continue;
      let g0 = y0 + t.s - PAD_Y;
      let g1 = y0 + t.e + 1 + PAD_Y;
      g0 = Math.max(y0, Math.min(y1 - MIN_SPAN_H, g0));
      g1 = Math.min(y1, Math.max(g0 + MIN_SPAN_H, g1));
      if (g1 - g0 >= MIN_SPAN_H) out.push({ y0: g0, y1: g1 });
    }
    return out;
  };

  if (runs.length >= 2) {
    const filtered = runs.filter((r) => r.e - r.s + 1 >= 6);
    if (filtered.length >= 2) return toGlobalSpans(filtered);
  }

  const boxes = connectedComponentsInUnionRect(gray, width, height, y0, y1, mx0, mx1, px0, px1);
  const lineGroups = clusterBoxesIntoLines(boxes, bandH);

  if (lineGroups.length >= 2) {
    const spans: { y0: number; y1: number }[] = [];
    for (const lg of lineGroups) {
      const { minY, maxY } = mergeLineBoxes(lg);
      let g0 = minY - PAD_Y;
      let g1 = maxY + 1 + PAD_Y;
      g0 = Math.max(y0, Math.min(y1 - MIN_SPAN_H, g0));
      g1 = Math.min(y1, Math.max(g0 + MIN_SPAN_H, g1));
      if (g1 - g0 >= MIN_SPAN_H) spans.push({ y0: g0, y1: g1 });
    }
    if (spans.length >= 2) return spans.sort((a, b) => a.y0 - b.y0);
  }

  const estLineH = Math.max(10, Math.min(32, medianPositive(boxes.map((b) => b.maxY - b.minY + 1)) || Math.floor(bandH / 3)));
  const singleRun = runs.length === 1 ? runs[0]! : null;

  if (singleRun && singleRun.e - singleRun.s + 1 > estLineH * 1.45 && boxes.length >= 2) {
    const lineGroups2 = clusterBoxesIntoLines(boxes, bandH);
    if (lineGroups2.length >= 2) {
      const spans: { y0: number; y1: number }[] = [];
      for (const lg of lineGroups2) {
        const { minY, maxY } = mergeLineBoxes(lg);
        let g0 = minY - PAD_Y;
        let g1 = maxY + 1 + PAD_Y;
        g0 = Math.max(y0, Math.min(y1 - MIN_SPAN_H, g0));
        g1 = Math.min(y1, Math.max(g0 + MIN_SPAN_H, g1));
        if (g1 - g0 >= MIN_SPAN_H) spans.push({ y0: g0, y1: g1 });
      }
      if (spans.length >= 2) return spans.sort((a, b) => a.y0 - b.y0);
    }
  }

  if (runs.length >= 1) {
    const r = runs.length === 1 ? runs[0]! : runs.reduce((a, b) => (b.e - b.s > a.e - a.s ? b : a));
    const t = tightenRunY(smooth, r.s, r.e, looseThr);
    if (t.e >= t.s) {
      let g0 = y0 + t.s - PAD_Y;
      let g1 = y0 + t.e + 1 + PAD_Y;
      g0 = Math.max(y0, Math.min(y1 - MIN_SPAN_H, g0));
      g1 = Math.min(y1, Math.max(g0 + MIN_SPAN_H, g1));
      if (g1 - g0 >= MIN_SPAN_H) return [{ y0: g0, y1: g1 }];
    }
  }

  if (boxes.length >= 1) {
    const { minY, maxY } = mergeLineBoxes(boxes);
    let g0 = minY - PAD_Y;
    let g1 = maxY + 1 + PAD_Y;
    g0 = Math.max(y0, Math.min(y1 - MIN_SPAN_H, g0));
    g1 = Math.min(y1, Math.max(g0 + MIN_SPAN_H, g1));
    if (g1 - g0 >= MIN_SPAN_H) return [{ y0: g0, y1: g1 }];
  }

  return [];
}

/**
 * Expands coarse `rowEdges` into tight single-line spans; caps total count.
 */
export function listRefinedRowSpansForLayer4(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  rowEdges: number[],
  nRows: number,
  mx0: number,
  mx1: number,
  px0: number,
  px1: number,
  maxTotal: number,
): { y0: number; y1: number }[] {
  const out: { y0: number; y1: number }[] = [];
  for (let r = 0; r < nRows && out.length < maxTotal; r++) {
    const yA = rowEdges[r]!;
    const yB = rowEdges[r + 1]!;
    if (yB - yA < 8) continue;
    const spans = refineRowBandToSingleLineSpans(gray, width, height, yA, yB, mx0, mx1, px0, px1);
    if (spans.length === 0) {
      if (yB - yA >= MIN_SPAN_H) out.push({ y0: yA, y1: yB });
    } else {
      for (const s of spans) {
        if (out.length >= maxTotal) break;
        if (s.y1 - s.y0 >= MIN_SPAN_H) out.push(s);
      }
    }
  }
  return out;
}
