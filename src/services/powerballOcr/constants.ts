/**
 * Set to false to rollback to legacy full-image Powerball OCR only (see ocr.ts).
 */
export const USE_LAYERED_POWERBALL_OCR = true;

export const PB_MAIN_MAX = 69;
export const PB_SPECIAL_MIN = 1;
export const PB_SPECIAL_MAX = 26;
export const PB_MAIN_COUNT = 5;

/** Max full-image variants produced in layer 1. */
export const PB_LAYER1_VARIANTS = 6;

/** How many layer-1 variants participate in split cell OCR (cost control). */
export const PB_SPLIT_VARIANTS = 2;

/** Max play rows to split-OCR. */
export const PB_MAX_PLAY_ROWS = 5;
