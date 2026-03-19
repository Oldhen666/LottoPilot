/**
 * Parse draw date from ticket image: OCR + robust date normalization.
 * Offline, no image upload.
 * Uses multi-attempt strategy (original, resized, cropped) to improve recognition on angled photos.
 */

import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { getRawOcrText } from './ocr';
import { normalizeDateCandidates } from '../date/normalizeDate';
import type { LotteryId } from '../types/lottery';

export interface ParseTicketDateResult {
  dateISO?: string;
  confidence: number;
  candidates: string[];
  rawText: string;
  needsUserConfirm: boolean;
}

const TARGET_WIDTH = 1200;
const CROP_TOP_RATIO = 0.45; // Date is usually in top 45% of Lotto Max ticket

async function getOcrWithPreprocessing(uri: string): Promise<string[]> {
  const texts: string[] = [];
  const addUnique = (t: string) => {
    if (t?.trim() && !texts.some((x) => x.trim() === t.trim())) texts.push(t.trim());
  };

  const r1 = await getRawOcrText(uri);
  if (r1?.fullText) addUnique(r1.fullText);

  try {
    const resized = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: TARGET_WIDTH } }], {
      compress: 1,
      format: ImageManipulator.SaveFormat.PNG,
    });
    const r2 = await getRawOcrText(resized.uri);
    if (r2?.fullText) addUnique(r2.fullText);

    const cropHeight = Math.floor(resized.height * CROP_TOP_RATIO);
    if (cropHeight >= 100) {
      const cropped = await ImageManipulator.manipulateAsync(
        resized.uri,
        [{ crop: { originX: 0, originY: 0, width: resized.width, height: cropHeight } }],
        { compress: 1, format: ImageManipulator.SaveFormat.PNG }
      );
      const r3 = await getRawOcrText(cropped.uri);
      if (r3?.fullText) addUnique(r3.fullText);
    }
  } catch {
    /* Preprocessing failed, use original only */
  }
  return texts;
}

export async function parseTicketDateFromImage(
  imageUri: string,
  lotteryType: LotteryId
): Promise<ParseTicketDateResult> {
  if (Platform.OS === 'web') {
    return { confidence: 0, candidates: [], rawText: '', needsUserConfirm: false };
  }
  const allTexts = await getOcrWithPreprocessing(imageUri);
  const mergedText = allTexts.join('\n\n');
  if (!mergedText.trim()) {
    return { confidence: 0, candidates: [], rawText: '', needsUserConfirm: false };
  }
  return normalizeDateCandidates(mergedText, lotteryType);
}
