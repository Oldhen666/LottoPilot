import * as ImageManipulator from 'expo-image-manipulator';
import { isSupported as mlkitIsSupported, recognizeText as mlkitRecognizeText } from 'expo-mlkit-ocr';
import { Image, Platform } from 'react-native';
import type { LotteryId } from '../../types/lottery';
import { deleteUriIfLocal, readJpegUriToRgba } from '../ticketPreprocess/codec';
import type { MlKitResult } from './types';

/** Resolve recognizeText across expo-mlkit-ocr export shapes (0.2.x named vs legacy default). */
function resolveMlkitRecognizeText(): (uri: string) => Promise<{ text?: string; blocks?: MlKitResult['blocks'] }> {
  if (typeof mlkitRecognizeText === 'function') {
    return mlkitRecognizeText;
  }
  const mod = require('expo-mlkit-ocr') as {
    recognizeText?: (uri: string) => Promise<{ text?: string; blocks?: MlKitResult['blocks'] }>;
    default?: { recognizeText?: (uri: string) => Promise<{ text?: string; blocks?: MlKitResult['blocks'] }> };
  };
  if (typeof mod.recognizeText === 'function') return mod.recognizeText;
  if (typeof mod.default?.recognizeText === 'function') return mod.default.recognizeText;
  throw new Error('expo-mlkit-ocr: recognizeText is not available (rebuild native app after install)');
}

/** Native ML Kit rejects InputImage when width or height is under 32 (expo-mlkit-ocr error message). */
const ML_KIT_MIN_DIM = 32;
/** Full-slip photos: upscale width so play lines are readable by ML Kit. */
const OCR_TARGET_WIDTH = 1280;
const ML_KIT_CALL_TIMEOUT_MS = 18_000;
const RECOGNIZE_TOTAL_TIMEOUT_MS = 42_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Re-encode scanner / content URIs into app cache so FileSystem + ML Kit can read on release Android builds. */
async function prepareUriForMlKit(uri: string): Promise<{ uri: string; dispose: () => Promise<void> }> {
  if (Platform.OS === 'web') {
    return { uri, dispose: async () => {} };
  }
  const trimmed = uri.trim();
  if (!trimmed) {
    return { uri: trimmed, dispose: async () => {} };
  }
  const candidates: string[] = [];
  const push = (u: string) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };
  push(trimmed);
  if (!trimmed.startsWith('file://') && !trimmed.startsWith('content://')) {
    push(`file://${trimmed}`);
  }
  if (trimmed.startsWith('file://')) {
    push(trimmed.slice('file://'.length));
  }

  const tempToDelete: string[] = [];
  for (const candidate of candidates) {
    try {
      const r = await ImageManipulator.manipulateAsync(candidate, [], {
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      if (r.uri && r.uri !== trimmed) tempToDelete.push(r.uri);
      if (r.width >= ML_KIT_MIN_DIM && r.height >= ML_KIT_MIN_DIM) {
        return {
          uri: r.uri,
          dispose: async () => {
            for (const u of tempToDelete) await deleteUriIfLocal(u);
          },
        };
      }
      const scale = Math.max(ML_KIT_MIN_DIM / Math.max(1, r.width), ML_KIT_MIN_DIM / Math.max(1, r.height));
      const nw = Math.max(ML_KIT_MIN_DIM, Math.ceil(r.width * scale));
      const nh = Math.max(ML_KIT_MIN_DIM, Math.ceil(r.height * scale));
      const r2 = await ImageManipulator.manipulateAsync(
        r.uri,
        [{ resize: { width: nw, height: nh } }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      if (r2.uri !== r.uri) tempToDelete.push(r2.uri);
      return {
        uri: r2.uri,
        dispose: async () => {
          for (const u of tempToDelete) await deleteUriIfLocal(u);
        },
      };
    } catch {
      /* try next candidate form */
    }
  }
  return { uri: trimmed, dispose: async () => {} };
}

/** Tall Lotto Max slips: crop to the number block, then upscale width for ML Kit. */
async function ensureOcrFriendlyResolution(uri: string): Promise<{ uri: string; dispose: () => Promise<void> }> {
  if (Platform.OS === 'web') {
    return { uri, dispose: async () => {} };
  }
  const dim = await getImagePixelDimensions(uri);
  if (!dim) {
    return { uri, dispose: async () => {} };
  }
  const { w, h } = dim;
  const actions: ImageManipulator.Action[] = [];
  if (h / w > 3) {
    const cropY = Math.floor(h * 0.05);
    const cropH = Math.min(h - cropY - 1, Math.max(Math.floor(w * 2.5), Math.floor(h * 0.62)));
    actions.push({
      crop: { originX: 0, originY: cropY, width: w, height: cropH },
    });
  }
  if (w < OCR_TARGET_WIDTH) {
    actions.push({ resize: { width: OCR_TARGET_WIDTH } });
  }
  if (!actions.length) {
    return { uri, dispose: async () => {} };
  }
  try {
    const r = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: 0.94,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return {
      uri: r.uri,
      dispose: async () => {
        if (r.uri !== uri) await deleteUriIfLocal(r.uri);
      },
    };
  } catch {
    return { uri, dispose: async () => {} };
  }
}

function mlKitUriCandidates(uri: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    const t = u.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(uri);
  if (uri.startsWith('file://')) {
    push(uri.slice('file://'.length));
  } else if (!uri.includes('://')) {
    push(`file://${uri}`);
  }
  return out;
}

function pickRicherMlKitResult(a: MlKitResult, b: MlKitResult): MlKitResult {
  const la = (a.text ?? '').trim().length;
  const lb = (b.text ?? '').trim().length;
  return lb > la ? b : a;
}

async function invokeMlKitOnUri(
  recognizeTextFn: (u: string) => Promise<{ text?: string; blocks?: MlKitResult['blocks'] }>,
  uri: string,
  lite: boolean,
): Promise<MlKitResult & { lastError?: string }> {
  let best: MlKitResult = { text: '' };
  let lastError: string | undefined;
  const candidates = lite ? mlKitUriCandidates(uri).slice(0, 1) : mlKitUriCandidates(uri);
  for (const candidate of candidates) {
    try {
      const result = await withTimeout(
        recognizeTextFn(candidate),
        ML_KIT_CALL_TIMEOUT_MS,
        'ML Kit recognizeText',
      );
      const next: MlKitResult = { text: result?.text ?? '', blocks: result?.blocks };
      best = pickRicherMlKitResult(best, next);
      if ((best.text ?? '').trim().length > 48) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[mlkit] recognizeText failed', { candidate: candidate.slice(0, 72), lastError });
      }
    }
  }
  return lastError ? { ...best, lastError } : best;
}

export type OcrUriDiagnostic = {
  isSupported: boolean;
  recognizeTextBound: boolean;
  attempts: Array<{ label: string; uri: string; textLen: number; error?: string }>;
};

/** __DEV__ helper: one-shot native OCR probe (surfaces IMAGE_LOAD_FAILED vs empty recognition). */
export async function diagnoseOcrUri(uri: string): Promise<OcrUriDiagnostic> {
  const recognizeTextFn = resolveMlkitRecognizeText();
  const attempts: OcrUriDiagnostic['attempts'] = [];
  const run = async (label: string, u: string) => {
    try {
      const r = await recognizeTextFn(u);
      attempts.push({ label, uri: u.slice(0, 80), textLen: (r?.text ?? '').trim().length });
    } catch (e) {
      attempts.push({
        label,
        uri: u.slice(0, 80),
        textLen: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };
  await run('raw', uri);
  for (const c of mlKitUriCandidates(uri).slice(1, 3)) {
    await run('candidate', c);
  }
  return {
    isSupported: mlkitIsSupported(),
    recognizeTextBound: typeof recognizeTextFn === 'function',
    attempts,
  };
}

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

export type RecognizeTicketTextOptions = { lotteryId?: LotteryId; /** Skip retries / nested preprocess (used per-variant in ocr.ts). */ lite?: boolean };

async function recognizeTicketTextInner(uri: string, opts?: RecognizeTicketTextOptions): Promise<MlKitResult> {
  const lite = opts?.lite === true;
  const recognizeTextFn = resolveMlkitRecognizeText();
  let best: MlKitResult = { text: '' };

  const enough = (t: MlKitResult) => (t.text ?? '').trim().length >= 16;

  // 1) Scanner file as-is (worked before URI re-encode changes; best for Lotto Max full slips).
  best = pickRicherMlKitResult(best, await invokeMlKitOnUri(recognizeTextFn, uri, false));
  if (enough(best)) return best;

  // 2) Crop tall slips + widen before ML Kit (numbers too small on full-length photo).
  if (!lite) {
    const { uri: friendlyUri, dispose: disposeFriendly } = await ensureOcrFriendlyResolution(uri);
    try {
      const { uri: sizedUri, dispose: disposeSized } = await ensureMlKitMinDimensions(friendlyUri);
      try {
        best = pickRicherMlKitResult(best, await invokeMlKitOnUri(recognizeTextFn, sizedUri, false));
        if (enough(best)) return best;
        best = pickRicherMlKitResult(best, await invokeMlKitOnUri(recognizeTextFn, friendlyUri, false));
        if (enough(best)) return best;
      } finally {
        await disposeSized();
      }
    } finally {
      await disposeFriendly();
    }
  }

  // 3) Re-encode path for Play/Android URI quirks (release builds).
  const { uri: preparedUri, dispose: disposePrepared } = await prepareUriForMlKit(uri);
  try {
    const { uri: sizedUri, dispose: disposeSized } = await ensureMlKitMinDimensions(preparedUri);
    try {
      best = pickRicherMlKitResult(best, await invokeMlKitOnUri(recognizeTextFn, sizedUri, lite));
      if (!enough(best)) {
        best = pickRicherMlKitResult(best, await invokeMlKitOnUri(recognizeTextFn, preparedUri, false));
      }
    } finally {
      await disposeSized();
    }
  } finally {
    await disposePrepared();
  }

  return best;
}

export async function recognizeTicketText(uri: string, opts?: RecognizeTicketTextOptions): Promise<MlKitResult> {
  try {
    return await withTimeout(
      recognizeTicketTextInner(uri, opts),
      RECOGNIZE_TOTAL_TIMEOUT_MS,
      'recognizeTicketText',
    );
  } catch {
    return { text: '' };
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
  const recognizeTextFn = resolveMlkitRecognizeText();
  const { uri: preparedUri, dispose: disposePrepared } = await prepareUriForMlKit(uri);
  const { uri: sizedUri, dispose: disposeSized } = await ensureMlKitMinDimensions(preparedUri);
  try {
    const result = await recognizeTextFn(sizedUri);
    const rawNative = result as unknown;
    return {
      text: result?.text ?? '',
      blocks: result?.blocks,
      confidence: extractConfidenceFromMlKitPayload(rawNative),
      rawNative,
    };
  } finally {
    await disposeSized();
    await disposePrepared();
  }
}
