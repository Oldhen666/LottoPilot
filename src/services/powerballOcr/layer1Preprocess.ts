/**
 * Layer 1: universal preprocessing for Powerball — document flatten (quad + perspective or skew fallback),
 * boundary trim, header/footer suppression, grayscale / CLAHE / adaptive variants, multiple aligned outputs.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { deleteUriIfLocal, readJpegUriToRgba, writeGrayAsJpegUri } from '../ticketPreprocess/codec';
import {
  adaptiveThreshold,
  blendRegionStronger,
  claheGray,
  cropGrayRect,
  gaussianBlurGray,
  highPassSubtractBackground,
  morphOpenClose,
  rgbaToGrayscale,
  rgbaToGrayscaleWatermarkFade,
  subtractBackground,
  trimInkBounds,
} from '../ticketPreprocess/pixelOps';
import { flattenDocumentGray, type DocumentFlattenMode } from '../ticketPreprocess/documentFlatten';
import { getRegionRects } from '../ticketPreprocess/regions';
import { PB_LAYER1_VARIANTS } from './constants';

const MAX_W = 960;
const TILES = 8;

export type PowerballLayer1DiagnosticSnapshots = {
  /** After document flatten, before trim (perspective / skew / pass-through). */
  afterFlatten: {
    gray: Uint8ClampedArray;
    width: number;
    height: number;
    flattenMode: DocumentFlattenMode;
  };
  /** Same pixel grid as row/column detection (after trim + header/footer band). */
  normalizedForRegions: { gray: Uint8ClampedArray; width: number; height: number };
};

export type PowerballLayer1 = {
  /** Grid area after trim + vertical crop (no blind full-frame OCR target). */
  gray: Uint8ClampedArray;
  width: number;
  height: number;
  variantUris: string[];
  labels: string[];
  /** Perspective / quad debug JPEGs (not used for OCR variant scoring). */
  documentDebugUris: string[];
  documentDebugLabels: string[];
  /** Dev diagnostic: intermediate grays (only when diagnosticSnapshots requested). */
  diagnosticSnapshots?: PowerballLayer1DiagnosticSnapshots;
  cleanup: () => Promise<void>;
};

async function revokeOrDelete(uri: string): Promise<void> {
  if (Platform.OS === 'web' && uri.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(uri);
    } catch {
      /* ignore */
    }
    return;
  }
  return deleteUriIfLocal(uri);
}

/**
 * Suppress top header / bottom barcode strip by keeping inner vertical band.
 */
function suppressHeaderFooterBand(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { gray: Uint8ClampedArray; width: number; height: number } {
  const y0 = Math.floor(height * 0.055);
  const y1 = Math.floor(height * 0.93);
  return cropGrayRect(gray, width, height, 0, y0, width, y1);
}

export async function runPowerballLayer1(
  uri: string,
  options?: { includeDocumentDebug?: boolean; diagnosticSnapshots?: boolean },
): Promise<PowerballLayer1> {
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
      gray: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
      variantUris: [workUri],
      labels: ['web_fallback'],
      documentDebugUris: [],
      documentDebugLabels: [],
      diagnosticSnapshots: undefined,
      cleanup: async () => {
        await revokeOrDelete(workUri);
      },
    };
  }

  const rgba = await readJpegUriToRgba(workUri);
  await revokeOrDelete(workUri);
  let { width, height } = rgba;
  let gray = rgbaToGrayscale(rgba.data, width, height);
  let grayWmFull = rgbaToGrayscaleWatermarkFade(rgba.data, width, height);

  const flattenOut = flattenDocumentGray(gray, grayWmFull, width, height, {
    includeDebug: options?.includeDocumentDebug === true,
  });
  gray = flattenOut.gray;
  grayWmFull = flattenOut.grayWm ?? grayWmFull;
  width = flattenOut.width;
  height = flattenOut.height;

  const snapAfterFlatten =
    options?.diagnosticSnapshots === true
      ? {
          gray: flattenOut.gray.slice(),
          width: flattenOut.width,
          height: flattenOut.height,
          flattenMode: flattenOut.mode,
        }
      : undefined;

  const trimmed = trimInkBounds(gray, width, height);
  gray = trimmed.gray;
  const { ox, oy, width: tw, height: th } = trimmed;
  const grayWmCrop = cropGrayRect(grayWmFull, width, height, ox, oy, ox + tw, oy + th).gray;
  width = tw;
  height = th;

  const wBand = width;
  const hBand = height;
  const inner = suppressHeaderFooterBand(gray, wBand, hBand);
  gray = inner.gray;
  width = inner.width;
  height = inner.height;
  const innerWm = suppressHeaderFooterBand(grayWmCrop, wBand, hBand);
  const grayWmBand = innerWm.gray;

  const diagnosticSnapshots: PowerballLayer1DiagnosticSnapshots | undefined =
    options?.diagnosticSnapshots === true && snapAfterFlatten
      ? {
          afterFlatten: snapAfterFlatten,
          normalizedForRegions: { gray: gray.slice(), width, height },
        }
      : undefined;

  const rects = getRegionRects('powerball');
  const claheMild = claheGray(gray, width, height, TILES, 2.0);
  const claheMainStrong = claheGray(gray, width, height, TILES, 3.1);
  const claheSpec = claheGray(gray, width, height, TILES, 2.6);

  let enhanced = blendRegionStronger(claheMild, claheMainStrong, width, height, rects.main, 0.72);
  enhanced = blendRegionStronger(enhanced, claheSpec, width, height, rects.special, 0.52);

  const bgBlur = gaussianBlurGray(gray, width, height, 21, 6);
  const sub = subtractBackground(gray, bgBlur);
  const subClahe = claheGray(sub, width, height, TILES, 1.55);
  const bin = adaptiveThreshold(subClahe, width, height, 31, 4);
  const morph = morphOpenClose(bin, width, height);

  /** Stronger special column for PB crops (full-frame variant). */
  const clahePbBoost = claheGray(gray, width, height, TILES, 3.4);
  const pbBoosted = blendRegionStronger(claheMild, clahePbBoost, width, height, rects.special, 0.85);

  /** CA-style orange seal: de-tint + large-kernel high-pass + CLAHE on main/PB regions (scanner-style). */
  const hpWm = highPassSubtractBackground(grayWmBand, width, height, 55, 14);
  const wmHpClahe = claheGray(hpWm, width, height, TILES, 2.25);
  const wmBaseClahe = claheGray(grayWmBand, width, height, TILES, 2.75);
  let wmExposure = blendRegionStronger(wmHpClahe, wmBaseClahe, width, height, rects.main, 0.62);
  wmExposure = blendRegionStronger(
    wmExposure,
    claheGray(grayWmBand, width, height, TILES, 3.0),
    width,
    height,
    rects.special,
    0.52,
  );

  const labels: string[] = [];
  const push = async (g: Uint8ClampedArray, label: string, gw: number, gh: number) => {
    const u = await writeGrayAsJpegUri(g, gw, gh, 88);
    tempUris.push(u);
    labels.push(label);
  };

  await push(gray, 'gray_trim', width, height);
  await push(wmExposure, 'watermark_fade', width, height);
  await push(enhanced, 'clahe_regions', width, height);
  await push(pbBoosted, 'pb_column_boost', width, height);
  await push(morph, 'adaptive_morph', width, height);
  const claheAlt = claheGray(gray, width, height, TILES, 2.35);
  await push(claheAlt, 'clahe_mid', width, height);

  const documentDebugUris: string[] = [];
  const documentDebugLabels: string[] = [];
  if (options?.includeDocumentDebug === true && flattenOut.debugStages.length > 0) {
    for (const st of flattenOut.debugStages) {
      const u = await writeGrayAsJpegUri(st.gray, st.width, st.height, 88);
      tempUris.push(u);
      documentDebugUris.push(u);
      documentDebugLabels.push(st.label);
    }
  }

  const cap = Math.min(PB_LAYER1_VARIANTS, tempUris.length - documentDebugUris.length);
  const variantUris = tempUris.slice(0, cap);
  const lab = labels.slice(0, cap);

  return {
    gray,
    width,
    height,
    variantUris,
    labels: lab,
    documentDebugUris,
    documentDebugLabels,
    diagnosticSnapshots,
    cleanup: async () => {
      for (const u of tempUris) {
        await revokeOrDelete(u);
      }
    },
  };
}
