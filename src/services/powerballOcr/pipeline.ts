/**
 * Orchestrates layers 1–4 + fallback to legacy full-frame parse when split is weak.
 */
import { Platform } from 'react-native';
import {
  parseMlKitResultToTicket,
  scoreParsedTicket,
  type MlKitResult,
  type ParsedTicket,
  type TicketPreprocessDebugInfo,
} from '../ocr';
import { collectAnchorHintsFromText } from './anchors';
import { PB_MAIN_COUNT } from './constants';
import { classifyPbTemplateFamily } from './layer2Family';
import { runPowerballLayer1 } from './layer1Preprocess';
import { runLayer4SplitRecognition } from './layer4Split';
import { recognizeTicketText } from './mlkitRecognize';
import { copyVariantUrisForDebug } from '../ticketPreprocess/debugCopy';
import type { PbAnchorHints, PbTemplateFamily } from './types';

function emitDiagnosticBundle(
  onDiagnosticBundle: ((info: { folderUri: string; summary: Record<string, unknown> }) => void) | undefined,
  summary: Record<string, unknown>,
  folderUri = '',
): void {
  try {
    onDiagnosticBundle?.({ folderUri, summary });
  } catch {
    /* UI must not break OCR */
  }
}

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
    /** Write per-scan folder under documentDirectory/scan_debug/ (images + summary.json). */
    diagnosticBundle?: boolean;
    onDiagnosticBundle?: (info: { folderUri: string; summary: Record<string, unknown> }) => void;
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

  const layer1 = await runPowerballLayer1(imageUri, {
    includeDocumentDebug: !!options.debugPreprocessPreview,
    diagnosticSnapshots: !!options.diagnosticBundle,
  });
  try {
    if (layer1.width < 32 || layer1.height < 32 || !layer1.variantUris.length) {
      if (options.diagnosticBundle) {
        emitDiagnosticBundle(options.onDiagnosticBundle, {
          ok: false,
          reason: 'layer1_too_small_or_no_variants',
          layer1Width: layer1.width,
          layer1Height: layer1.height,
          variantCount: layer1.variantUris.length,
        });
      }
      return null;
    }

    let family: PbTemplateFamily | undefined;
    let hints: PbAnchorHints | undefined;

    try {
      const quick = await recognizeTicketText(layer1.variantUris[0]!);
      const quickText = quick.text ?? '';

      family = classifyPbTemplateFamily(layer1.gray, layer1.width, layer1.height, quickText);
      hints = collectAnchorHintsFromText(quickText);

      const fullResults = await Promise.all(layer1.variantUris.map((u) => recognizeTicketText(u)));
      let bestFull: ParsedTicket | null = null;
      let bestFullScore = -1;
      let bestMl: MlKitResult | null = null;
      for (let i = 0; i < fullResults.length; i++) {
        const ml = fullResults[i] as MlKitResult;
        const p = parseMlKitResultToTicket(ml, parseOpts);
        const s = scoreParsedTicket(p, options.mainCount, options.mainMax);
        if (s > bestFullScore) {
          bestFullScore = s;
          bestFull = p;
          bestMl = ml;
        }
      }

      const layer4 = await runLayer4SplitRecognition(
        layer1.gray,
        layer1.width,
        layer1.height,
        layer1.variantUris,
        family,
        hints,
      );

      const rows = layer4.rows.filter(
        (r) =>
          r.main.length === PB_MAIN_COUNT &&
          r.special != null &&
          r.special >= 1 &&
          r.special <= options.specialMax,
      );

      let resolved: ParsedTicket | null = null;
      let parseSource: 'layered_split' | 'full_image_fallback' | 'none' = 'none';

      if (rows.length >= 1) {
        const allSets = rows.map((r) => r.main.slice(0, PB_MAIN_COUNT));
        const specialsPerLine = rows.map((r) => (r.special != null && r.special > 0 ? r.special : 0));
        const conf = Math.min(0.94, 0.5 + rows.length * 0.08);
        const rawText = [quickText, bestMl?.text ?? ''].join('\n---\n');
        const layered: ParsedTicket = {
          mainNumbers: allSets[0]!,
          allSets,
          specialsPerLine,
          drawDate: bestFull?.drawDate,
          confidence: conf,
          rawText,
          addOnsDetected: bestFull?.addOnsDetected,
        };
        const sLayer = scoreParsedTicket(layered, options.mainCount, options.mainMax);
        if (bestFull == null || sLayer >= bestFullScore - 2) {
          resolved = layered;
          parseSource = 'layered_split';
        } else {
          resolved = bestFull;
          parseSource = bestFull ? 'full_image_fallback' : 'none';
        }
      } else {
        resolved = bestFull;
        parseSource = bestFull ? 'full_image_fallback' : 'none';
      }

      if (options.diagnosticBundle) {
        try {
          if (!layer1.diagnosticSnapshots) {
            emitDiagnosticBundle(options.onDiagnosticBundle, {
              ok: false,
              reason: 'no_diagnostic_snapshots',
              note: 'Layer1 did not produce diagnosticSnapshots (unexpected if diagnosticBundle was true).',
            });
          } else {
            const { writePowerballScanDiagnosticBundle } = await import('./diagnosticBundle');
            const out = await writePowerballScanDiagnosticBundle({
              originalImageUri: imageUri,
              layer1,
              family,
              hints,
              layer4RowsAll: layer4.rows,
              finalParsed: resolved,
              parseSource,
            });
            if (out && options.onDiagnosticBundle) {
              options.onDiagnosticBundle({ folderUri: out.folderUri, summary: { ...out.summary, ok: true } });
            } else {
              emitDiagnosticBundle(options.onDiagnosticBundle, {
                ok: false,
                reason: 'bundle_write_returned_null',
                parseSource,
              });
            }
          }
        } catch (e) {
          emitDiagnosticBundle(options.onDiagnosticBundle, {
            ok: false,
            reason: 'bundle_write_threw',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return resolved;
    } catch (e) {
      if (options.diagnosticBundle && layer1.diagnosticSnapshots) {
        try {
          const { writePowerballScanDiagnosticBundleMinimal } = await import('./diagnosticBundle');
          const out = await writePowerballScanDiagnosticBundleMinimal({
            originalImageUri: imageUri,
            layer1,
            family,
            hints,
            error: e,
          });
          if (out && options.onDiagnosticBundle) {
            options.onDiagnosticBundle({
              folderUri: out.folderUri,
              summary: { ...out.summary, ok: false, reason: 'pipeline_error' },
            });
          }
        } catch {
          /* ignore */
        }
      }
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
    await layer1.cleanup();
  }
}
