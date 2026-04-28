/**
 * Powerball ticket recognition — full-image OCR + spatial row grouping.
 */

/** Visual / layout family (not US state name). */
export type PbTemplateFamily = 'ca_wa' | 'tx' | 'ny_il_nj' | 'fl';

export type NormRect = { x0: number; y0: number; x1: number; y1: number };

/** Fuzzy anchors from cheap OCR (text-level). */
export type PbAnchorHints = {
  hasPowerballWord: boolean;
  hasPowerPlay: boolean;
  qpTokenCount: number;
  barcodeLike: boolean;
};

export type MlKitBlock = { text: string; lines?: Array<{ text: string }> };
export type MlKitResult = { text: string; blocks?: MlKitBlock[] };
