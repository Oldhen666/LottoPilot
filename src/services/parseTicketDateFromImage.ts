/**
 * Parse draw date from ticket image: OCR + robust date normalization.
 * Offline, no image upload.
 * Uses multi-attempt strategy (original, resized, cropped) to improve recognition on angled photos.
 */

import { Platform } from 'react-native';
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

/** Date-only pass: one lite OCR (main ticket parse already ran heavy pipeline). */
async function getOcrForDateFallback(uri: string, lotteryId: LotteryId): Promise<string[]> {
  const r1 = await getRawOcrText(uri, lotteryId);
  if (r1?.fullText?.trim()) return [r1.fullText.trim()];
  return [];
}

export async function parseTicketDateFromImage(
  imageUri: string,
  lotteryType: LotteryId
): Promise<ParseTicketDateResult> {
  if (Platform.OS === 'web') {
    return { confidence: 0, candidates: [], rawText: '', needsUserConfirm: false };
  }
  const allTexts = await getOcrForDateFallback(imageUri, lotteryType);
  const mergedText = allTexts.join('\n\n');
  if (!mergedText.trim()) {
    return { confidence: 0, candidates: [], rawText: '', needsUserConfirm: false };
  }
  return normalizeDateCandidates(mergedText, lotteryType);
}
