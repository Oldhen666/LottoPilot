import type { LotteryId } from '../../types/lottery';

export type NormRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Normalized (0–1) regions: main play grid vs special ball column.
 * Heuristic layout — not detection — to apply slightly stronger local contrast where digits usually sit.
 */
export function getRegionRects(lotteryId: LotteryId): { main: NormRect; special: NormRect } {
  switch (lotteryId) {
    case 'powerball':
    case 'mega_millions':
      return {
        main: { x0: 0.02, y0: 0.1, x1: 0.78, y1: 0.95 },
        special: { x0: 0.76, y0: 0.12, x1: 0.99, y1: 0.95 },
      };
    case 'lotto_max':
    case 'lotto_649':
      return {
        main: { x0: 0.02, y0: 0.12, x1: 0.92, y1: 0.95 },
        special: { x0: 0.88, y0: 0.15, x1: 0.99, y1: 0.92 },
      };
    default:
      return {
        main: { x0: 0.02, y0: 0.1, x1: 0.96, y1: 0.95 },
        special: { x0: 0.82, y0: 0.15, x1: 0.99, y1: 0.95 },
      };
  }
}
