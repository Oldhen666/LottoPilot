import { NativeModules, Platform } from 'react-native';

export type YoloBox = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cls: number;
  score: number;
};

type YoloNative = {
  isModelLoaded(): Promise<boolean>;
  detect(uri: string, confThreshold: number, iouThreshold: number): Promise<YoloBox[]>;
};

const native = NativeModules.YoloTflite as YoloNative | undefined;

/**
 * Android only: runs bundled TFLite row detector when `assets/models/powerball_yolov8.tflite` is present.
 * Returns null if unavailable or on non-Android.
 */
export async function detectPowerballYoloBoxes(
  imageUri: string,
  conf = 0.25,
  iou = 0.55,
): Promise<YoloBox[] | null> {
  if (Platform.OS !== 'android' || !native) return null;
  try {
    const loaded = await native.isModelLoaded();
    if (!loaded) return null;
    const raw = await native.detect(imageUri, conf, iou);
    if (!Array.isArray(raw)) return null;
    return raw.map((b) => ({
      x1: Number(b.x1),
      y1: Number(b.y1),
      x2: Number(b.x2),
      y2: Number(b.y2),
      cls: Number(b.cls) | 0,
      score: Number(b.score),
    }));
  } catch {
    return null;
  }
}
