/**
 * Add-on result computation (EXTRA, ENCORE, TAG, Power Play, Double Play, etc.)
 */
import type { AddOnsSelected, AddOnsInputs, AddOnResults } from '../types/addOn';

export interface DrawWithAddOns {
  draw_date: string;
  winning_numbers: number[];
  special_numbers?: number[];
  extra_number?: string | null;
  encore_number?: string | null;
  tag_number?: string | null;
  power_play_multiplier?: number | null;
  double_play_numbers_json?: number[] | null;
  maxmillions_numbers_json?: string[] | null;
  mega_multiplier?: number | null;
}

function matchDigitsRightToLeft(user: string, winning: string): number {
  let matched = 0;
  const u = user.padStart(7, '0').slice(-7);
  const w = winning.padStart(7, '0').slice(-7);
  for (let i = 6; i >= 0; i--) {
    if (u[i] === w[i]) matched++;
    else break;
  }
  return matched;
}

function matchDigitsPosition(user: string, winning: string, len = 7): number {
  let matched = 0;
  const u = user.padStart(len, '0').slice(-len);
  const w = winning.padStart(len, '0').slice(-len);
  for (let i = 0; i < len; i++) {
    if (u[i] === w[i]) matched++;
  }
  return matched;
}

function tierFromMatchedDigits(matched: number, _direction: 'rightToLeft' | 'position', maxDigits = 7): string {
  if (matched >= maxDigits) return 'Jackpot';
  if (matched >= maxDigits - 1) return '$1000';
  if (matched >= maxDigits - 2) return '$100';
  if (matched >= maxDigits - 3) return maxDigits === 6 ? '$20' : '$10';
  if (matched >= maxDigits - 4) return maxDigits === 6 ? '$10' : '$2';
  if (matched >= maxDigits - 5 && maxDigits === 6) return '$2';
  return 'No prize';
}

export function computeExtraResult(
  userNumber: string,
  winningNumber: string | null | undefined
): { user: string; winning: string; matchedDigits: number; prizeText: string } | null {
  if (!winningNumber || !userNumber) return null;
  const u = userNumber.replace(/\D/g, '').slice(-7);
  const w = winningNumber.replace(/\D/g, '').slice(-7);
  if (u.length < 7 || w.length < 7) return null;
  const matched = matchDigitsRightToLeft(u, w);
  return {
    user: u,
    winning: w,
    matchedDigits: matched,
    prizeText: tierFromMatchedDigits(matched, 'rightToLeft'),
  };
}

export function computeEncoreResult(
  userNumber: string,
  winningNumber: string | null | undefined
): { user: string; winning: string; matchedDigits: number; prizeText: string } | null {
  return computeExtraResult(userNumber, winningNumber);
}

/** TAG: 6 digits (Atlantic), position match. Pads to max length for comparison. */
export function computeTagResult(
  userNumber: string,
  winningNumber: string | null | undefined,
  digits = 6
): { user: string; winning: string; matchedDigits: number; prizeText: string } | null {
  if (!winningNumber || !userNumber) return null;
  const u = userNumber.replace(/\D/g, '').slice(-digits).padStart(digits, '0');
  const w = winningNumber.replace(/\D/g, '').slice(-digits).padStart(digits, '0');
  if (u.length < digits || w.length < digits) return null;
  const matched = matchDigitsPosition(u.slice(-digits), w.slice(-digits), digits);
  return {
    user: u,
    winning: w,
    matchedDigits: matched,
    prizeText: tierFromMatchedDigits(matched, 'position', digits),
  };
}

function computeMatch(
  userMain: number[],
  userSpecial: number[] | undefined,
  winningMain: number[],
  winningSpecial: number[] | undefined
): { matchMain: number; matchSpecial: number } {
  const mainSet = new Set(winningMain);
  const specialSet = winningSpecial?.length ? new Set(winningSpecial) : undefined;
  let matchMain = 0;
  for (const n of userMain) if (mainSet.has(n)) matchMain++;
  let matchSpecial = 0;
  if (specialSet && userSpecial?.length) {
    for (const n of userSpecial) if (specialSet.has(n)) matchSpecial++;
  }
  return { matchMain, matchSpecial };
}

export function computeDoublePlayResult(
  userMain: number[],
  userSpecial: number[] | undefined,
  doublePlayNumbers: number[] | null | undefined
): { match_main: number; match_special: number; tier: string; prizeText: string } | null {
  if (!doublePlayNumbers || doublePlayNumbers.length < 5) return null;
  const main = doublePlayNumbers.slice(0, 5);
  const special = doublePlayNumbers.length >= 6 ? [doublePlayNumbers[5]] : undefined;
  const { matchMain, matchSpecial } = computeMatch(userMain, userSpecial, main, special);
  let prizeText = 'No prize';
  if (matchMain === 5 && matchSpecial === 1) prizeText = 'Jackpot';
  else if (matchMain === 5) prizeText = '$1M';
  else if (matchMain === 4 && matchSpecial === 1) prizeText = '$50K';
  else if (matchMain === 4) prizeText = '$100';
  else if (matchMain === 3 && matchSpecial === 1) prizeText = '$100';
  else if (matchMain === 3) prizeText = '$7';
  else if (matchMain === 2 && matchSpecial === 1) prizeText = '$7';
  else if (matchMain === 1 && matchSpecial === 1) prizeText = '$4';
  else if (matchSpecial === 1) prizeText = '$4';
  return {
    match_main: matchMain,
    match_special: matchSpecial,
    tier: `${matchMain} main + ${matchSpecial} PB`,
    prizeText,
  };
}

/** Format 7 main numbers as 2-digit string for Maxmillions comparison (e.g. [3,10,16,17,23,37,48] -> "03101617233748") */
function formatMaxmillionsEntry(main: number[]): string {
  return main.slice(0, 7).map((n) => String(n).padStart(2, '0')).join('');
}

export function computeAddOnResults(
  addOnsSelected: AddOnsSelected | undefined,
  addOnsInputs: AddOnsInputs | undefined,
  draw: DrawWithAddOns,
  userMain: number[],
  userSpecial: number[] | undefined,
  /** Override for TAG when from alc_tag draw (nightly companion). */
  tagNumber?: string | null,
  /** For Maxmillions: user's plays (each 7 numbers). Uses main numbers - customer doesn't select separately. */
  mainPlays?: number[][]
): AddOnResults {
  const results: AddOnResults = {};

  if (addOnsSelected?.EXTRA && addOnsInputs?.EXTRA && draw.extra_number) {
    const r = computeExtraResult(addOnsInputs.EXTRA, draw.extra_number);
    if (r) results.EXTRA = r;
  }

  if (addOnsSelected?.ENCORE && addOnsInputs?.ENCORE && draw.encore_number) {
    const r = computeEncoreResult(addOnsInputs.ENCORE, draw.encore_number);
    if (r) results.ENCORE = r;
  }

  const tagWinning = tagNumber ?? draw.tag_number;
  if (addOnsSelected?.TAG && addOnsInputs?.TAG && tagWinning) {
    const r = computeTagResult(addOnsInputs.TAG, tagWinning, 6);
    if (r) results.TAG = r;
  }

  if (draw.power_play_multiplier != null) {
    results.POWER_PLAY = { multiplier: draw.power_play_multiplier, applied: !!addOnsSelected?.POWER_PLAY };
  }

  if (addOnsSelected?.DOUBLE_PLAY) {
    if (draw.double_play_numbers_json) {
      const arr = Array.isArray(draw.double_play_numbers_json)
        ? draw.double_play_numbers_json
        : (draw.double_play_numbers_json as { main?: number[]; special?: number[] })?.main;
      const r = computeDoublePlayResult(userMain, userSpecial, arr);
      if (r) results.DOUBLE_PLAY = r;
    } else {
      results.DOUBLE_PLAY = { match_main: 0, match_special: 0, tier: '—', prizeText: 'Double Play data not available for this draw. Check powerball.com.' };
    }
  }

  if (draw.maxmillions_numbers_json && mainPlays?.length) {
    const winningList = draw.maxmillions_numbers_json as string[];
    const userList = mainPlays.map((p) => formatMaxmillionsEntry(p));
    const hits: number[] = [];
    const wn = winningList.map((w) => w.replace(/\D/g, ''));
    userList.forEach((u, i) => {
      if (wn.includes(u)) hits.push(i);
    });
    results.MAXMILLIONS = { userList, winningList, hits };
  }

  if (draw.mega_multiplier != null) {
    results.MEGA_MULTIPLIER = { multiplier: draw.mega_multiplier, applied: !!addOnsSelected?.MEGA_MULTIPLIER };
  }

  return results;
}
