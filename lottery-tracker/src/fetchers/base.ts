import type { Fetcher } from './types';

const DRAW_DAYS: Record<string, number[]> = {
  CA_649: [3, 6],      // Wed=3, Sat=6
  CA_LOTTOMAX: [2, 5], // Tue=2, Fri=5
  US_POWERBALL: [1, 3, 6],
  US_MEGAMILLIONS: [2, 5],
};

export function getExpectedDrawDates(code: string, now: Date): string[] {
  const days = DRAW_DAYS[code];
  if (!days) return [];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const wd = yesterday.getDay();
  if (days.includes(wd)) {
    return [yesterday.toISOString().slice(0, 10)];
  }
  return [];
}

export function createMockFetcher(
  code: string,
  drawDays: number[],
  mockPath: string
): Fetcher {
  const fs = require('fs');
  const path = require('path');

  return {
    code,
    getExpectedDrawDates(now: Date) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return drawDays.includes(yesterday.getDay())
        ? [yesterday.toISOString().slice(0, 10)]
        : [];
    },
    async fetch(drawDate: string) {
      const fullPath = path.join(process.cwd(), 'mocks', mockPath);
      if (fs.existsSync(fullPath)) {
        return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
      }
      return { drawDate, mock: true };
    },
    parse(raw: unknown) {
      const r = raw as Record<string, unknown>;
      return {
        drawDate: (r.drawDate as string) || '',
        drawId: r.drawId as string | undefined,
        numbers: (r.numbers as any) || {},
        status: 'ok',
      };
    },
    validate() {},
  };
}
