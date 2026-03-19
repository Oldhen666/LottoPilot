import type { Fetcher, ParsedDraw } from './types';
import { getExpectedDrawDates } from './base';

export const fetcherMegaMillions: Fetcher = {
  code: 'US_MEGAMILLIONS',
  getExpectedDrawDates(now: Date) {
    return getExpectedDrawDates('US_MEGAMILLIONS', now);
  },
  async fetch(drawDate: string) {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(process.cwd(), 'mocks', 'us-megamillions.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { ...data, drawDate };
    }
    return {
      drawDate,
      numbers: {
        white: [7, 14, 21, 28, 35],
        mega_ball: 12,
        megaplier_multiplier: 4,
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
        mega_ball: (nums?.mega_ball as number) ?? 0,
        megaplier_multiplier: nums?.megaplier_multiplier as number | undefined,
      },
      status: 'ok',
    };
  },
  validate(parsed: ParsedDraw) {
    const n = parsed.numbers as { white?: number[]; mega_ball?: number };
    if (!n.white || n.white.length !== 5) throw new Error('US_MEGAMILLIONS: need 5 white');
    for (const x of n.white) {
      if (x < 1 || x > 70) throw new Error(`US_MEGAMILLIONS: white out of range: ${x}`);
    }
    if (n.mega_ball != null && (n.mega_ball < 1 || n.mega_ball > 25)) {
      throw new Error(`US_MEGAMILLIONS: mega_ball out of range: ${n.mega_ball}`);
    }
  },
};
