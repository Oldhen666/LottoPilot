/**
 * Set to false to use legacy single-pass Powerball OCR in ocr.ts (no layer-1 preprocess bundle).
 */
export const USE_LAYERED_POWERBALL_OCR = true;

export const PB_MAIN_MAX = 69;
export const PB_SPECIAL_MIN = 1;
export const PB_SPECIAL_MAX = 26;
export const PB_MAIN_COUNT = 5;

/** Full-image OCR variants from layer 1 (gray + CLAHE + gamma + levels + optional stronger CLAHE cap). */
export const PB_LAYER1_VARIANTS = 4;

/**
 * Document-scanner images: skip heavy photometry stack (plugin already enhances); use with `fromDocumentScan`.
 * Layer1 also skips ink trim + header/footer band on that path so the frame matches scanner deskew.
 */
export const PB_LAYER1_VARIANTS_DOC_SCAN = 2;

/**
 * Coarse vertical band after ink trim: keep almost full play grid (avoid cutting bottom plays).
 * Used for preprocess + diagnostic JSON only.
 */
export const PB_PLAY_BAND_Y0_FRAC = 0.04;
export const PB_PLAY_BAND_Y1_FRAC = 0.988;

/** Max width for OCR JPEG (higher improves small text / lower rows). */
export const PB_LAYER1_MAX_WIDTH = 1200;
