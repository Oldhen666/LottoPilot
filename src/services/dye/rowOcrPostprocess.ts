/**
 * DYE 1.0 — read phase: strip letter/punctuation noise from OCR line text; ordered digit tokens only.
 * Matches Python `ocr_row_postprocess.row_ocr_to_digit_tokens`.
 */
export function rowOcrToDigitTokens(
  rawLine: string,
  maxTokenDigits: number = 2,
  zeroPadSingleDigit: boolean = true,
): { textClean: string; tokens: string[] } {
  const s = rawLine?.trim() ?? '';
  if (!s) {
    return { textClean: '', tokens: [] };
  }
  const parts = s.match(/\d+/g) ?? [];
  const tokens: string[] = [];
  for (const p of parts) {
    if (maxTokenDigits > 0 && p.length > maxTokenDigits) continue;
    tokens.push(zeroPadSingleDigit && p.length === 1 ? p.padStart(2, '0') : p);
  }
  return { textClean: tokens.join(' '), tokens };
}

export function rowOcrMainSpecialSplit(
  tokens: string[],
  mainCount: number = 5,
): { main: string[]; special: string | null } {
  if (tokens.length < mainCount) {
    return { main: [...tokens], special: null };
  }
  const main = tokens.slice(0, mainCount);
  const special = tokens.length > mainCount ? tokens[mainCount]! : null;
  return { main, special };
}
