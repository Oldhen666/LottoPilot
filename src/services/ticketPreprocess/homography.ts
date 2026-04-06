/**
 * Perspective homography from 4 src points to 4 dst points + bilinear warp (grayscale).
 */
import { solveLinear8 } from './linearAlgebra';
import type { Pt } from './convexHull';

/** h11..h32 with h33=1, maps (x,y) src -> dst homogeneous */
export function computeHomography(src: Pt[], dst: Pt[]): number[] | null {
  if (src.length !== 4 || dst.length !== 4) return null;
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  return solveLinear8(A, b);
}

export function homographyTo3x3(h: number[]): number[][] {
  return [
    [h[0]!, h[1]!, h[2]!],
    [h[3]!, h[4]!, h[5]!],
    [h[6]!, h[7]!, 1],
  ];
}

export function invert3x3(m: number[][]): number[][] | null {
  const a =
    m[0][0]! * (m[1][1]! * m[2][2]! - m[2][1]! * m[1][2]!) -
    m[0][1]! * (m[1][0]! * m[2][2]! - m[1][2]! * m[2][0]!) +
    m[0][2]! * (m[1][0]! * m[2][1]! - m[2][0]! * m[1][1]!);
  if (Math.abs(a) < 1e-12) return null;
  const invdet = 1 / a;
  const out: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  out[0][0] = (m[1][1]! * m[2][2]! - m[2][1]! * m[1][2]!) * invdet;
  out[0][1] = (m[0][2]! * m[2][1]! - m[0][1]! * m[2][2]!) * invdet;
  out[0][2] = (m[0][1]! * m[1][2]! - m[0][2]! * m[1][1]!) * invdet;
  out[1][0] = (m[1][2]! * m[2][0]! - m[1][0]! * m[2][2]!) * invdet;
  out[1][1] = (m[0][0]! * m[2][2]! - m[0][2]! * m[2][0]!) * invdet;
  out[1][2] = (m[1][0]! * m[0][2]! - m[0][0]! * m[1][2]!) * invdet;
  out[2][0] = (m[1][0]! * m[2][1]! - m[2][0]! * m[1][1]!) * invdet;
  out[2][1] = (m[0][1]! * m[2][0]! - m[0][0]! * m[2][1]!) * invdet;
  out[2][2] = (m[0][0]! * m[1][1]! - m[1][0]! * m[0][1]!) * invdet;
  return out;
}

function applyHomography(H: number[][], x: number, y: number): { x: number; y: number; w: number } {
  const w = H[2]![0]! * x + H[2]![1]! * y + H[2]![2]!;
  const xp = H[0]![0]! * x + H[0]![1]! * y + H[0]![2]!;
  const yp = H[1]![0]! * x + H[1][1]! * y + H[1][2]!;
  return { x: xp, y: yp, w };
}

function sampleBilinear(gray: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
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

/** Inverse-map dst grid to src; InvH maps dst -> src */
export function warpPerspectiveGray(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  InvH: number[][],
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh);
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const p = applyHomography(InvH, dx, dy);
      if (Math.abs(p.w) < 1e-9) {
        out[dy * dw + dx] = 255;
        continue;
      }
      const sx = p.x / p.w;
      const sy = p.y / p.w;
      out[dy * dw + dx] = sampleBilinear(src, sw, sh, sx, sy);
    }
  }
  return out;
}
