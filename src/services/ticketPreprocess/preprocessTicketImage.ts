/**
 * Ticket image preprocessing for OCR: grayscale, CLAHE, background suppression,
 * adaptive threshold + morphology, region-weighted contrast. Lightweight (JS pixels, capped width).
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import type { LotteryId } from '../../types/lottery';
import { deleteUriIfLocal, readJpegUriToRgba, writeGrayAsJpegUri } from './codec';
import {
  adaptiveThreshold,
  blendRegionStronger,
  claheGray,
  gaussianBlurGray,
  morphOpenClose,
  rgbaToGrayscale,
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

export async function preprocessTicketImageForOcr(uri: string, lotteryId: LotteryId): Promise<PreprocessForOcrResult> {
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
  const { width, height } = rgba;
  const gray = rgbaToGrayscale(rgba.data, width, height);

  const rects = getRegionRects(lotteryId);
  const claheMild = claheGray(gray, width, height, TILES, 2.0);
  const claheMainStrong = claheGray(gray, width, height, TILES, 3.1);
  const claheSpec = claheGray(gray, width, height, TILES, 2.4);

  let enhanced = blendRegionStronger(claheMild, claheMainStrong, width, height, rects.main, 0.72);
  enhanced = blendRegionStronger(enhanced, claheSpec, width, height, rects.special, 0.48);

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
  await push(morph, 'adaptive_morph');

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
