import * as ImageManipulator from 'expo-image-manipulator';
import { Image, Platform } from 'react-native';
import { deleteUriIfLocal, readJpegUriToRgba } from '../ticketPreprocess/codec';
import type { MlKitResult } from './types';

/** Native ML Kit rejects InputImage when width or height is under 32 (expo-mlkit-ocr error message). */
const ML_KIT_MIN_DIM = 32;

/**
 * Reliable pixel size: `Image.getSize` often fails on some `file://` / cache URIs on Android;
 * re-encoding with no transforms still returns width/height from the native pipeline.
 */
/** Pixel size for a ticket image URI (file / content); used by crop helpers and YOLO merge. */
export async function getTicketImagePixelSize(uri: string): Promise<{ w: number; h: number } | null> {
  return getImagePixelDimensions(uri);
}

async function getImagePixelDimensions(uri: string): Promise<{ w: number; h: number } | null> {
  try {
    const dim = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(uri, (width, height) => resolve({ width, height }), reject);
    });
    if (dim.width >= 1 && dim.height >= 1) return { w: dim.width, h: dim.height };
  } catch {
    /* try fallbacks */
  }
  try {
    const r = await ImageManipulator.manipulateAsync(
      uri,
      [],
      { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
    );
    const w = r.width;
    const h = r.height;
    const copyUri = r.uri;
    if (copyUri !== uri) await deleteUriIfLocal(copyUri);
    if (w >= 1 && h >= 1) return { w, h };
  } catch {
    /* ignore */
  }
  try {
    const { width, height } = await readJpegUriToRgba(uri);
    if (width >= 1 && height >= 1) return { w: width, h: height };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Upscales small crops uniformly so both dimensions are at least ML_KIT_MIN_DIM.
 * Returns a temp file when resizing; caller must run `dispose` after OCR (see recognizeTicketText*).
 */
async function ensureMlKitMinDimensions(uri: string): Promise<{ uri: string; dispose: () => Promise<void> }> {
  if (Platform.OS === 'web') {
    return { uri, dispose: async () => {} };
  }
  const dim = await getImagePixelDimensions(uri);
  if (dim == null) {
    return { uri, dispose: async () => {} };
  }
  const { w, h } = dim;
  if (w >= ML_KIT_MIN_DIM && h >= ML_KIT_MIN_DIM) {
    return { uri, dispose: async () => {} };
  }
  if (w < 1 || h < 1) {
    return { uri, dispose: async () => {} };
  }
  const scale = Math.max(ML_KIT_MIN_DIM / w, ML_KIT_MIN_DIM / h);
  const nw = Math.max(ML_KIT_MIN_DIM, Math.ceil(w * scale));
  const nh = Math.max(ML_KIT_MIN_DIM, Math.ceil(h * scale));
  try {
    let out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: nw, height: nh } }],
      { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
    );
    let outUri = out.uri;
    if (out.width < ML_KIT_MIN_DIM || out.height < ML_KIT_MIN_DIM) {
      const s2 = Math.max(ML_KIT_MIN_DIM / out.width, ML_KIT_MIN_DIM / out.height);
      const nw2 = Math.max(ML_KIT_MIN_DIM, Math.ceil(out.width * s2));
      const nh2 = Math.max(ML_KIT_MIN_DIM, Math.ceil(out.height * s2));
      const out2 = await ImageManipulator.manipulateAsync(
        outUri,
        [{ resize: { width: nw2, height: nh2 } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (outUri !== uri) await deleteUriIfLocal(outUri);
      outUri = out2.uri;
    }
    return {
      uri: outUri,
      dispose: async () => {
        if (outUri !== uri) await deleteUriIfLocal(outUri);
      },
    };
  } catch {
    return { uri, dispose: async () => {} };
  }
}

export async function recognizeTicketText(uri: string): Promise<MlKitResult> {
  const ExpoMlkitOcr = require('expo-mlkit-ocr').default;
  const { uri: sizedUri, dispose } = await ensureMlKitMinDimensions(uri);
  try {
    const result = await ExpoMlkitOcr.recognizeText(sizedUri);
    return {
      text: result?.text ?? '',
      blocks: result?.blocks,
    } as MlKitResult;
  } finally {
    await dispose();
  }
}

/** Best-effort confidence from native ML Kit payload (expo-mlkit-ocr shape varies by platform). */
export function extractConfidenceFromMlKitPayload(raw: unknown): number | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  for (const k of ['confidence', 'frameConfidence', 'textConfidence', 'recognitionConfidence']) {
    const v = o[k];
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
  }
  const blocks = o.blocks;
  if (Array.isArray(blocks) && blocks[0] != null) {
    const c = extractConfidenceFromMlKitPayload(blocks[0]);
    if (c != null) return c;
  }
  const lines = o.lines;
  if (Array.isArray(lines) && lines[0] != null) {
    const c = extractConfidenceFromMlKitPayload(lines[0]);
    if (c != null) return c;
  }
  return null;
}

export type MlKitRecognizeDetailed = MlKitResult & {
  confidence: number | null;
  rawNative: unknown;
};

export async function recognizeTicketTextDetailed(uri: string): Promise<MlKitRecognizeDetailed> {
  const ExpoMlkitOcr = require('expo-mlkit-ocr').default;
  const { uri: sizedUri, dispose } = await ensureMlKitMinDimensions(uri);
  try {
    const result = await ExpoMlkitOcr.recognizeText(sizedUri);
    const rawNative = result as unknown;
    return {
      text: result?.text ?? '',
      blocks: result?.blocks,
      confidence: extractConfidenceFromMlKitPayload(rawNative),
      rawNative,
    };
  } finally {
    await dispose();
  }
}
