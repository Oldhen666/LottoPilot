/**
 * Placeholder for OCR / ticket image parsing.
 * MVP: Manual input only. Architecture预留 parseTicketFromImage 接口.
 * Iteration 2: Integrate expo-image-picker + ML Kit / Tesseract for number extraction.
 */

export interface ParsedTicket {
  mainNumbers: number[];
  specialNumbers?: number[];
  lotteryId?: string;
  confidence: number;
}

/**
 * Parse ticket numbers from image URI.
 * Returns null if parsing fails or feature not yet implemented.
 */
export async function parseTicketFromImage(imageUri: string): Promise<ParsedTicket | null> {
  // TODO: Implement with ML Kit Text Recognition or Tesseract
  // 1. Load image from imageUri
  // 2. Run OCR to extract text
  // 3. Use regex / heuristics to find number sequences matching lottery formats
  // 4. Return ParsedTicket or null
  console.warn('parseTicketFromImage not implemented yet');
  return null;
}
