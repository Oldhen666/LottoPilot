/**
 * Heuristic scores for picking the best OCR among preprocess variants per cell (no ML Kit confidence).
 */
import { PB_MAIN_MAX, PB_SPECIAL_MAX, PB_SPECIAL_MIN } from './constants';
import { extractFlPowerballToken } from './usParseLine';

/** Main play cell: prefer one clean 1–69 token. */
export function scoreMainCellOcr(text: string): number {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return -1000;
  const compact = t.replace(/[^\d]/g, '');
  if (compact.length > 4) return -40;
  const nums = t.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
  const inMain = nums.filter((n) => n >= 1 && n <= PB_MAIN_MAX);
  let s = 0;
  if (inMain.length === 1) {
    s += 45;
    if (/^\d{1,2}$/.test(t.replace(/\s/g, ''))) s += 25;
  } else if (inMain.length >= 2) {
    s += 8;
  } else {
    s -= 35;
  }
  if (t.length > 12) s -= 20;
  if (/[a-zA-Z]{3,}/.test(t)) s -= 15;
  return s;
}

/** Powerball / special column: 1–26, optional FL "PB 12". */
export function scorePbCellOcr(text: string): number {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return -1000;
  const fl = extractFlPowerballToken(t);
  if (fl != null) return 70;
  const nums = t.match(/\b\d{1,2}\b/g)?.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n)) ?? [];
  const inSp = nums.filter((n) => n >= PB_SPECIAL_MIN && n <= PB_SPECIAL_MAX);
  let s = 0;
  if (inSp.length === 1) {
    s += 50;
    if (/^\d{1,2}$/.test(t.replace(/\s/g, ''))) s += 20;
  } else if (inSp.length >= 2) {
    s += 10;
  } else {
    s -= 30;
  }
  if (t.length > 14) s -= 15;
  if (/[a-zA-Z]{4,}/.test(t) && fl == null) s -= 10;
  return s;
}
