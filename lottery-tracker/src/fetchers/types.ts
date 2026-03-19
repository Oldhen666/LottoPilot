/** Unified numbers structure for lottery_draws.numbers_json */
export type NumbersJson =
  | { main: number[]; bonus?: number; encore?: string; extra?: string }
  | { white: number[]; powerball: number; power_play_multiplier?: number }
  | { white: number[]; mega_ball: number; megaplier_multiplier?: number };

export interface ParsedDraw {
  drawDate: string; // YYYY-MM-DD
  drawId?: string;
  numbers: NumbersJson;
  status: 'ok' | 'partial';
}

export interface Fetcher {
  code: string;
  getExpectedDrawDates(now: Date): string[];
  fetch(drawDate: string): Promise<unknown>;
  parse(raw: unknown): ParsedDraw;
  validate(parsed: ParsedDraw): void;
}
