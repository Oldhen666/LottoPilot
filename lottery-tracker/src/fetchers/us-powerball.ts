import type { Fetcher, ParsedDraw } from './types';
import { getExpectedDrawDates } from './base';

export const fetcherPowerball: Fetcher = {
  code: 'US_POWERBALL',
  getExpectedDrawDates(now: Date) {
    return getExpectedDrawDates('US_POWERBALL', now);
  },
  async fetch(drawDate: string) {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(process.cwd(), 'mocks', 'us-powerball.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { ...data, drawDate };
    }
    return {
      drawDate,
      numbers: {
        white: [12, 23, 34, 45, 56],
        powerball: 8,
        power_play_multiplier: 3,
      },
      mock: true,
    };
  },
  parse(raw: unknown): ParsedDraw {
    const r = raw as Record<string, unknown>;
    const nums = r.numbers as Record<string, unknown> | undefined;
    return {
      drawDate: (r.drawDate as string) || '',
      drawId: r.drawId as string | undefined,
      numbers: {
        white: (nums?.white as number[]) || [],
        powerball: (nums?.powerball as number) ?? 0,
        power_play_multiplier: nums?.power_play_multiplier as number | undefined,
      },
      status: 'ok',
    };
  },
  validate(parsed: ParsedDraw) {
    const n = parsed.numbers as { white?: number[]; powerball?: number };
    if (!n.white || n.white.length !== 5) throw new Error('US_POWERBALL: need 5 white');
    for (const x of n.white) {
      if (x < 1 || x > 69) throw new Error(`US_POWERBALL: white out of range: ${x}`);
    }
    if (n.powerball != null && (n.powerball < 1 || n.powerball > 26)) {
      throw new Error(`US_POWERBALL: powerball out of range: ${n.powerball}`);
    }
  },
};
