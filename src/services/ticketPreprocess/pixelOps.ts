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
