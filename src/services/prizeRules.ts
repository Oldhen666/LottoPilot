/**
 * Load prize rule sets and tiers from Supabase
 * Uses direct REST to avoid Supabase client blocking.
 */
import { loadRuleSetDirect } from './supabase';
import type { PrizeRuleSet, PrizeTier, AddOnRule } from '../types/jurisdiction';

/** Get active rule set for game + jurisdiction, effective on draw_date */
export async function loadRuleSet(
  gameCode: string,
  jurisdictionCode: string,
  drawDate: string
): Promise<{ ruleSet: PrizeRuleSet; tiers: PrizeTier[]; addOns: AddOnRule[] } | null> {
  const result = await loadRuleSetDirect(gameCode, jurisdictionCode, drawDate);
  if (!result) return null;
  return {
    ruleSet: result.ruleSet as PrizeRuleSet,
    tiers: result.tiers as PrizeTier[],
    addOns: result.addOns as AddOnRule[],
  };
}

/** Try NATIONAL fallback when jurisdiction-specific rules not found */
export async function loadRuleSetWithFallback(
  gameCode: string,
  jurisdictionCode: string,
  drawDate: string
): Promise<{
  ruleSet: PrizeRuleSet | null;
  tiers: PrizeTier[];
  addOns: AddOnRule[];
  usedNationalFallback: boolean;
}> {
  const result = await loadRuleSet(gameCode, jurisdictionCode, drawDate);
  if (result) {
    return { ...result, usedNationalFallback: false };
  }
  const country = jurisdictionCode.startsWith('US') ? 'US' : jurisdictionCode.startsWith('CA') ? 'CA' : null;
  const nationalCode = country ? `${country}-NATIONAL` : 'NATIONAL';
  const national = await loadRuleSet(gameCode, nationalCode, drawDate);
  if (national) {
    return { ...national, usedNationalFallback: true };
  }
  const anyNational = await loadRuleSet(gameCode, 'NATIONAL', drawDate);
  if (anyNational) {
    return { ...anyNational, usedNationalFallback: true };
  }
  const gameFallbacks: Record<string, string[]> = {
    lotto_max: ['CA-ON', 'CA-NATIONAL'],
    lotto_649: ['CA-ON', 'CA-NATIONAL'],
    powerball: ['US-NATIONAL'],
    mega_millions: ['US-NATIONAL'],
  };
  const fallbacks = gameFallbacks[gameCode] ?? [];
  for (const code of fallbacks) {
    const fb = await loadRuleSet(gameCode, code, drawDate);
    if (fb) return { ...fb, usedNationalFallback: true };
  }
  return { ruleSet: null, tiers: [], addOns: [], usedNationalFallback: false };
}
