/**
 * Ticket boundary: outer quadrilateral from foreground convex hull + perspective warp,
 * or fallback skew rotation; optional debug overlays.
 */
import type { Pt } from './convexHull';
import { convexHull } from './convexHull';
import { computeHomography, homographyTo3x3, invert3x3, warpPerspectiveGray } from './homography';

const DET_MAX_W = 360;
const DST_MAX_W = 960;

function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function quadArea(pts: Pt[]): number {
  if (pts.length < 4) return 0;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % 4]!;
    a += p.x * q.y - p.y * q.x;
  }
  return Math.abs(a) * 0.5;
}

function hullToQuadCorners(hull: Pt[]): Pt[] | null {
  if (hull.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of hull) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const corners: Pt[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  return corners.map((c) => {
    let best = hull[0]!;
    let bd = dist2(best, c);
    for (const p of hull) {
      const d = dist2(p, c);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return { ...best };
  });
}

/** TL, TR, BR, BL: CCW hull order from centroid, then rotate so TL = top-most (min y, then min x). */
function orderQuadTLTRBRBL(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const ccw = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let tlIdx = 0;
  for (let i = 1; i < 4; i++) {
    const p = ccw[i]!;
    const q = ccw[tlIdx]!;
    if (p.y < q.y || (p.y === q.y && p.x < q.x)) tlIdx = i;
  }
  return [0, 1, 2, 3].map((j) => ccw[(tlIdx + j) % 4]!);
}

function validateQuad(pts: Pt[], w: number, h: number): boolean {
  const imgA = w * h;
  const a = quadArea(pts);
  if (a < imgA * 0.1 || a > imgA * 0.96) return false;
  const diag = Math.sqrt(w * w + h * h);
  const edges: number[] = [];
  for (let i = 0; i < 4; i++) {
    edges.push(Math.sqrt(dist2(pts[i]!, pts[(i + 1) % 4]!)));
  }
  const emin = Math.min(...edges);
  const emax = Math.max(...edges);
  if (emin < diag * 0.04 || emax < diag * 0.06) return false;
  if (emax / emin > 6) return false;
  return true;
}

export function downscaleGrayMaxWidth(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  maxW: number,
): { gray: Uint8ClampedArray; w: number; h: number; scaleX: number; scaleY: number } {
  if (w <= maxW) {
    return { gray, w, h, scaleX: 1, scaleY: 1 };
  }
  const nw = maxW;
  const nh = Math.max(1, Math.round((h * maxW) / w));
  const out = new Uint8ClampedArray(nw * nh);
  const sx = w / nw;
  const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const ys = Math.min(h - 1, Math.floor(y * sy));
    for (let x = 0; x < nw; x++) {
      const xs = Math.min(w - 1, Math.floor(x * sx));
      out[y * nw + x] = gray[ys * w + xs]!;
    }
  }
  return { gray: out, w: nw, h: nh, scaleX: w / nw, scaleY: h / nh };
}

function sampleForegroundPoints(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  inkMax: number,
  stride: number,
  cap: number,
): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      if (gray[y * w + x]! < inkMax) pts.push({ x, y });
    }
  }
  if (pts.length <= cap) return pts;
  const step = Math.ceil(pts.length / cap);
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]!);
  return out;
}

function drawQuadOverlay(
  base: Uint8ClampedArray,
  w: number,
  h: number,
  quad: Pt[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length);
  out.set(base);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const n = Math.max(dx, dy, 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      if (x >= 0 && x < w && y >= 0 && y < h) {
        const idx = y * w + x;
        out[idx] = 255;
        if (x + 1 < w) out[y * w + x + 1] = 240;
        if (y + 1 < h) out[(y + 1) * w + x] = 240;
      }
    }
  };
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    line(a.x, a.y, b.x, b.y);
  }
  return out;
}

function sampleBilinearGray(gray: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) return 255;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const a = gray[y0 * w + x0]!;
  const b = gray[y0 * w + x1]!;
  const c = gray[y1 * w + x0]!;
  const d = gray[y1 * w + x1]!;
  return Math.round((1 - fx) * (1 - fy) * a + fx * (1 - fy) * b + (1 - fx) * fy * c + fx * fy * d);
}

/** Rotate grayscale around center; expands canvas to fit. angleDeg positive = CCW. */
export function rotateGrayExpand(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  angleDeg: number,
): { gray: Uint8ClampedArray; width: number; height: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2 - 0.5;
  const cy = h / 2 - 0.5;
  const corners = [
    { x: -cx, y: -cy },
    { x: w - 1 - cx, y: -cy },
    { x: w - 1 - cx, y: h - 1 - cy },
    { x: -cx, y: h - 1 - cy },
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of corners) {
    const rx = cos * c.x - sin * c.y;
    const ry = sin * c.x + cos * c.y;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry);
  }
  const nw = Math.max(1, Math.ceil(maxX - minX));
  const nh = Math.max(1, Math.ceil(maxY - minY));
  const out = new Uint8ClampedArray(nw * nh);
  const invCos = cos;
  const invSin = -sin;
  for (let dy = 0; dy < nh; dy++) {
    for (let dx = 0; dx < nw; dx++) {
      const rx = dx - nw / 2 + 0.5;
      const ry = dy - nh / 2 + 0.5;
      const sx = invCos * rx - invSin * ry + cx;
      const sy = invSin * rx + invCos * ry + cy;
      out[dy * nw + dx] = sampleBilinearGray(gray, w, h, sx, sy);
    }
  }
  return { gray: out, width: nw, height: nh };
}

function horizontalSharpness(gray: Uint8ClampedArray, w: number, h: number): number {
  const rowSums = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += gray[y * w + x]!;
    rowSums[y] = s;
  }
  let acc = 0;
  for (let y = 1; y < h; y++) acc += Math.abs(rowSums[y]! - rowSums[y - 1]!);
  return acc;
}

/** Estimate small skew (degrees) that maximizes horizontal row contrast (ticket lines). */
export function estimateSkewDeg(gray: Uint8ClampedArray, w: number, h: number): number {
  const down = downscaleGrayMaxWidth(gray, w, h, 256);
  let best = 0;
  let bestScore = -1;
  for (let deg = -6; deg <= 6; deg += 0.75) {
    const r = rotateGrayExpand(down.gray, down.w, down.h, deg);
    const sc = horizontalSharpness(r.gray, r.width, r.height);
    if (sc > bestScore) {
      bestScore = sc;
      best = deg;
    }
  }
  return Math.abs(best) < 0.75 ? 0 : best;
}

export type DocumentFlattenMode = 'perspective' | 'skew' | 'none';

export type DocumentFlattenDebugStage = {
  label: string;
  gray: Uint8ClampedArray;
  width: number;
  height: number;
};

export type DocumentFlattenResult = {
  gray: Uint8ClampedArray;
  grayWm: Uint8ClampedArray | null;
  width: number;
  height: number;
  mode: DocumentFlattenMode;
  debugStages: DocumentFlattenDebugStage[];
};

/**
 * Perspective-correct ticket to a front-facing rectangle when a reliable quad is found;
 * otherwise optional small-angle skew; else pass-through.
 */
export function flattenDocumentGray(
  gray: Uint8ClampedArray,
  grayWm: Uint8ClampedArray | null,
  w: number,
  h: number,
  opts?: { includeDebug?: boolean },
): DocumentFlattenResult {
  const includeDebug = opts?.includeDebug === true;
  const debugStages: DocumentFlattenDebugStage[] = [];

  const det = downscaleGrayMaxWidth(gray, w, h, DET_MAX_W);
  const pts = sampleForegroundPoints(det.gray, det.w, det.h, 210, 4, 2200);
  if (pts.length < 40) {
    const skew = estimateSkewDeg(gray, w, h);
    if (Math.abs(skew) < 0.5) {
      return { gray, grayWm, width: w, height: h, mode: 'none', debugStages };
    }
    const rg = rotateGrayExpand(gray, w, h, skew);
    const rwm = grayWm ? rotateGrayExpand(grayWm, w, h, skew) : null;
    if (includeDebug) {
      debugStages.push({ label: 'doc_fallback_skew', gray: rg.gray.slice(), width: rg.width, height: rg.height });
    }
    return {
      gray: rg.gray,
      grayWm: rwm ? rwm.gray : null,
      width: rg.width,
      height: rg.height,
      mode: 'skew',
      debugStages,
    };
  }

  const hull = convexHull(pts);
  const rawQuad = hullToQuadCorners(hull);
  if (!rawQuad || !validateQuad(rawQuad, det.w, det.h)) {
    const skew = estimateSkewDeg(gray, w, h);
    if (Math.abs(skew) < 0.5) {
      return { gray, grayWm, width: w, height: h, mode: 'none', debugStages };
    }
    const rg = rotateGrayExpand(gray, w, h, skew);
    const rwm = grayWm ? rotateGrayExpand(grayWm, w, h, skew) : null;
    if (includeDebug) {
      debugStages.push({ label: 'doc_fallback_skew', gray: rg.gray.slice(), width: rg.width, height: rg.height });
    }
    return {
      gray: rg.gray,
      grayWm: rwm ? rwm.gray : null,
      width: rg.width,
      height: rg.height,
      mode: 'skew',
      debugStages,
    };
  }

  const srcQuad = orderQuadTLTRBRBL(rawQuad).map((p) => ({
    x: p.x * det.scaleX,
    y: p.y * det.scaleY,
  }));

  const top = Math.sqrt(dist2(srcQuad[0]!, srcQuad[1]!));
  const bottom = Math.sqrt(dist2(srcQuad[3]!, srcQuad[2]!));
  const left = Math.sqrt(dist2(srcQuad[0]!, srcQuad[3]!));
  const right = Math.sqrt(dist2(srcQuad[1]!, srcQuad[2]!));
  const avgW = (top + bottom) / 2;
  const avgH = (left + right) / 2;
  let dstW = Math.min(DST_MAX_W, w);
  let dstH = Math.max(1, Math.round(dstW * (avgH / Math.max(avgW, 1))));
  const maxDim = 1400;
  if (dstH > maxDim) {
    const s = maxDim / dstH;
    dstW = Math.max(1, Math.round(dstW * s));
    dstH = maxDim;
  }

  const dst: Pt[] = [
    { x: 0, y: 0 },
    { x: dstW - 1, y: 0 },
    { x: dstW - 1, y: dstH - 1 },
    { x: 0, y: dstH - 1 },
  ];

  const hCoef = computeHomography(srcQuad, dst);
  if (!hCoef) {
    const skew = estimateSkewDeg(gray, w, h);
    if (Math.abs(skew) < 0.5) {
      return { gray, grayWm, width: w, height: h, mode: 'none', debugStages };
    }
    const rg = rotateGrayExpand(gray, w, h, skew);
    const rwm = grayWm ? rotateGrayExpand(grayWm, w, h, skew) : null;
    if (includeDebug) {
      debugStages.push({ label: 'doc_fallback_skew', gray: rg.gray.slice(), width: rg.width, height: rg.height });
    }
    return {
      gray: rg.gray,
      grayWm: rwm ? rwm.gray : null,
      width: rg.width,
      height: rg.height,
      mode: 'skew',
      debugStages,
    };
  }

  const H = homographyTo3x3(hCoef);
  const InvH = invert3x3(H);
  if (!InvH) {
    return { gray, grayWm, width: w, height: h, mode: 'none', debugStages };
  }

  const warped = warpPerspectiveGray(gray, w, h, InvH, dstW, dstH);
  const warpedWm = grayWm ? warpPerspectiveGray(grayWm, w, h, InvH, dstW, dstH) : null;

  if (includeDebug) {
    const ov = drawQuadOverlay(det.gray, det.w, det.h, rawQuad);
    debugStages.push({ label: 'doc_quad_overlay', gray: ov, width: det.w, height: det.h });
    debugStages.push({ label: 'doc_warped', gray: warped.slice(), width: dstW, height: dstH });
  }

  return {
    gray: warped,
    grayWm: warpedWm,
    width: dstW,
    height: dstH,
    mode: 'perspective',
    debugStages,
  };
}
