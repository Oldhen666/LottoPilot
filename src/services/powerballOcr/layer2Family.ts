/**
 * Layer 2: template-family classification from visual structure + light OCR hints.
 */
import {
  horizontalProjectionInkInBand,
  meanLocalStdSample,
} from '../ticketPreprocess/pixelOps';
import type { PbTemplateFamily } from './types';

function countProjectionPeaks(proj: Float32Array, minRatio = 0.35): number {
  if (proj.length < 8) return 0;
  let sum = 0;
  let maxV = 0;
  for (let i = 0; i < proj.length; i++) {
    const v = proj[i];
    sum += v;
    if (v > maxV) maxV = v;
  }
  const mean = sum / proj.length;
  const thresh = Math.max(mean * 1.15, minRatio * maxV);
  let peaks = 0;
  for (let i = 2; i < proj.length - 2; i++) {
    const v = proj[i];
    if (v < thresh) continue;
    if (v >= proj[i - 1] && v >= proj[i + 1] && v >= proj[i - 2] && v >= proj[i + 2]) peaks++;
  }
  return peaks;
}

/**
 * Classify layout family without relying on state name OCR.
 * `quickOcrText` is optional first-pass text for QP / PB keywords.
 */
export function classifyPbTemplateFamily(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
  quickOcrText?: string,
): PbTemplateFamily {
  const t = (quickOcrText ?? '').replace(/\s+/g, ' ');
  const qpMatches = t.match(/\bQP\b/gi);
  const qpCount = qpMatches?.length ?? 0;
  if (qpCount >= 2) {
    return 'ny_il_nj';
  }

  const xR0 = Math.floor(width * 0.72);
  const xR1 = width;
  const bandProj = horizontalProjectionInkInBand(gray, width, height, xR0, xR1);
  const peaks = countProjectionPeaks(bandProj);
  const narrowBand = horizontalProjectionInkInBand(gray, width, height, Math.floor(width * 0.88), width);
  const narrowPeaks = countProjectionPeaks(narrowBand);

  if (narrowPeaks >= 4 && peaks >= 5) {
    return 'tx';
  }

  const stdMid = meanLocalStdSample(
    gray,
    width,
    height,
    Math.floor(width * 0.15),
    Math.floor(height * 0.12),
    Math.floor(width * 0.85),
    Math.floor(height * 0.88),
    5,
  );
  if (stdMid > 32 && /\bPB\s*\d{1,2}\b/i.test(t)) {
    return 'fl';
  }
  if (stdMid > 38) {
    return 'fl';
  }

  return 'ca_wa';
}
