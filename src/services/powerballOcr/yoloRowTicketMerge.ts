/**
 * Optional DYE path: YOLO row boxes → per-row ML Kit OCR → parsePowerballRowWithFamily, merged if score improves.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import type { ParsedTicket } from '../ocr';
import { scoreParsedTicket } from '../ocr';
import { getTicketImagePixelSize, recognizeTicketText } from './mlkitRecognize';
import { parsePowerballRowWithFamily } from './usParseLine';
import type { PbTemplateFamily } from './types';
import { detectPowerballYoloBoxes, type YoloBox } from './yoloTflite';

const ROW_CLS = 0;

function rowCenterY(b: YoloBox): number {
  return (b.y1 + b.y2) / 2;
}

function expandBox(
  b: YoloBox,
  w: number,
  h: number,
  padXFrac: number,
  padYFrac: number,
): { x1: number; y1: number; x2: number; y2: number } {
  const bw = b.x2 - b.x1;
  const bh = b.y2 - b.y1;
  const px = bw * padXFrac;
  const py = bh * padYFrac;
  return {
    x1: Math.max(0, Math.floor(b.x1 - px)),
    y1: Math.max(0, Math.floor(b.y1 - py)),
    x2: Math.min(w, Math.ceil(b.x2 + px)),
    y2: Math.min(h, Math.ceil(b.y2 + py)),
  };
}

/** Build a Powerball ticket from row crops when TFLite + OCR succeed. */
export async function tryTicketFromYoloRowCrops(
  ocrUri: string,
  family: PbTemplateFamily | undefined,
  options: {
    mainCount: number;
    mainMax: number;
    specialMin: number;
    specialMax: number;
    playsPerTicket: number;
  },
): Promise<ParsedTicket | null> {
  if (!family) return null;
  const boxes = await detectPowerballYoloBoxes(ocrUri);
  if (!boxes?.length) return null;

  const dim = await getTicketImagePixelSize(ocrUri);
  if (!dim || dim.w < 32 || dim.h < 32) return null;

  const rows = boxes.filter((b) => b.cls === ROW_CLS).sort((a, b) => rowCenterY(a) - rowCenterY(b));
  if (rows.length === 0) return null;

  const allSets: number[][] = [];
  const specialsPerLine: number[] = [];
  const linesText: string[] = [];

  for (const row of rows.slice(0, options.playsPerTicket + 2)) {
    const r = expandBox(row, dim.w, dim.h, 0.02, 0.08);
    const cw = Math.max(1, r.x2 - r.x1);
    const ch = Math.max(1, r.y2 - r.y1);
    try {
      const cropped = await ImageManipulator.manipulateAsync(
        ocrUri,
        [{ crop: { originX: r.x1, originY: r.y1, width: cw, height: ch } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
      );
      const ml = await recognizeTicketText(cropped.uri);
      if (cropped.uri !== ocrUri) {
        try {
          const { deleteUriIfLocal } = await import('../ticketPreprocess/codec');
          await deleteUriIfLocal(cropped.uri);
        } catch {
          /* ignore */
        }
      }
      const line = (ml.text ?? '').replace(/\s+/g, ' ').trim();
      if (!line) continue;
      linesText.push(line);
      const parsed = parsePowerballRowWithFamily(line, family);
      if (parsed.main.length > 0) {
        allSets.push(parsed.main);
        specialsPerLine.push(parsed.special ?? 0);
      }
    } catch {
      /* skip row */
    }
  }

  if (allSets.length === 0) return null;

  const trimTo = Math.min(allSets.length, options.playsPerTicket);
  const useSets = allSets.slice(0, trimTo);
  const useSpecials = specialsPerLine.slice(0, trimTo);

  return {
    mainNumbers: useSets[0] ?? [],
    allSets: useSets,
    specialsPerLine: useSpecials.some((n) => n > 0) ? useSpecials : undefined,
    confidence: 0.75,
    rawText: linesText.join('\n'),
  };
}

export function preferYoloRowTicket(
  base: ParsedTicket | null,
  yolo: ParsedTicket | null,
  mainCount: number,
  mainMax: number,
): ParsedTicket | null {
  if (!yolo) return base;
  const sy = scoreParsedTicket(yolo, mainCount, mainMax);
  const sb = scoreParsedTicket(base, mainCount, mainMax);
  if (sy > sb + 1) return yolo;
  return base;
}
