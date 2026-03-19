import type { Fetcher, ParsedDraw } from './types';
import { getExpectedDrawDates } from './base';

export const fetcherLottoMax: Fetcher = {
  code: 'CA_LOTTOMAX',
  getExpectedDrawDates(now: Date) {
    return getExpectedDrawDates('CA_LOTTOMAX', now);
  },
  async fetch(drawDate: string) {
    const fs = require('fs');
    const path = require('path');
    const p = path.join(process.cwd(), 'mocks', 'ca-lottomax.json');
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return { ...data, drawDate };
    }
    return {
      drawDate,
      numbers: { main: [5, 11, 22, 33, 41, 44, 49], bonus: 17, extra: '7654321' },
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
        bonus: typeof nums?.bonus === 'number' ? nums.bonus : undefined,
        extra: nums?.extra as string | undefined,
      },
      status: 'ok',
    };
  },
  validate(parsed: ParsedDraw) {
    const n = parsed.numbers as { main?: number[] };
    if (!n.main || n.main.length !== 7) throw new Error('CA_LOTTOMAX: need 7 main numbers');
    for (const x of n.main) {
      if (x < 1 || x > 49) throw new Error(`CA_LOTTOMAX: main out of range: ${x}`);
    }
  },
};
