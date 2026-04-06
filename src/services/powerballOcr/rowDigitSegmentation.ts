/**
 * Main play-area column segmentation (5 cells + PB handled separately).
 * No equal-width primary path: vertical ink projection → gap (valley) splits,
 * then equal-ink mass splits, then merged connected components, equal width last.
 */
import { verticalProjectionInkInRect } from '../ticketPreprocess/pixelOps';
import { PB_MAIN_COUNT } from './constants';

const INK_THRESHOLD = 218;

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

function sumProj(a: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}

/** Last resort only: 5 equal-width columns in [xa, xb]. */
function equalWidthEdges(xa: number, xb: number, nCols: number): number[] {
  const w = xb - xa;
  const edges: number[] = [];
  for (let i = 0; i <= nCols; i++) {
    edges.push(Math.round(xa + (w * i) / nCols));
  }
  return fixStrictIncreasing(edges, xa, xb, nCols);
}

/** Ensure length nCols+1, strictly increasing, xa and xb as ends. */
function fixStrictIncreasing(edges: number[], xa: number, xb: number, nCols: number): number[] {
  const out = edges.map((x) => Math.round(x));
  out[0] = xa;
  out[nCols] = xb;
  for (let i = 1; i < nCols; i++) {
    const lo = out[i - 1]! + 1;
    const hi = xb - (nCols - i);
    if (out[i]! <= out[i - 1]!) out[i] = lo;
    if (out[i]! > hi) out[i] = hi;
    if (out[i]! <= out[i - 1]!) out[i] = out[i - 1]! + 1;
  }
  if (out[nCols]! <= out[nCols - 1]!) out[nCols] = xb;
  return out;
}

/**
 * Split [0, n) into 5 segments by cumulative ink (not equal width).
 */
function columnEdgesFromEqualInkProjection(proj: Float32Array, xa: number, xb: number): number[] {
  const n = proj.length;
  if (n < PB_MAIN_COUNT * 4) {
    return equalWidthEdges(xa, xb, PB_MAIN_COUNT);
  }
  const total = sumProj(proj);
  if (total < 1e-3) {
    return equalWidthEdges(xa, xb, PB_MAIN_COUNT);
  }
  const edges: number[] = [xa];
  let cum = 0;
  let nextK = 1;
  for (let i = 0; i < n && nextK < PB_MAIN_COUNT; i++) {
    cum += proj[i]!;
    while (nextK < PB_MAIN_COUNT && cum >= (total * nextK) / PB_MAIN_COUNT) {
      edges.push(xa + i + 1);
      nextK++;
    }
  }
  while (edges.length < PB_MAIN_COUNT) {
    const step = Math.max(1, Math.floor(n / PB_MAIN_COUNT));
    edges.push(xa + Math.min(n - 1, (edges.length - 1) * step + step));
  }
  edges.push(xb);
  return fixStrictIncreasing(edges, xa, xb, PB_MAIN_COUNT);
}

/**
 * Find nCols-1 split indices (local minima / valleys) in vertical projection — whitespace between columns.
 */
function valleySplitIndices(proj: Float32Array, nCols: number): number[] | null {
  const n = proj.length;
  const nSplits = nCols - 1;
  if (n < nCols * 5) return null;

  const smooth = smooth1d(proj, 5);
  const maxV = Math.max(...smooth);
  if (maxV < 1e-6) return null;

  const minSep = Math.max(3, Math.floor(n / (nCols * 2.2)));
  const minima: { i: number; depth: number }[] = [];
  for (let i = 2; i < n - 2; i++) {
    const v = smooth[i]!;
    if (v >= smooth[i - 1]! || v >= smooth[i + 1]!) continue;
    if (v >= smooth[i - 2]! || v >= smooth[i + 2]!) continue;
    const depth = (smooth[i - 1]! + smooth[i + 1]!) / 2 - v;
    if (depth <= 0) continue;
    if (v > maxV * 0.55) continue;
    minima.push({ i, depth });
  }
  minima.sort((a, b) => b.depth - a.depth);

  const picked: number[] = [];
  for (const m of minima) {
    if (picked.some((p) => Math.abs(p - m.i) < minSep)) continue;
    picked.push(m.i);
    if (picked.length >= nSplits) break;
  }
  if (picked.length < nSplits) return null;
  picked.sort((a, b) => a - b);
  return picked;
}

function edgesFromValleyIndices(xa: number, xb: number, splits: number[]): number[] {
  const edges: number[] = [xa];
  for (const s of splits) {
    edges.push(xa + s + 1);
  }
  edges.push(xb);
  return fixStrictIncreasing(edges, xa, xb, PB_MAIN_COUNT);
}

type BBox = { x0: number; x1: number; y0: number; y1: number; area: number };

function floodFillBlobs(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  xa: number,
  xb: number,
  ya: number,
  yb: number,
): BBox[] {
  const rw = xb - xa;
  const rh = yb - ya;
  if (rw < 2 || rh < 2) return [];

  const seen = new Uint8Array(rw * rh);
  const blobs: BBox[] = [];
  const rowArea = rw * rh;
  const minA = Math.max(4, Math.floor(rowArea * 0.0008));
  const maxA = Math.floor(rowArea * 0.55);

  const stack: number[] = [];
  for (let ly = 0; ly < rh; ly++) {
    for (let lx = 0; lx < rw; lx++) {
      const si = ly * rw + lx;
      if (seen[si]) continue;
      const gx = xa + lx;
      const gy = ya + ly;
      if (gray[gy * width + gx]! >= INK_THRESHOLD) continue;

      let minX = gx;
      let maxX = gx;
      let minY = gy;
      let maxY = gy;
      let count = 0;
      seen[si] = 1;
      stack.push(si);

      while (stack.length) {
        const p = stack.pop()!;
        const py = Math.floor(p / rw);
        const px = p - py * rw;
        const ggx = xa + px;
        const ggy = ya + py;
        count++;
        if (ggx < minX) minX = ggx;
        if (ggx > maxX) maxX = ggx;
        if (ggy < minY) minY = ggy;
        if (ggy > maxY) maxY = ggy;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nlx = px + dx;
            const nly = py + dy;
            if (nlx < 0 || nlx >= rw || nly < 0 || nly >= rh) continue;
            const ni = nly * rw + nlx;
            if (seen[ni]) continue;
            const ngx = xa + nlx;
            const ngy = ya + nly;
            if (gray[ngy * width + ngx]! >= INK_THRESHOLD) continue;
            seen[ni] = 1;
            stack.push(ni);
          }
        }
      }

      if (count >= minA && count <= maxA) {
        blobs.push({ x0: minX, x1: maxX + 1, y0: minY, y1: maxY + 1, area: count });
      }
    }
  }

  blobs.sort((a, b) => a.x0 - b.x0);
  return blobs;
}

function mergeBlobsToFive(blobs: BBox[]): BBox[] | null {
  if (blobs.length < PB_MAIN_COUNT) return null;
  const b = blobs.map((x) => ({ ...x }));
  while (b.length > PB_MAIN_COUNT) {
    let bestI = 0;
    let bestGap = Infinity;
    for (let i = 0; i < b.length - 1; i++) {
      const gap = b[i + 1]!.x0 - b[i]!.x1;
      if (gap < bestGap) {
        bestGap = gap;
        bestI = i;
      }
    }
    const L = b[bestI]!;
    const R = b[bestI + 1]!;
    b[bestI] = {
      x0: L.x0,
      x1: R.x1,
      y0: Math.min(L.y0, R.y0),
      y1: Math.max(L.y1, R.y1),
      area: L.area + R.area,
    };
    b.splice(bestI + 1, 1);
  }
  if (b.length !== PB_MAIN_COUNT) return null;
  b.sort((a, c) => a.x0 - c.x0);
  return b;
}

function columnEdgesFromMergedBlobs(xa: number, xb: number, five: BBox[]): number[] {
  const edges: number[] = [xa];
  for (let i = 0; i < PB_MAIN_COUNT - 1; i++) {
    const mid = Math.round((five[i]!.x1 + five[i + 1]!.x0) / 2);
    edges.push(Math.max(xa + 1, Math.min(xb - 1, mid)));
  }
  edges.push(xb);
  return fixStrictIncreasing(edges, xa, xb, PB_MAIN_COUNT);
}

function segmentFromConnectedComponents(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  xa: number,
  xb: number,
  ya: number,
  yb: number,
): number[] | null {
  const blobs = floodFillBlobs(gray, width, height, xa, xb, ya, yb);
  if (blobs.length < PB_MAIN_COUNT) return null;
  const five = mergeBlobsToFive(blobs);
  if (!five) return null;
  return columnEdgesFromMergedBlobs(xa, xb, five);
}

export type MainColumnSegmentMethod = 'valley' | 'equal_ink' | 'components' | 'equal_width';

export type MainColumnSegmentMeta = {
  method: MainColumnSegmentMethod;
};

/**
 * Returns 6 x-coordinates: column c spans [edges[c], edges[c+1]) in image space.
 * Does not use equal-width unless other methods fail.
 */
export function segmentMainColumnXEdgesForRow(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  mx0: number,
  mx1: number,
  rowY0: number,
  rowY1: number,
): { edges: number[]; meta: MainColumnSegmentMeta } {
  const xa = Math.max(0, Math.min(width, Math.min(mx0, mx1)));
  const xb = Math.max(0, Math.min(width, Math.max(mx0, mx1)));
  const ya = Math.max(0, Math.min(height, Math.min(rowY0, rowY1)));
  const yb = Math.max(0, Math.min(height, Math.max(rowY0, rowY1)));
  if (xb - xa < PB_MAIN_COUNT * 6 || yb - ya < 6) {
    return { edges: equalWidthEdges(xa, xb, PB_MAIN_COUNT), meta: { method: 'equal_width' } };
  }

  const proj = verticalProjectionInkInRect(gray, width, height, xa, xb, ya, yb, INK_THRESHOLD);

  const vi = valleySplitIndices(proj, PB_MAIN_COUNT);
  if (vi && vi.length === PB_MAIN_COUNT - 1) {
    return { edges: edgesFromValleyIndices(xa, xb, vi), meta: { method: 'valley' } };
  }

  const cc = segmentFromConnectedComponents(gray, width, height, xa, xb, ya, yb);
  if (cc) {
    return { edges: cc, meta: { method: 'components' } };
  }

  const ink = columnEdgesFromEqualInkProjection(proj, xa, xb);
  return { edges: ink, meta: { method: 'equal_ink' } };
}

/** Expand main zone horizontally (retry after invalid parse). Fraction of full image width. */
export function expandMainZoneHorizontally(
  mx0: number,
  mx1: number,
  imgW: number,
  frac: number,
): { mx0: number; mx1: number } {
  const w = mx1 - mx0;
  const dx = Math.round(w * frac);
  return {
    mx0: Math.max(0, mx0 - dx),
    mx1: Math.min(imgW, mx1 + dx),
  };
}
