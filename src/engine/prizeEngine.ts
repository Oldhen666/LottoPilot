/**
 * Prize Engine: pure function to compute match + estimated prize
 * Input: gameCode, jurisdictionCode, draw, ticket numbers, add-ons
 * Output: matched tiers, estimated prize text, claim URL, disclaimers
 */
import type { DrawWithPrize } from '../types/jurisdiction';
import type { PrizeTier, PrizeEngineOutput, MatchedTier } from '../types/jurisdiction';
import { loadRuleSetWithFallback } from '../services/prizeRules';
import { BUNDLED_TIERS } from '../constants/bundledPrizeTiers';

const DISCLAIMER_ESTIMATE = 'Prize amounts are estimates / informational only. Check official site for actual prize.';

function computeMatch(
  userMain: number[],
  userSpecial: number[] | undefined,
  winningMain: number[],
  winningSpecial: number[] | undefined
): { matchMain: number; matchSpecial: number } {
  const mainSet = new Set(winningMain);
  const specialSet = winningSpecial?.length ? new Set(winningSpecial) : undefined;

  let matchMain = 0;
  for (const n of userMain) {
    if (mainSet.has(n)) matchMain++;
  }

  let matchSpecial = 0;
  if (specialSet && userSpecial?.length) {
    for (const n of userSpecial) {
      if (specialSet.has(n)) matchSpecial++;
    }
  } else if (specialSet) {
    for (const n of userMain) {
      if (specialSet.has(n)) matchSpecial++;
    }
  }

  return { matchMain, matchSpecial };
}

function findMatchingTier(
  tiers: PrizeTier[],
  matchMain: number,
  matchSpecial: number
): PrizeTier | null {
  for (const t of tiers) {
    const mainMatch = t.match_main === matchMain;
    const specialMatch = t.match_special == null || t.match_special === matchSpecial;
    if (mainMatch && specialMatch) return t;
  }
  return null;
}

function formatPrizeText(
  tier: PrizeTier,
  draw: DrawWithPrize,
  addOnsSelected?: Record<string, boolean>,
  multiplierValue?: number
): string {
  switch (tier.prize_type) {
    case 'FIXED':
      if (tier.prize_amount != null) {
        const amt = Number(tier.prize_amount);
        const currency = tier.prize_currency || 'CAD';
        const symbol = currency === 'CAD' ? 'CA$' : '$';
        return `${symbol}${amt.toLocaleString()}`;
      }
      return 'Varies';

    case 'PARI_MUTUEL':
      // Only show jackpot amount for top tier (sort_order 0), not for lower parimutuel tiers
      if (tier.sort_order === 0 && draw.jackpot_amount != null) {
        const amt = Number(draw.jackpot_amount);
        const currency = tier.prize_currency || 'CAD';
        const symbol = currency === 'CAD' ? 'CA$' : '$';
        return `${symbol}${amt.toLocaleString()} (approx)`;
      }
      return 'Varies';

    case 'MULTIPLIER':
      if (tier.multiplier_applicable && multiplierValue != null && (addOnsSelected?.['POWER_PLAY'] || addOnsSelected?.['MEGA_MULTIPLIER'])) {
        const base = tier.prize_amount ?? 0;
        const mult = Number(multiplierValue);
        const result = Math.min(
          Number(tier.max_prize ?? Infinity),
          Math.max(Number(tier.min_prize ?? 0), base * mult)
        );
        const currency = tier.prize_currency || 'CAD';
        const symbol = currency === 'CAD' ? 'CA$' : '$';
        return `${symbol}${result.toLocaleString()} (×${mult})`;
      }
      if (tier.prize_amount != null) {
        const amt = Number(tier.prize_amount);
        const currency = tier.prize_currency || 'CAD';
        const symbol = currency === 'CAD' ? 'CA$' : '$';
        return `${symbol}${amt.toLocaleString()}`;
      }
      return 'Varies';

    case 'FREE_PLAY':
      return 'Free Play';

    default:
      return tier.prize_amount != null ? `${tier.prize_currency || 'CAD'} ${tier.prize_amount}` : 'Varies';
  }
}

export async function computePrize(
  gameCode: string,
  jurisdictionCode: string,
  draw: DrawWithPrize,
  ticketNumbers: number[],
  ticketSpecial?: number[],
  addOnsSelected?: Record<string, boolean>
): Promise<PrizeEngineOutput> {
  const { matchMain, matchSpecial } = computeMatch(
    ticketNumbers,
    ticketSpecial,
    draw.winning_numbers,
    draw.special_numbers
  );

  const { ruleSet, tiers: dbTiers, addOns, usedNationalFallback } = await loadRuleSetWithFallback(
    gameCode,
    jurisdictionCode,
    draw.draw_date
  );

  const tiers = dbTiers.length > 0 ? dbTiers : (BUNDLED_TIERS[gameCode] ?? []);
  const usedBundledFallback = dbTiers.length === 0 && (BUNDLED_TIERS[gameCode]?.length ?? 0) > 0;

  const disclaimers: string[] = [DISCLAIMER_ESTIMATE];
  if (usedNationalFallback && ruleSet) {
    disclaimers.push('Local prize rules unavailable. Showing national estimate.');
  }
  if (usedBundledFallback) {
    disclaimers.push('Using bundled prize rules. Verify with official source.');
  }

  const matchedTiers: MatchedTier[] = [];
  let estimatedPrizeText = 'No prize';

  const tier = findMatchingTier(tiers, matchMain, matchSpecial);
  if (tier) {
    const multiplierValue = draw.multiplier_value ?? undefined;
    const text = formatPrizeText(tier, draw, addOnsSelected, multiplierValue);
    matchedTiers.push({
      tier,
      estimatedPrizeText: text,
      isMultiplierApplied: tier.multiplier_applicable && multiplierValue != null,
    });
    estimatedPrizeText = text;
  }

  return {
    matchedTiers,
    estimatedPrizeText,
    claimUrl: ruleSet?.claim_url ?? null,
    officialRulesUrl: ruleSet?.official_rules_url ?? null,
    disclaimers,
    usedNationalFallback: usedNationalFallback || undefined,
  };
}
