/** Jurisdiction & Prize Rules Types */

export type CountryCode = 'CA' | 'US';

export interface Jurisdiction {
  id: string;
  country: CountryCode;
  code: string;
  name: string;
  currency: 'CAD' | 'USD';
  timezone?: string;
}

export type JurisdictionSource = 'gps' | 'manual';

export interface CurrentJurisdiction {
  country: CountryCode;
  regionCode: string;
  regionName?: string;
  currency: 'CAD' | 'USD';
  source: JurisdictionSource;
  updated_at: string;
}

export type PrizeType = 'FIXED' | 'PARI_MUTUEL' | 'MULTIPLIER' | 'FREE_PLAY' | 'OTHER';

export interface PrizeTier {
  id: string;
  rule_set_id: string;
  tier_name: string;
  match_main: number;
  match_special: number | null;
  match_bonus: number | null;
  prize_type: PrizeType;
  prize_amount: number | null;
  prize_currency: 'CAD' | 'USD';
  multiplier_applicable: boolean;
  min_prize: number | null;
  max_prize: number | null;
  sort_order: number;
}

export interface PrizeRuleSet {
  id: string;
  game_code: string;
  jurisdiction_code: string;
  version: string;
  effective_from: string;
  effective_to: string | null;
  official_rules_url: string | null;
  claim_url: string | null;
  is_active: boolean;
}

export interface AddOnRule {
  id: string;
  rule_set_id: string;
  add_on_code: string;
  add_on_type: 'INDEPENDENT_DRAW' | 'MULTIPLIER' | 'OTHER';
  config_json: Record<string, unknown> | null;
}

export interface DrawWithPrize {
  id: string;
  lottery_id: string;
  draw_date: string;
  winning_numbers: number[];
  special_numbers?: number[];
  jackpot_cents?: number | null;
  jackpot_amount?: number | null;
  multiplier_value?: number | null;
  bonus_numbers?: number[] | null;
}

export interface TicketInput {
  gameCode: string;
  jurisdictionCode: string;
  draw: DrawWithPrize;
  ticketNumbers: number[];
  ticketSpecial?: number[];
  addOnsSelected?: Record<string, boolean>;
}

export interface MatchedTier {
  tier: PrizeTier;
  estimatedPrizeText: string;
  isMultiplierApplied?: boolean;
}

export interface PrizeEngineOutput {
  matchedTiers: MatchedTier[];
  estimatedPrizeText: string;
  claimUrl: string | null;
  officialRulesUrl: string | null;
  disclaimers: string[];
  usedNationalFallback?: boolean;
}
