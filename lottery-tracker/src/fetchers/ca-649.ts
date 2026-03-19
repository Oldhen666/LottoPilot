import type { Fetcher, ParsedDraw } from './types';
import { getExpectedDrawDates } from './base';

const DRAW_DAYS = [3, 6]; // Wed, Sat

export const fetcher649: Fetcher = {
  code: 'CA_649',
  getExpectedDrawDates(now: Date) {
    return getExpectedDrawDates('CA_649', now);
  },
  async fetch(drawDate: string) {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(process.cwd(), 'mocks', 'ca-649.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { ...data, drawDate };
    }
    return {
      drawDate,
      numbers: { main: [3, 12, 18, 25, 31, 42], bonus: 7, encore: '1234567' },
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
        main: (nums?.main as number[]) || [],
        bonus: nums?.bonus as number | undefined,
        encore: nums?.encore as string | undefined,
      },
      status: 'ok',
    };
  },
  validate(parsed: ParsedDraw) {
    const n = parsed.numbers as { main?: number[]; bonus?: number };
    if (!n.main || n.main.length !== 6) throw new Error('CA_649: need 6 main numbers');
    for (const x of n.main) {
      if (x < 1 || x > 49) throw new Error(`CA_649: main out of range: ${x}`);
    }
    if (n.bonus != null && (n.bonus < 1 || n.bonus > 49)) {
      throw new Error(`CA_649: bonus out of range: ${n.bonus}`);
    }
  },
};
