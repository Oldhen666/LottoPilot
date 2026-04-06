/**
 * Main / PB cell crop rectangles: ink-aware bounds + asymmetric padding (more on the left)
 * to reduce clipping of leading digits (e.g. "15" read as "5").
 */
const INK_THRESHOLD = 218;
/** Expand search window into column gaps (fraction of nominal cell width). */
const SEARCH_PAD_LEFT_FRAC = 0.18;
const SEARCH_PAD_RIGHT_FRAC = 0.1;
/** Padding after ink union (fraction of effective width). */
const PAD_LEFT_FRAC = 0.12;
const PAD_RIGHT_FRAC = 0.08;
/** Retry crop: shift further left + widen (fractions of nominal cell width). */
const RETRY_SHIFT_LEFT_FRAC = 0.22;
const RETRY_WIDTH_SCALE = 1.38;

export type CellCropRect = { x0: number; y0: number; width: number; height: number };

function findInkBoundsInRect(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  xa: number,
  ya: number,
  xb: number,
  yb: number,
  inkThreshold = INK_THRESHOLD,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.min(width, Math.min(xa, xb)));
  const y0 = Math.max(0, Math.min(height, Math.min(ya, yb)));
  const x1 = Math.max(0, Math.min(width, Math.max(xa, xb)));
  const y1 = Math.max(0, Math.min(height, Math.max(ya, yb)));
  let minX = x1;
  let minY = y1;
  let maxX = x0;
  let maxY = y0;
  let found = false;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      if (gray[row + x]! < inkThreshold) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return null;
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}

/**
 * Nominal column [colCx0, colCx1], row [rowY0, rowY1]. Expands search horizontally into gaps,
 * unions ink bounds with nominal column, then applies left-heavy padding.
 */
export function computeMainCellCropRect(
  gray: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  colCx0: number,
  colCx1: number,
  rowY0: number,
  rowY1: number,
  zoneX0: number,
  zoneX1: number,
): CellCropRect {
  const cellW = Math.max(4, colCx1 - colCx0);
  const rowH = Math.max(4, rowY1 - rowY0);
  const xSearch0 = Math.max(zoneX0, Math.floor(colCx0 - cellW * SEARCH_PAD_LEFT_FRAC));
  const xSearch1 = Math.min(zoneX1, Math.ceil(colCx1 + cellW * SEARCH_PAD_RIGHT_FRAC));
  const ink = findInkBoundsInRect(gray, imgW, imgH, xSearch0, rowY0, xSearch1, rowY1);

  let x0 = colCx0;
  let x1 = colCx1;
  if (ink && ink.x1 > ink.x0) {
    x0 = Math.min(colCx0, ink.x0);
    x1 = Math.max(colCx1, ink.x1);
  }

  const effW = Math.max(4, x1 - x0);
  const padL = Math.round(effW * PAD_LEFT_FRAC);
  const padR = Math.round(effW * PAD_RIGHT_FRAC);
  let fx0 = Math.max(zoneX0, x0 - padL);
  let fx1 = Math.min(zoneX1, x1 + padR);
  fx0 = Math.max(0, fx0);
  fx1 = Math.min(imgW, fx1);
  const fy0 = Math.max(0, rowY0);
  const fy1 = Math.min(imgH, rowY1);
  const cw = Math.max(4, fx1 - fx0);
  const ch = Math.max(4, fy1 - fy0);
  return { x0: Math.floor(fx0), y0: Math.floor(fy0), width: cw, height: ch };
}

/** Tight equal-split crop (for debug compare). */
export function computeNominalMainCellCropRect(
  colCx0: number,
  colCx1: number,
  rowY0: number,
  rowY1: number,
  imgW: number,
  imgH: number,
  zoneX0: number,
  zoneX1: number,
): CellCropRect {
  const x0 = Math.max(zoneX0, Math.max(0, colCx0));
  const x1 = Math.min(zoneX1, Math.min(imgW, colCx1));
  const y0 = Math.max(0, rowY0);
  const y1 = Math.min(imgH, rowY1);
  return {
    x0: Math.floor(x0),
    y0: Math.floor(y0),
    width: Math.max(4, Math.floor(x1) - Math.floor(x0)),
    height: Math.max(4, y1 - y0),
  };
}

/** Expanded crop when OCR returns a lone digit for a main cell — shift left and widen. */
export function computeMainCellRetryCropRect(
  gray: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  colCx0: number,
  colCx1: number,
  rowY0: number,
  rowY1: number,
  zoneX0: number,
  zoneX1: number,
): CellCropRect {
  const cellW = Math.max(4, colCx1 - colCx0);
  const shift = Math.round(cellW * RETRY_SHIFT_LEFT_FRAC);
  const targetW = Math.round(cellW * RETRY_WIDTH_SCALE);
  const x0 = Math.max(zoneX0, colCx0 - shift);
  const x1 = Math.min(zoneX1, x0 + targetW);
  const base = computeMainCellCropRect(gray, imgW, imgH, Math.floor(x0), Math.floor(x1), rowY0, rowY1, zoneX0, zoneX1);
  return base;
}

/** Powerball column: same padding idea within [px0, px1]. */
export function computePbCellCropRect(
  gray: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  px0: number,
  px1: number,
  rowY0: number,
  rowY1: number,
): CellCropRect {
  const cellW = Math.max(4, px1 - px0);
  const xSearch0 = Math.max(0, Math.floor(px0 - cellW * SEARCH_PAD_LEFT_FRAC));
  const xSearch1 = Math.min(imgW, Math.ceil(px1 + cellW * SEARCH_PAD_RIGHT_FRAC));
  const ink = findInkBoundsInRect(gray, imgW, imgH, xSearch0, rowY0, xSearch1, rowY1);
  let x0 = px0;
  let x1 = px1;
  if (ink && ink.x1 > ink.x0) {
    x0 = Math.min(px0, ink.x0);
    x1 = Math.max(px1, ink.x1);
  }
  const effW = Math.max(4, x1 - x0);
  const padL = Math.round(effW * PAD_LEFT_FRAC);
  const padR = Math.round(effW * PAD_RIGHT_FRAC);
  let fx0 = Math.max(0, x0 - padL);
  let fx1 = Math.min(imgW, x1 + padR);
  const fy0 = Math.max(0, rowY0);
  const fy1 = Math.min(imgH, rowY1);
  return {
    x0: Math.floor(fx0),
    y0: Math.floor(fy0),
    width: Math.max(4, Math.floor(fx1) - Math.floor(fx0)),
    height: Math.max(4, fy1 - fy0),
  };
}

/** True if raw OCR looks like a single main-ball digit (1–9) — worth retrying with wider left crop. */
export function shouldRetryMainCellOcr(text: string): boolean {
  const t = text.replace(/\s+/g, '').trim();
  if (!t) return false;
  const digits = t.replace(/[^\d]/g, '');
  if (digits.length !== 1) return false;
  const n = parseInt(digits, 10);
  if (isNaN(n) || n < 1 || n > 9) return false;
  return true;
}
