/** EXTRA / ENCORE / TAG extraction shared between OCR pipelines — plain TS for testing without RN mocks. */

export interface ParsedAddOns {
  selected: Record<string, boolean>;
  inputs: Record<string, string>;
}

function stripDiacritics(s: string): string {
  try {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return s;
  }
}

/** EXTRA add-on (not ENCORE): Western Canada lottery regions including BC tickets with stylized "extra" logo. */
function isCanadianRegionalExtraJurisdiction(jurisdictionCode: string): boolean {
  return ['CA-BC', 'CA-AB', 'CA-SK', 'CA-MB'].some((j) => jurisdictionCode.startsWith(j));
}

/** OLG prints encore as "OL 4531022" or glued "OL4531022" (no word boundary between L and digits). */
function extractOntarioOlEncoreDigits(text: string): string | null {
  const m =
    text.match(/\b(?:OL|0L)(\d{7})\b/i) ??
    text.match(/(?:^|[^\w])(?:OL|0L)(\d{7})\b/i);
  return m?.[1] ?? null;
}

/** After ENCORE labels, allow any whitespace including newlines before OL + digits. */
function encoreDigitsAfterEncoreLabels(text: string): string | null {
  const olAfterEncore = text.match(/\bENCORE[\s\S]{0,400}?(?:OL|0L)\s*(\d{7})\b/i);
  if (olAfterEncore) return olAfterEncore[1]!;
  const digitsOnly = text.match(/\bENCORE[\s\S]{0,400}?\b(\d{7})\b/);
  return digitsOnly?.[1] ?? null;
}

function tryOntarioEncore(
  text: string,
  lotteryId: string,
  jurisdictionCode: string,
): string | null {
  if (!jurisdictionCode.startsWith('CA-ON')) return null;
  if (lotteryId !== 'lotto_max' && lotteryId !== 'lotto_649') return null;

  // Strong OLG cue: OL prefix + 7 digits (often glued "OL4531022").
  const olDigits = extractOntarioOlEncoreDigits(text);
  if (olDigits) return olDigits;

  const lower = text.toLowerCase();
  const encoreWordHits = (lower.match(/\bencore\b/g) ?? []).length;
  if (encoreWordHits >= 2 || /\bencorej\b/i.test(text)) {
    return encoreDigitsAfterEncoreLabels(text);
  }

  return null;
}

/** Strip trailing YES / noise from EXTRA line. */
function stripExtraYesSuffix(line: string): string {
  return line.replace(/\s*-\s*YES\s*$/i, '').replace(/\s+YES\s*$/i, '').trim();
}

/**
 * BC tickets often print EXTRA as four groups (47 - 73 - 74 - 97); OCR may read "eytra".
 * Normalize to digits-only for storage/comparison (UI can format as NN-NN-NN-NN).
 */
function parseWesternExtraNumberLine(line: string): string | null {
  const cleaned = stripExtraYesSuffix(line.replace(/\s+/g, ' ').trim());
  if (!/\d/.test(cleaned)) return null;
  // Reject obvious draw-date lines (QC often has YYYY-MM-DD close to Extra block).
  if (/\b20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}\b/.test(cleaned)) return null;

  const oneSeven = cleaned.match(/\b(\d{7})\b/);
  if (oneSeven) return oneSeven[1]!;

  // QC often prints the Extra number as 7 single digits (e.g. "2 4 6 8 1 3 5"),
  // and OCR may glue some tail digits (e.g. "2 4 6 8 135"). Prefer exact 7-digit extraction.
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length === 7) return digits;

  const pairs = cleaned.match(/\b\d{1,2}\b/g);
  if (pairs && pairs.length >= 4) {
    return pairs
      .slice(0, 4)
      .map((p) => p.padStart(2, '0'))
      .join('');
  }

  if (digits.length >= 7) return digits.length === 7 ? digits : digits.slice(-7);
  return null;
}

function extractWesternExtraField(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);

  const looksExtraLabel = (line: string) =>
    // OCR variants: extra/etra/eytra + "xtra" or "bxtra" (leading noise char)
    /\b(?:extra|eytra|extea|exfra|etra|xtra|bxtra)\b/i.test(line) || /\b(?:b?xtra|e(?:y|x)?tra)\b/i.test(line);

  for (let i = 0; i < lines.length; i++) {
    if (!looksExtraLabel(lines[i]!)) continue;
    const tail = lines[i]!.replace(/^.*?\b(?:extra|eytra|extea|exfra|etra|xtra|bxtra|b?xtra|e(?:y|x)?tra)\b/i, '').trim();
    if (/\d/.test(tail)) {
      const parsed = parseWesternExtraNumberLine(tail);
      if (parsed) return parsed;
    }
    let best: string | null = null;
    for (let j = i + 1; j < Math.min(i + 14, lines.length); j++) {
      // Skip date / price / disclaimer lines close to the Extra label
      const lj = lines[j]!;
      if (/\b20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}\b/.test(lj)) continue;
      if (/[$€£]|,\d{2}\b/.test(lj)) continue;
      // Avoid mistaking main play lines as Extra: QC slips often have glued 4-digit blocks (e.g. 1924, 3138).
      // If a line contains 4-digit blocks, treat it as a likely play line and skip.
      if (/\b\d{4}\b/.test(lj)) continue;

      const parsed = parseWesternExtraNumberLine(lj);
      if (!parsed) continue;
      // Prefer exact 7-digit Extra (QC style "2 4 6 8 1 3 5" -> 2468135).
      if (parsed.replace(/\D/g, '').length === 7) return parsed;
      if (!best) best = parsed;
    }
    if (best) return best;
  }
  return null;
}

/**
 * Extra add-on data from raw OCR text. Uses lotteryId/jurisdiction to know which add-ons apply.
 */
export function extractAddOnsFromText(
  text: string,
  lotteryId: string,
  jurisdictionCode: string,
): ParsedAddOns | undefined {
  const selected: Record<string, boolean> = {};
  const inputs: Record<string, string> = {};

  // When user hasn't selected a province, Check screen may pass "NATIONAL".
  // Still try to detect explicit EXTRA/TAG cues from OCR text (but keep Ontario ENCORE priority).
  const isNational = jurisdictionCode === 'NATIONAL' || jurisdictionCode.endsWith('-NATIONAL');
  const allowExtraLineGames =
    lotteryId === 'lotto_max' || lotteryId === 'lotto_649'
      ? isCanadianRegionalExtraJurisdiction(jurisdictionCode) || isNational
      : true;

  // Ontario ENCORE first (OL-detached digits do not match plain \b(\d{7})\b).
  const onEncore = tryOntarioEncore(text, lotteryId, jurisdictionCode);
  if (onEncore) {
    selected.ENCORE = true;
    inputs.ENCORE = onEncore;
  }

  // BC / western EXTRA: keyword often misread ("eytra"); number line may be "47- 73 - 74-97 - YES".
  if (
    !selected.ENCORE &&
    !selected.EXTRA &&
    allowExtraLineGames &&
    (lotteryId === 'lotto_max' || lotteryId === 'lotto_649')
  ) {
    const ex = extractWesternExtraField(text);
    if (ex) {
      selected.EXTRA = true;
      inputs.EXTRA = ex;
    }
  }

  const sevenDigitMatches = [...text.matchAll(/\b(\d{7})\b/g)];
  if (!selected.ENCORE && !selected.EXTRA) {
    for (const m of sevenDigitMatches) {
      const num = m[1];
      const idx = m.index!;
      const before = text.slice(Math.max(0, idx - 15), idx);
      const after = text.slice(idx + 7, idx + 25);
      if (/\d-\d{4}-\d$/.test(before) || /^-\d{3}/.test(after)) continue;
      const ctx = text.slice(Math.max(0, idx - 60), idx + 7 + 20).toLowerCase();
      if (/\bencore\b/.test(ctx)) {
        selected.ENCORE = true;
        inputs.ENCORE = num;
        break;
      }
      // EXTRA is Western Canada (BC + prairies); not sold as EXTRA on OLG Ontario slips for these games.
      if (allowExtraLineGames && /\b(?:extra|eytra|extea)\b/i.test(ctx)) {
        selected.EXTRA = true;
        inputs.EXTRA = num;
        break;
      }
    }
  }

  // Prairie provinces: first plausible 7-digit (no ENCORE keyword on slip). Ontario ENCORE must come from
  // OL-prefix or explicit ENCORE context above — never blindly pick a 7-digit (would collide with noise lines).
  if (
    !selected.ENCORE &&
    !selected.EXTRA &&
    sevenDigitMatches.length > 0 &&
    (lotteryId === 'lotto_max' || lotteryId === 'lotto_649') &&
    isCanadianRegionalExtraJurisdiction(jurisdictionCode)
  ) {
    const m = sevenDigitMatches.find((x) => {
      const idx = x.index!;
      const before = text.slice(Math.max(0, idx - 15), idx);
      const after = text.slice(idx + 7, idx + 25);
      return !/\d-\d{4}-\d$/.test(before) && !/^-\d{3}/.test(after);
    });
    if (m) {
      selected.EXTRA = true;
      inputs.EXTRA = m[1];
    }
  }

  // TAG: 6-digit number (ALC Atlantic)
  const sixDigit = text.match(/\b(\d{6})\b/g);
  if (sixDigit) {
    const isAtlantic = ['CA-NB', 'CA-NS', 'CA-NL', 'CA-PE'].some((j) => jurisdictionCode.startsWith(j));
    // OCR common: "TAG" misread as "TAC" (esp. on ALC slips), sometimes with diacritics (e.g. "TẤC").
    // Do NOT hard-depend on region: if the label exists in text, extract it.
    const norm = stripDiacritics(text);
    const hasTagLabel = /\b(?:TAG|TAC)\b/i.test(norm);
    if (isAtlantic || isNational || hasTagLabel) {
      const m = norm.match(/\b(?:TAG|TAC)\b[\s\S]{0,220}?\b(\d{6})\b/i);
      if (m?.[1]) {
        selected.TAG = true;
        inputs.TAG = m[1];
      }
    }
  }

  const lower = text.replace(/\s+/g, ' ').toLowerCase();
  if (lotteryId === 'powerball') {
    if (/\bpower\s*play\b|powerplay\b/i.test(lower)) selected.POWER_PLAY = true;
    if (/\bdouble\s*play\b|doubleplay\b/i.test(lower)) selected.DOUBLE_PLAY = true;
  }

  if (Object.keys(selected).length === 0) return undefined;
  return { selected, inputs };
}
