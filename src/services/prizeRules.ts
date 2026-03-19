/**
 * Load prize rule sets and tiers from Supabase
 * Uses shared client to avoid multiple GoTrueClient instances.
 */
import { getSupabaseClient } from './supabase';
import type { PrizeRuleSet, PrizeTier, AddOnRule } from '../types/jurisdiction';

/** Get active rule set for game + jurisdiction, effective on draw_date */
export async function loadRuleSet(
  gameCode: string,
  jurisdictionCode: string,
  drawDate: string
): Promise<{ ruleSet: PrizeRuleSet; tiers: PrizeTier[]; addOns: AddOnRule[] } | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data: sets, error: setsErr } = await supabase
    .from('prize_rule_sets')
    .select('*')
    .eq('game_code', gameCode)
    .eq('jurisdiction_code', jurisdictionCode)
    .eq('is_active', true)
    .lte('effective_from', drawDate)
    .or(`effective_to.is.null,effective_to.gte.${drawDate}`)
    .order('effective_from', { ascending: false })
    .limit(1);

  if (setsErr || !sets?.length) return null;
  const ruleSet = sets[0] as PrizeRuleSet;

  const { data: tiers, error: tiersErr } = await supabase
    .from('prize_tiers')
    .select('*')
    .eq('rule_set_id', ruleSet.id)
    .order('sort_order', { ascending: true });

  if (tiersErr) return null;

  const { data: addOns, error: addOnsErr } = await supabase
    .from('add_on_rules')
    .select('*')
    .eq('rule_set_id', ruleSet.id);

  if (addOnsErr) return null;

  return {
    ruleSet,
    tiers: (tiers || []) as PrizeTier[],
    addOns: (addOns || []) as AddOnRule[],
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
