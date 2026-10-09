/**
 * Powerball: layer1 (document flatten + band) → full-image ML Kit OCR → row layout parse.
 * DYE 1.0 read-phase (digit-only denoise) is applied in usParseLine when parsing play lines.
 */
import { Platform } from 'react-native';
import {
  parseMlKitResultToTicket,
  scoreParsedTicket,
  type MlKitResult,
  type ParsedTicket,
  type TicketPreprocessDebugInfo,
} from '../ocr';
import { classifyPbTemplateFamily } from './layer2Family';
import { runPowerballLayer1 } from './layer1Preprocess';
import { recognizeTicketText, recognizeTicketTextDetailed } from './mlkitRecognize';
import { parseTicketFromLayoutFullImage } from './layoutFullImageOcr';
import { copyVariantUrisForDebug } from '../ticketPreprocess/debugCopy';
import type { PbTemplateFamily } from './types';
import { preferYoloRowTicket, tryTicketFromYoloRowCrops } from './yoloRowTicketMerge';
import { finalizeUsGameSpecialsFromRawText } from './rawTextSpecialFinalize';

export async function runPowerballLayeredPipeline(
  imageUri: string,
  options: {
    mainCount: number;
    mainMax: number;
    specialMin?: number;
    specialMax: number;
    specialCount: number;
    lotteryId?: string;
    jurisdictionCode?: string;
    playsPerTicket?: number;
    debugPreprocessPreview?: (info: TicketPreprocessDebugInfo) => void;
    /** Native document scanner: already deskewed — skip second perspective + lighter photometry. */
    fromDocumentScan?: boolean;
  },
): Promise<ParsedTicket | null> {
  if (Platform.OS === 'web') return null;

  const parseOpts = {
    mainCount: options.mainCount,
    mainMax: options.mainMax,
    specialMin: options.specialMin,
    specialMax: options.specialMax,
    specialCount: options.specialCount,
    lotteryId: options.lotteryId ?? 'powerball',
    jurisdictionCode: options.jurisdictionCode,
    playsPerTicket: options.playsPerTicket ?? 5,
  };
  const plays = parseOpts.playsPerTicket;

  let layer1: Awaited<ReturnType<typeof runPowerballLayer1>>;
  try {
    layer1 = await runPowerballLayer1(imageUri, {
      includeDocumentDebug: !!options.debugPreprocessPreview,
      fromDocumentScan: options.fromDocumentScan === true,
    });
  } catch {
    return null;
  }

  try {
    if (layer1.width < 32 || layer1.height < 32 || !layer1.variantUris.length) {
      return null;
    }

    let family: PbTemplateFamily | undefined;

    try {
      const quick = await recognizeTicketText(layer1.variantUris[0]!);
      const quickText = quick.text ?? '';

      family = classifyPbTemplateFamily(
        layer1.gray,
        layer1.width,
        layer1.height,
        quickText,
        options.jurisdictionCode,
      );

      const fullResults = await Promise.all(layer1.variantUris.map((u) => recognizeTicketText(u)));
      let bestFull: ParsedTicket | null = null;
      let bestFullScore = -1;
      let bestVariantIndex = 0;
      for (let i = 0; i < fullResults.length; i++) {
        const ml = fullResults[i] as MlKitResult;
        const p = parseMlKitResultToTicket(ml, parseOpts);
        const s = scoreParsedTicket(p, options.mainCount, options.mainMax);
        if (s > bestFullScore) {
          bestFullScore = s;
          bestFull = p;
          bestVariantIndex = i;
        }
      }

      const ocrUri = layer1.variantUris[bestVariantIndex]!;
      const detailed = await recognizeTicketTextDetailed(ocrUri);

      const layoutResult = parseTicketFromLayoutFullImage(
        detailed.rawNative,
        family,
        {
          mainCount: options.mainCount,
          mainMax: options.mainMax,
          specialMin: options.specialMin ?? 1,
          specialMax: options.specialMax,
          playsPerTicket: plays,
        },
        { width: layer1.width, height: layer1.height },
      );

      const mlForMerge: MlKitResult = {
        text: detailed.text ?? '',
        blocks: detailed.blocks,
      };
      const fullFromDetailed = parseMlKitResultToTicket(mlForMerge, parseOpts);

      const sLayout = layoutResult.ticket ? scoreParsedTicket(layoutResult.ticket, options.mainCount, options.mainMax) : -1;
      const sFull = fullFromDetailed ? scoreParsedTicket(fullFromDetailed, options.mainCount, options.mainMax) : -1;

      let resolved: ParsedTicket | null = null;

      if (layoutResult.ticket && (sLayout >= sFull - 2 || fullFromDetailed == null)) {
        resolved = { ...layoutResult.ticket };
      } else if (fullFromDetailed) {
        resolved = fullFromDetailed;
      } else if (layoutResult.ticket) {
        resolved = layoutResult.ticket;
      }

      if (resolved && bestFull) {
        resolved.drawDate = resolved.drawDate ?? bestFull.drawDate;
        resolved.addOnsDetected = resolved.addOnsDetected ?? bestFull.addOnsDetected;
      }

      const yoloTicket = await tryTicketFromYoloRowCrops(ocrUri, family, {
        mainCount: options.mainCount,
        mainMax: options.mainMax,
        specialMin: options.specialMin ?? 1,
        specialMax: options.specialMax,
        playsPerTicket: plays,
      });
      resolved = preferYoloRowTicket(resolved, yoloTicket, options.mainCount, options.mainMax);

      if (resolved && bestFull) {
        resolved.drawDate = resolved.drawDate ?? bestFull.drawDate;
        resolved.addOnsDetected = resolved.addOnsDetected ?? bestFull.addOnsDetected;
      }
      if (resolved) {
        const fullImageRaw = [quickText, detailed.text ?? ''].filter(Boolean).join('\n---\n');
        if (yoloTicket && resolved === yoloTicket && (yoloTicket.rawText?.length ?? 0) > 0) {
          resolved.rawText = [fullImageRaw, yoloTicket.rawText].filter(Boolean).join('\n---\n');
        } else {
          resolved.rawText = fullImageRaw;
        }

        resolved = finalizeUsGameSpecialsFromRawText(resolved, 'powerball', options.specialMin ?? 1, options.specialMax);
      }

      return resolved;
    } catch {
      return null;
    }
  } finally {
    if (options.debugPreprocessPreview && layer1.variantUris.length > 0) {
      try {
        const uris = await copyVariantUrisForDebug(layer1.variantUris);
        const docUris =
          layer1.documentDebugUris.length > 0
            ? await copyVariantUrisForDebug(layer1.documentDebugUris)
            : [];
        options.debugPreprocessPreview({
          uris: [...docUris, ...uris],
          labels: [...layer1.documentDebugLabels, ...layer1.labels],
        });
      } catch {
        /* ignore */
      }
    }
    try {
      await layer1.cleanup();
    } catch {
      /* ignore */
    }
  }
}
