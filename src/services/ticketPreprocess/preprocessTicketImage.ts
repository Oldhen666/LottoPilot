/**
 * Ticket image preprocessing for OCR: grayscale, CLAHE, background suppression,
 * adaptive threshold + morphology, region-weighted contrast. Lightweight (JS pixels, capped width).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import type { LotteryId } from '../../types/lottery';
import { deleteUriIfLocal, readJpegUriToRgba, writeGrayAsJpegUri } from './codec';
import { flattenDocumentGray } from './documentFlatten';
import {
  adaptiveThreshold,
  backgroundFlattenDivideGray,
  blendRegionStronger,
  blendLinearLightApproxGray,
  claheGray,
  clarityContrastGray,
  gaussianBlurGray,
  highPassSubtractBackground,
  minimumFilterGray,
  morphOpenClose,
  percentileStretchGray,
  rgbaToGrayscale,
  rgbaToGrayscaleWatermarkFade,
  subtractBackground,
} from './pixelOps';
import { getRegionRects } from './regions';

const MAX_W = 960;
const TILES = 8;

export type PreprocessForOcrResult = {
  variantUris: string[];
  labels: string[];
  cleanup: () => Promise<void>;
};

function revokeOrDelete(uri: string): Promise<void> {
  if (Platform.OS === 'web' && uri.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(uri);
    } catch {
      /* ignore */
    }
    return Promise.resolve();
  }
  return deleteUriIfLocal(uri);
}

export async function preprocessTicketImageForOcr(
  uri: string,
  lotteryId: LotteryId,
  opts?: { fromDocumentScan?: boolean },
): Promise<PreprocessForOcrResult> {
  const tempUris: string[] = [];

  const resized = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_W } }],
    { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
  );
  const workUri = resized.uri;

  if (Platform.OS === 'web') {
    tempUris.push(workUri);
    return {
      variantUris: [workUri],
      labels: ['resized'],
      cleanup: async () => {
        await revokeOrDelete(workUri);
      },
    };
  }

  const rgba = await readJpegUriToRgba(workUri);
  await revokeOrDelete(workUri);
  let { width, height } = rgba;
  let gray = rgbaToGrayscale(rgba.data, width, height);
  const grayWmIn =
    lotteryId === 'powerball' || lotteryId === 'mega_millions'
      ? rgbaToGrayscaleWatermarkFade(rgba.data, width, height)
      : null;
  const flat = flattenDocumentGray(gray, grayWmIn, width, height, {
    includeDebug: false,
    skipPerspective: opts?.fromDocumentScan === true,
  });
  gray = flat.gray;
  const grayWmFlat = flat.grayWm;
  width = flat.width;
  height = flat.height;

  const rects = getRegionRects(lotteryId);

  // Deskew-style photometry baseline (no rotation changes):
  // background flatten (divide), gamma-like curve, CLAHE, percentile levels, min-filter + linear-light emphasis, clarity+contrast.
  // Keep it mild and fast; apply to PB/MM only so we don't fight other ticket styles.
  const isPbMm = lotteryId === 'powerball' || lotteryId === 'mega_millions';
  const deskewBase = isPbMm
    ? backgroundFlattenDivideGray(
        gray,
        width,
        height,
        // Keep kernel modest; too large can wash out thin strokes and hurt OCR.
        31,
        0,
      )
    : gray;

  const claheMild = claheGray(gray, width, height, TILES, 2.0);
  const claheMainStrong = claheGray(gray, width, height, TILES, 3.1);
  const claheSpec = claheGray(gray, width, height, TILES, 2.4);

  let enhanced = blendRegionStronger(claheMild, claheMainStrong, width, height, rects.main, 0.72);
  enhanced = blendRegionStronger(enhanced, claheSpec, width, height, rects.special, 0.48);

  // Nudge CLAHE-based variant toward deskew preprocessing: add levels + mild "linear light" emphasis + clarity.
  if (isPbMm) {
    const x0 = claheGray(deskewBase, width, height, TILES, 2.8);
    const x1 = percentileStretchGray(x0, 0.8, 3.0);
    const mn = minimumFilterGray(x1, width, height, 3);
    const x2 = blendLinearLightApproxGray(x1, mn, 0.5);
    const x3 = clarityContrastGray(x2, width, height, { clarityAmount: 1.1, brightnessCentered: 0.06, contrastGain: 1.28 });
    enhanced = percentileStretchGray(x3, 0.5, 1.5);
  }

  const bgBlur = gaussianBlurGray(gray, width, height, 21, 6);
  const sub = subtractBackground(gray, bgBlur);
  const subClahe = claheGray(sub, width, height, TILES, 1.55);
  const bin = adaptiveThreshold(subClahe, width, height, 31, 4);
  const morph = morphOpenClose(bin, width, height);

  const labels: string[] = [];
  const push = async (g: Uint8ClampedArray, label: string) => {
    const u = await writeGrayAsJpegUri(g, width, height, 88);
    tempUris.push(u);
    labels.push(label);
  };

  await push(gray, 'grayscale');
  await push(enhanced, 'clahe_regions');
  if ((lotteryId === 'powerball' || lotteryId === 'mega_millions') && grayWmFlat) {
    const grayWm = grayWmFlat;
    const hp = highPassSubtractBackground(grayWm, width, height, 51, 12);
    const wmHp = claheGray(hp, width, height, TILES, 2.2);
    const wmBase = claheGray(grayWm, width, height, TILES, 2.65);
    let wmBlend = blendRegionStronger(wmHp, wmBase, width, height, rects.main, 0.6);
    wmBlend = blendRegionStronger(
      wmBlend,
      claheGray(grayWm, width, height, TILES, 2.85),
      width,
      height,
      rects.special,
      0.5,
    );
    await push(wmBlend, 'watermark_fade');
  }
  // `adaptive_morph` tends to "harden" small text/noise into digit-like blobs on Canadian tickets,
  // which often hurts 7/50 line extraction and increases runtime. Keep it for PB/MM only.
  if (lotteryId === 'powerball' || lotteryId === 'mega_millions') {
    await push(morph, 'adaptive_morph');
  }

  return {
    variantUris: tempUris,
    labels,
    cleanup: async () => {
      for (const u of tempUris) {
        await revokeOrDelete(u);
      }
    },
  };
}
