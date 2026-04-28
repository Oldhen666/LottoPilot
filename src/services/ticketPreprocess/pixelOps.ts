/**
 * Lightweight grayscale ops: Gaussian blur, CLAHE, adaptive threshold, morphology.
 * No global histogram equalization on full frame — CLAHE is tile-local.
 */

export function rgbaToGrayscale(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const g = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    g[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return g;
}

function makeGaussKernel1d(size: number, sigma: number): Float32Array {
  const k = new Float32Array(size);
  const mid = (size - 1) / 2;
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - mid;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

function convolveH(src: Uint8ClampedArray | Float32Array, width: number, height: number, kernel: Float32Array): Float32Array {
  const k = kernel.length;
  const r = Math.floor(k / 2);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = 0; i < k; i++) {
        const xi = Math.min(width - 1, Math.max(0, x + i - r));
        acc += src[row + xi] * kernel[i];
      }
      out[row + x] = acc;
    }
  }
  return out;
}

function convolveV(src: Float32Array, width: number, height: number, kernel: Float32Array): Float32Array {
  const k = kernel.length;
  const r = Math.floor(k / 2);
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let i = 0; i < k; i++) {
        const yi = Math.min(height - 1, Math.max(0, y + i - r));
        acc += src[yi * width + x] * kernel[i];
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

export function gaussianBlurGray(gray: Uint8ClampedArray, width: number, height: number, kernelSize: number, sigma: number): Float32Array {
  const k = makeGaussKernel1d(kernelSize | 1, sigma);
  const g = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) g[i] = gray[i];
  const h = convolveH(g, width, height, k);
  return convolveV(h, width, height, k);
}

function clipHist(hist: Uint32Array, clipLimit: number, pixelCount: number): void {
  const limit = Math.max(1, Math.floor((clipLimit * pixelCount) / 256));
  let excess = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] > limit) {
      excess += hist[i] - limit;
      hist[i] = limit;
    }
  }
  const add = excess / 256;
  for (let i = 0; i < 256; i++) hist[i] += add;
}

function tileMapping(hist: Uint32Array, pixelCount: number): Uint8Array {
  const cdf = new Float32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
  const cdfMin = cdf[0];
  const denom = pixelCount - cdfMin;
  const map = new Uint8Array(256);
  if (denom <= 0) return map;
  for (let i = 0; i < 256; i++) {
    map[i] = Math.round(((cdf[i] - cdfMin) / denom) * 255);
  }
  return map;
}

/**
 * CLAHE on grayscale. tileCount = tiles per axis (e.g. 8 => 8x8 tiles).
 */
/**
 * Gamma curve on grayscale (gamma < 1 lifts mid-tones, similar to Python deskew preprocess).
 */
export function gammaGray(gray: Uint8ClampedArray, gamma: number): Uint8ClampedArray {
  const g = Math.max(0.2, Math.min(3, gamma));
  const inv = 1 / 255;
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const x = gray[i]! * inv;
    out[i] = Math.round(Math.min(255, Math.max(0, Math.pow(x, g) * 255)));
  }
  return out;
}

/**
 * Percentile stretch (paper toward white) — mirrors Python `_levels_white_background` loosely.
 */
export function percentileStretchGray(
  gray: Uint8ClampedArray,
  pLoPercent: number,
  pHiPercent: number,
): Uint8ClampedArray {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]!]++;
  const total = gray.length;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  const tLo = (total * Math.max(0, Math.min(100, pLoPercent))) / 100;
  const tHi = (total * Math.max(0, Math.min(100, pHiPercent))) / 100;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= tLo) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= total - tHi) {
      hi = v;
      break;
    }
  }
  if (hi <= lo + 1) return gray.slice();
  const out = new Uint8ClampedArray(gray.length);
  const scale = 255 / (hi - lo);
  for (let i = 0; i < gray.length; i++) {
    const v = ((gray[i]! - lo) * scale) | 0;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}

/**
 * Deskew-style background flatten: divide by large-scale illumination estimate.
 * Mirrors Python preprocess_ticket_combined._background_flatten (g / bg * 255).
 */
export function backgroundFlattenDivideGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  blurKernel: number,
  sigma: number,
): Uint8ClampedArray {
  const k = (blurKernel | 1) > 0 ? (blurKernel | 1) : 31;
  // OpenCV GaussianBlur uses sigma=0 as "auto". Our implementation needs sigma>0.
  const s = sigma > 0 ? sigma : Math.max(0.8, k / 6);
  const bg = gaussianBlurGray(gray, width, height, k, s);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const d = Math.max(1, bg[i]!);
    const v = (gray[i]! / d) * 255.0;
    out[i] = v < 0 ? 0 : v > 255 ? 255 : (v + 0.5) | 0;
  }
  return out;
}

/** Minimum filter (grayscale erosion) with small odd kernel. */
export function minimumFilterGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  ksize = 3,
): Uint8ClampedArray {
  const k = Math.max(3, ksize | 1);
  const r = (k - 1) >> 1;
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let mn = 255;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(height - 1, y + r);
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * width;
        for (let xx = x0; xx <= x1; xx++) {
          const v = gray[row + xx]!;
          if (v < mn) mn = v;
          if (mn === 0) break;
        }
        if (mn === 0) break;
      }
      out[y * width + x] = mn;
    }
  }
  return out;
}

/**
 * Photoshop-like "Linear Light" emphasis (approx), blended with opacity.
 * Mirrors preprocess_ticket_combined._blend_linear_light_approx.
 */
export function blendLinearLightApproxGray(
  base: Uint8ClampedArray,
  blend: Uint8ClampedArray,
  opacity = 0.5,
): Uint8ClampedArray {
  const a = Math.max(0, Math.min(1, opacity));
  if (a <= 0) return base.slice();
  const out = new Uint8ClampedArray(base.length);
  for (let i = 0; i < base.length; i++) {
    const b = base[i]! / 255.0;
    const s = blend[i]! / 255.0;
    let lin = b + 2.0 * (s - 0.5);
    if (lin < 0) lin = 0;
    else if (lin > 1) lin = 1;
    const v = (1.0 - a) * b + a * lin;
    out[i] = (v * 255.0 + 0.5) | 0;
  }
  return out;
}

/**
 * Word-like clarity + contrast finish (unsharp + linear gain).
 * Mirrors preprocess_ticket_combined._word_style_clarity_contrast.
 */
export function clarityContrastGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { clarityAmount?: number; brightnessCentered?: number; contrastGain?: number },
): Uint8ClampedArray {
  const clarity = opts?.clarityAmount ?? 1.1;
  const brightness = opts?.brightnessCentered ?? 0.06;
  const gain = opts?.contrastGain ?? 1.28;
  const blur = gaussianBlurGray(gray, width, height, 7, 1.2);
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i]!;
    const high = g - blur[i]!;
    let sharp = g + clarity * high;
    sharp = sharp * gain + brightness * 255.0;
    out[i] = sharp < 0 ? 0 : sharp > 255 ? 255 : (sharp + 0.5) | 0;
  }
  return out;
}

export function claheGray(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  tileCount: number,
  clipLimit: number,
): Uint8ClampedArray {
  const tileW = width / tileCount;
  const tileH = height / tileCount;
  const maps: Uint8Array[] = [];
  for (let ty = 0; ty < tileCount; ty++) {
    for (let tx = 0; tx < tileCount; tx++) {
      const hist = new Uint32Array(256);
      const x0 = Math.floor(tx * tileW);
      const y0 = Math.floor(ty * tileH);
      const x1 = Math.min(width, Math.ceil((tx + 1) * tileW));
      const y1 = Math.min(height, Math.ceil((ty + 1) * tileH));
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          hist[gray[row + x]]++;
          count++;
        }
      }
      clipHist(hist, clipLimit, count);
      maps.push(tileMapping(hist, count));
    }
  }

  const out = new Uint8ClampedArray(gray.length);
  if (tileCount < 2) {
    for (let i = 0; i < gray.length; i++) out[i] = maps[0][gray[i]];
    return out;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = (x + 0.5) / tileW;
      const gy = (y + 0.5) / tileH;
      const tx = Math.min(tileCount - 2, Math.max(0, Math.floor(gx)));
      const ty = Math.min(tileCount - 2, Math.max(0, Math.floor(gy)));
      const wx = gx - tx;
      const wy = gy - ty;
      const v = gray[y * width + x];
      const m00 = maps[ty * tileCount + tx][v];
      const m01 = maps[ty * tileCount + tx + 1][v];
      const m10 = maps[(ty + 1) * tileCount + tx][v];
      const m11 = maps[(ty + 1) * tileCount + tx + 1][v];
      const a = m00 * (1 - wx) + m01 * wx;
      const b = m10 * (1 - wx) + m11 * wx;
      out[y * width + x] = Math.round(a * (1 - wy) + b * wy);
    }
  }
  return out;
}

export function subtractBackground(gray: Uint8ClampedArray, bgBlur: Float32Array): Uint8ClampedArray {
  const n = gray.length;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const d = gray[i] - bgBlur[i] + 128;
    out[i] = d < 0 ? 0 : d > 255 ? 255 : Math.round(d);
  }
  return out;
}

/**
 * Grayscale with warm mid-tones (orange/yellow lottery seals) lifted toward white — similar to scanner "Enhance".
 * Keeps dark strokes (black digits) relatively intact.
 */
export function rgbaToGrayscaleWatermarkFade(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const n = width * height;
  const g = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g0 = rgba[p + 1];
    const b = rgba[p + 2];
    const mn = Math.min(r, g0, b);
    const mx = Math.max(r, g0, b);
    const maxc = mx - mn;
    const l = 0.299 * r + 0.587 * g0 + 0.114 * b;
    let v = l;
    if (maxc > 18 && l > 135 && l < 250) {
      const fade = Math.min(0.72, (maxc / 100) * 0.35 + ((l - 135) / 400) * 0.21);
      v = l + (255 - l) * fade;
    }
    g[i] = Math.round(v < 0 ? 0 : v > 255 ? 255 : v);
  }
  return g;
}

/**
 * High-pass via large Gaussian blur: fades broad watermarks / gradients, keeps strokes (exposure-like).
 */
export function highPassSubtractBackground(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  blurKernel: number,
  sigma: number,
): Uint8ClampedArray {
  const bg = gaussianBlurGray(gray, width, height, blurKernel | 1, sigma);
  return subtractBackground(gray, bg);
}

/**
 * Suppress long, thin vertical strokes (pen marks / scan seams).
 * Heuristic: detect columns with unusually high ink coverage, then inpaint using neighbor columns.
 */
export function suppressLongVerticalStrokes(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  opts?: { inkThreshold?: number; minCoverage?: number; maxCols?: number },
): Uint8ClampedArray {
  const inkTh = opts?.inkThreshold ?? 175;
  const minCov = Math.max(0.1, Math.min(0.95, opts?.minCoverage ?? 0.35));
  const maxCols = Math.max(1, Math.min(width, opts?.maxCols ?? Math.max(6, Math.floor(width * 0.02))));

  const colInk = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x]! < inkTh) colInk[x]! += 1;
    }
  }

  // Pick the worst offenders up to maxCols.
  const candidates: { x: number; c: number }[] = [];
  const minCount = Math.floor(height * minCov);
  for (let x = 0; x < width; x++) {
    const c = colInk[x]!;
    if (c >= minCount) candidates.push({ x, c });
  }
  if (candidates.length === 0) return gray;
  candidates.sort((a, b) => b.c - a.c);
  const chosen = candidates.slice(0, maxCols).map((v) => v.x);
  const mask = new Uint8Array(width);
  for (const x of chosen) mask[x] = 1;

  const out = gray.slice();
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (const x of chosen) {
      // Inpaint from neighbors (prefer closest non-masked).
      let xl = x - 1;
      while (xl >= 0 && mask[xl]) xl--;
      let xr = x + 1;
      while (xr < width && mask[xr]) xr++;
      const vl = xl >= 0 ? out[row + xl]! : out[row + x]!;
      const vr = xr < width ? out[row + xr]! : out[row + x]!;
      out[row + x] = ((vl + vr) / 2) | 0;
    }
  }
  return out;
}

function integralGray(gray: Uint8ClampedArray, width: number, height: number): Float64Array {
  const W = width + 1;
  const I = new Float64Array(W * (height + 1));
  for (let y = 1; y <= height; y++) {
    for (let x = 1; x <= width; x++) {
      const v = gray[(y - 1) * width + (x - 1)];
      I[y * W + x] = v + I[(y - 1) * W + x] + I[y * W + (x - 1)] - I[(y - 1) * W + (x - 1)];
    }
  }
  return I;
}

function rectSum(
  integ: Float64Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const W = width + 1;
  return integ[y1 * W + x1] - integ[y0 * W + x1] - integ[y1 * W + x0] + integ[y0 * W + x0];
}

/** Sauvola-style local adaptive: compare to local mean, C dampens noise. */
export function adaptiveThreshold(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  blockSize: number,
  c: number,
): Uint8ClampedArray {
  const bs = blockSize | 1;
  const half = (bs - 1) >> 1;
  const integ = integralGray(gray, width, height);
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const y0 = Math.max(0, y - half);
      const x1 = Math.min(width, x + half + 1);
      const y1 = Math.min(height, y + half + 1);
      const area = (x1 - x0) * (y1 - y0);
      const sum = rectSum(integ, width, x0, y0, x1, y1);
      const mean = area > 0 ? sum / area : 0;
      const t = mean - c;
      const v = gray[y * width + x];
      out[y * width + x] = v > t ? 255 : 0;
    }
  }
  return out;
}

function erodeBinary(bin: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bin.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let m = 255;
      for (let dy = -1; dy <= 1 && m === 255; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (bin[(y + dy) * width + x + dx] < 128) {
            m = 0;
            break;
          }
        }
      }
      out[y * width + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    out[y * width] = 0;
    out[y * width + width - 1] = 0;
  }
  for (let x = 0; x < width; x++) {
    out[x] = 0;
    out[(height - 1) * width + x] = 0;
  }
  return out;
}

function dilateBinary(bin: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bin.length);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1 && m < 255; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (bin[(y + dy) * width + x + dx] >= 128) {
            m = 255;
            break;
          }
        }
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Opening then closing on binary (255/0). */
export function morphOpenClose(bin: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  let a = erodeBinary(bin, width, height);
  a = dilateBinary(a, width, height);
  a = dilateBinary(a, width, height);
  a = erodeBinary(a, width, height);
  return a;
}

/** Blend stronger local contrast into base in rect (0–1 coords). Soft feather at inner edges. */
/** Dark-pixel count per row (for row band detection). */
export function horizontalProjectionInk(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  inkThreshold = 210,
): Float32Array {
  const proj = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x] < inkThreshold) s += 1;
    }
    proj[y] = s;
  }
  return proj;
}

/** Sum of ink in vertical band [x0, x1) per row — TX-style PB column has strong peaks per row. */
export function horizontalProjectionInkInBand(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  inkThreshold = 210,
): Float32Array {
  const proj = new Float32Array(height);
  const xa = Math.max(0, Math.min(width, x0));
  const xb = Math.max(0, Math.min(width, x1));
  for (let y = 0; y < height; y++) {
    let s = 0;
    const row = y * width;
    for (let x = xa; x < xb; x++) {
      if (gray[row + x] < inkThreshold) s += 1;
    }
    proj[y] = s;
  }
  return proj;
}

/**
 * Copy horizontal band [y0, y1) into a tight buffer height = (y1-y0), width unchanged.
 * Used so row segmentation / ink search never reads pixels from other rows.
 */
export function extractGrayBand(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  y0: number,
  y1: number,
): Uint8ClampedArray {
  const ya = Math.max(0, Math.min(height, Math.min(y0, y1)));
  const yb = Math.max(0, Math.min(height, Math.max(y0, y1)));
  const rh = yb - ya;
  if (rh <= 0 || width <= 0) return new Uint8ClampedArray(0);
  const out = new Uint8ClampedArray(width * rh);
  for (let y = 0; y < rh; y++) {
    const src = (ya + y) * width;
    out.set(gray.subarray(src, src + width), y * width);
  }
  return out;
}

/** Per-column ink sum in axis-aligned rect [x0,x1)×[y0,y1) — for column boundary detection. */
export function verticalProjectionInkInRect(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  inkThreshold = 210,
): Float32Array {
  const xa = Math.max(0, Math.min(width, x0));
  const xb = Math.max(0, Math.min(width, x1));
  const ya = Math.max(0, Math.min(height, y0));
  const yb = Math.max(0, Math.min(height, y1));
  const nw = Math.max(0, xb - xa);
  const proj = new Float32Array(nw);
  for (let xi = 0; xi < nw; xi++) {
    const x = xa + xi;
    let s = 0;
    for (let y = ya; y < yb; y++) {
      if (gray[y * width + x]! < inkThreshold) s += 1;
    }
    proj[xi] = s;
  }
  return proj;
}

/** Local std dev in a window (watermark / noisy background tends to be higher). */
export function meanLocalStdSample(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 4,
): number {
  let sum = 0;
  let count = 0;
  const win = 5;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      let m = 0;
      let n = 0;
      for (let dy = -win; dy <= win; dy++) {
        for (let dx = -win; dx <= win; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          m += gray[yy * width + xx];
          n++;
        }
      }
      if (n === 0) continue;
      m /= n;
      let v = 0;
      for (let dy = -win; dy <= win; dy++) {
        for (let dx = -win; dx <= win; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          const d = gray[yy * width + xx] - m;
          v += d * d;
        }
      }
      sum += Math.sqrt(v / n);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Draw white rectangle outlines (diagnostic: cell crop boxes). x1/y1 exclusive. */
export function drawRectanglesOutline(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  rects: { x0: number; y0: number; x1: number; y1: number }[],
  lineWidth = 2,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray);
  const setPix = (x: number, y: number) => {
    if (x >= 0 && x < width && y >= 0 && y < height) out[y * width + x] = 255;
  };
  for (const r of rects) {
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(r.x0)));
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(r.y0)));
    const x1 = Math.max(x0 + 1, Math.min(width, Math.floor(r.x1)));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.floor(r.y1)));
    const lw = Math.max(1, lineWidth);
    for (let t = 0; t < lw; t++) {
      for (let x = x0; x < x1; x++) {
        setPix(x, y0 + t);
        setPix(x, y1 - 1 - t);
      }
      for (let y = y0; y < y1; y++) {
        setPix(x0 + t, y);
        setPix(x1 - 1 - t, y);
      }
    }
  }
  return out;
}

/** Draw white horizontal rules at given y (row-band diagnostic overlay). */
export function drawHorizontalGuideLines(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  ys: number[],
  lineWidth = 2,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray);
  for (const y0 of ys) {
    for (let dy = 0; dy < lineWidth; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= height) continue;
      for (let x = 0; x < width; x++) {
        out[y * width + x] = 255;
      }
    }
  }
  return out;
}

/**
 * Trim to tight ink bounds (ticket boundary heuristic). Returns new buffer + offset for coordinate mapping.
 */
export function trimInkBounds(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  inkThreshold = 218,
  minPad = 4,
): { gray: Uint8ClampedArray; width: number; height: number; ox: number; oy: number } {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < inkThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX >= maxX || minY >= maxY) {
    return { gray, width, height, ox: 0, oy: 0 };
  }
  minX = Math.max(0, minX - minPad);
  minY = Math.max(0, minY - minPad);
  maxX = Math.min(width - 1, maxX + minPad);
  maxY = Math.min(height - 1, maxY + minPad);
  const nw = maxX - minX + 1;
  const nh = maxY - minY + 1;
  const out = new Uint8ClampedArray(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      out[y * nw + x] = gray[(minY + y) * width + (minX + x)];
    }
  }
  return { gray: out, width: nw, height: nh, ox: minX, oy: minY };
}

/** Crop gray to axis-aligned rect (pixel coords, inclusive-exclusive). */
export function cropGrayRect(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { gray: Uint8ClampedArray; width: number; height: number } {
  const xa = Math.max(0, Math.min(width, Math.min(x0, x1)));
  const ya = Math.max(0, Math.min(height, Math.min(y0, y1)));
  const xb = Math.max(0, Math.min(width, Math.max(x0, x1)));
  const yb = Math.max(0, Math.min(height, Math.max(y0, y1)));
  const nw = xb - xa;
  const nh = yb - ya;
  if (nw <= 0 || nh <= 0) {
    return { gray: new Uint8ClampedArray(0), width: 0, height: 0 };
  }
  const out = new Uint8ClampedArray(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      out[y * nw + x] = gray[(ya + y) * width + (xa + x)];
    }
  }
  return { gray: out, width: nw, height: nh };
}

export function blendRegionStronger(
  base: Uint8ClampedArray,
  strong: Uint8ClampedArray,
  width: number,
  height: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
  alpha: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(base.length);
  const x0 = Math.floor(rect.x0 * width);
  const x1 = Math.floor(rect.x1 * width);
  const y0 = Math.floor(rect.y0 * height);
  const y1 = Math.floor(rect.y1 * height);
  const feather = Math.max(4, Math.min((x1 - x0) / 8, (y1 - y0) / 8));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x < x0 || x >= x1 || y < y0 || y >= y1) {
        out[i] = base[i];
        continue;
      }
      const dx = Math.min(x - x0, x1 - 1 - x);
      const dy = Math.min(y - y0, y1 - 1 - y);
      const edge = Math.min(dx, dy);
      const t = Math.min(1, edge / feather) * alpha;
      out[i] = Math.round(base[i] * (1 - t) + strong[i] * t);
    }
  }
  return out;
}
