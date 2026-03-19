/** Add-on game types */

export type AddOnCode =
  | 'EXTRA'
  | 'ENCORE'
  | 'TAG'
  | 'POWER_PLAY'
  | 'DOUBLE_PLAY'
  | 'MAXMILLIONS'
  | 'GOLD_BALL'
  | 'MEGA_MULTIPLIER';

export type AddOnType =
  | 'INDEPENDENT_NUMBER'
  | 'INDEPENDENT_DRAW'
  | 'MULTIPLIER'
  | 'BUILT_IN_COMPONENT';

export interface AddOnInputSchema {
  digits?: number;
  userInput?: boolean;
  multipleGroups?: boolean;
  userCheckbox?: boolean;
  tagDrawDateOptional?: boolean;
}

export interface AddOnCatalogItem {
  id: string;
  game_code: string;
  jurisdiction_code: string;
  add_on_code: AddOnCode;
  add_on_type: AddOnType;
  input_schema_json: AddOnInputSchema | null;
  rules_schema_json: Record<string, unknown> | null;
  official_rules_url: string | null;
  claim_url: string | null;
  is_enabled: boolean;
}

export interface AddOnsSelected {
  EXTRA?: boolean;
  ENCORE?: boolean;
  TAG?: boolean;
  POWER_PLAY?: boolean;
  DOUBLE_PLAY?: boolean;
  MEGA_MULTIPLIER?: boolean;
}

export interface AddOnsInputs {
  EXTRA?: string;
  ENCORE?: string;
  TAG?: string;
  TAG_DRAW_DATE?: string;
  MAXMILLIONS?: string[];
}

export interface AddOnResultExtra {
  user: string;
  winning: string;
  matchedDigits: number;
  prizeText: string;
}

export interface AddOnResultDoublePlay {
  match_main: number;
  match_special: number;
  tier: string;
  prizeText: string;
}

export interface AddOnResultPowerPlay {
  multiplier: number;
  applied: boolean;
}

export interface AddOnResultMaxmillions {
  userList: string[];
  winningList: string[];
  hits: number[];
}

export interface AddOnResultGoldBall {
  userGold: string;
  winningGold: string;
  hit: boolean;
}

export interface AddOnResults {
  EXTRA?: AddOnResultExtra;
  ENCORE?: AddOnResultExtra;
  TAG?: { user: string; winning: string; matchedDigits: number; prizeText: string };
  DOUBLE_PLAY?: AddOnResultDoublePlay;
  POWER_PLAY?: AddOnResultPowerPlay;
  MAXMILLIONS?: AddOnResultMaxmillions;
  GOLD_BALL?: AddOnResultGoldBall;
  MEGA_MULTIPLIER?: { multiplier: number; applied: boolean };
}

export interface MainResult {
  match_main: number;
  match_special: number;
  tier?: string;
  prizeText: string;
}
