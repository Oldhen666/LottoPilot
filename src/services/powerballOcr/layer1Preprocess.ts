/**
 * Layer 1: Powerball — document flatten, trim, coarse play-area band, grayscale + mild CLAHE for full-image OCR.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { deleteUriIfLocal, readJpegUriToRgba, writeGrayAsJpegUri } from '../ticketPreprocess/codec';
import {
  claheGray,
  cropGrayRect,
  gammaGray,
  percentileStretchGray,
  rgbaToGrayscale,
  rgbaToGrayscaleWatermarkFade,
  trimInkBounds,
} from '../ticketPreprocess/pixelOps';
import { flattenDocumentGray } from '../ticketPreprocess/documentFlatten';
import {
  PB_LAYER1_MAX_WIDTH,
  PB_LAYER1_VARIANTS,
  PB_LAYER1_VARIANTS_DOC_SCAN,
  PB_PLAY_BAND_Y0_FRAC,
  PB_PLAY_BAND_Y1_FRAC,
} from './constants';

const MAX_W = PB_LAYER1_MAX_WIDTH;
const TILES = 8;

export type PowerballLayer1 = {
  /** Full frame after flatten (document scan) or trim + play band (camera). */
  gray: Uint8ClampedArray;
  width: number;
  height: number;
  variantUris: string[];
  labels: string[];
  /** Perspective / quad debug JPEGs (not used for OCR variant scoring). */
  documentDebugUris: string[];
  documentDebugLabels: string[];
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
  const y0 = Math.floor(height * PB_PLAY_BAND_Y0_FRAC);
  const y1 = Math.floor(height * PB_PLAY_BAND_Y1_FRAC);
  return cropGrayRect(gray, width, height, 0, y0, width, y1);
}

export async function runPowerballLayer1(
  uri: string,
  options?: { includeDocumentDebug?: boolean; fromDocumentScan?: boolean },
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
    /** Same source as native scanner deskew: only optional small-angle rotate, no second homography. */
    skipPerspective: options?.fromDocumentScan === true,
  });
  gray = flattenOut.gray;
  grayWmFull = flattenOut.grayWm ?? grayWmFull;
  width = flattenOut.width;
  height = flattenOut.height;

  const fromScan = options?.fromDocumentScan === true;

  /** Camera photos: tighten to ink + play band. Scanner: plugin already deskewed/cropped — keep full flatten frame. */
  if (!fromScan) {
    const trimmed = trimInkBounds(gray, width, height);
    gray = trimmed.gray;
    width = trimmed.width;
    height = trimmed.height;
    const inner = suppressHeaderFooterBand(gray, width, height);
    gray = inner.gray;
    width = inner.width;
    height = inner.height;
  }

  /** Mild CLAHE; gamma/levels skipped for document-scan inputs to avoid stacking on scanner enhance. */
  const claheMild = claheGray(gray, width, height, TILES, 2.0);
  const gammaLift = gammaGray(gray, 0.78);
  const levelsSoft = percentileStretchGray(gray, 0.8, 97.5);
  const variantLimit = fromScan ? PB_LAYER1_VARIANTS_DOC_SCAN : PB_LAYER1_VARIANTS;

  const labels: string[] = [];
  const push = async (g: Uint8ClampedArray, label: string, gw: number, gh: number) => {
    const u = await writeGrayAsJpegUri(g, gw, gh, 90);
    tempUris.push(u);
    labels.push(label);
  };

  await push(gray, fromScan ? 'gray_fullframe' : 'gray_trim', width, height);
  await push(claheMild, 'clahe_mild', width, height);
  if (!fromScan) {
    await push(gammaLift, 'gamma_078', width, height);
    await push(levelsSoft, 'levels_soft', width, height);
  }

  const documentDebugUris: string[] = [];
  const documentDebugLabels: string[] = [];
  /** DEV: flattened image before ink trim / band — explains why previews looked unlike deskew on camera path. */
  if (options?.includeDocumentDebug === true && !fromScan) {
    const uRef = await writeGrayAsJpegUri(flattenOut.gray, flattenOut.width, flattenOut.height, 90);
    tempUris.push(uRef);
    documentDebugUris.push(uRef);
    documentDebugLabels.push('gray_after_flatten');
  }
  if (options?.includeDocumentDebug === true && flattenOut.debugStages.length > 0) {
    for (const st of flattenOut.debugStages) {
      const u = await writeGrayAsJpegUri(st.gray, st.width, st.height, 90);
      tempUris.push(u);
      documentDebugUris.push(u);
      documentDebugLabels.push(st.label);
    }
  }

  const cap = Math.min(variantLimit, tempUris.length - documentDebugUris.length);
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
    cleanup: async () => {
      for (const u of tempUris) {
        await revokeOrDelete(u);
      }
    },
  };
}
