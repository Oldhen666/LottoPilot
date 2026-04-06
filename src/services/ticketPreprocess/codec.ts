/**
 * JPEG load/save for preprocessing (expo-file-system/legacy + jpeg-js). Web: fetch + blob.
 */
import './bufferPolyfill';
import {
  cacheDirectory,
  deleteAsync,
  documentDirectory,
  EncodingType,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import { decode, encode } from 'jpeg-js';
import { Platform } from 'react-native';

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(sub) as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const n = binary.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export type RgbaBuffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export async function readJpegUriToRgba(uri: string): Promise<RgbaBuffer> {
  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
  } else {
    const b64 = await readAsStringAsync(uri, {
      encoding: EncodingType.Base64,
    });
    bytes = base64ToUint8(b64);
  }
  const decoded = decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8ClampedArray(decoded.data),
  };
}

export async function writeGrayAsJpegUri(gray: Uint8ClampedArray, width: number, height: number, quality = 88): Promise<string> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const g = gray[i];
    rgba[j] = g;
    rgba[j + 1] = g;
    rgba[j + 2] = g;
    rgba[j + 3] = 255;
  }
  const encoded = encode({ data: rgba, width, height }, quality);
  const raw = encoded.data;
  const outBytes =
    raw instanceof Uint8Array ? raw : new Uint8Array(raw as unknown as ArrayBufferLike);
  if (Platform.OS === 'web') {
    const blob = new Blob([outBytes], { type: 'image/jpeg' });
    return URL.createObjectURL(blob);
  }
  const base = cacheDirectory ?? documentDirectory;
  if (!base) throw new Error('No FileSystem cache directory');
  const path = `${base}lp-ticket-pre-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await writeAsStringAsync(path, uint8ToBase64(outBytes), {
    encoding: EncodingType.Base64,
  });
  return path;
}

/** Crop a sub-rectangle of grayscale image and write JPEG (for per-cell / per-row OCR). */
export async function cropGrayToJpegUri(
  gray: Uint8ClampedArray,
  fullW: number,
  fullH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  quality = 90,
): Promise<string | null> {
  const xa = Math.max(0, Math.min(fullW, Math.min(x0, x1)));
  const ya = Math.max(0, Math.min(fullH, Math.min(y0, y1)));
  const xb = Math.max(0, Math.min(fullW, Math.max(x0, x1)));
  const yb = Math.max(0, Math.min(fullH, Math.max(y0, y1)));
  const w = xb - xa;
  const h = yb - ya;
  if (w < 4 || h < 4) return null;
  const sub = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      sub[y * w + x] = gray[(ya + y) * fullW + (xa + x)];
    }
  }
  return writeGrayAsJpegUri(sub, w, h, quality);
}

export async function deleteUriIfLocal(uri: string): Promise<void> {
  if (Platform.OS === 'web' || !uri.startsWith('file')) return;
  try {
    await deleteAsync(uri, { idempotent: true });
  } catch {
    /* ignore */
  }
}
