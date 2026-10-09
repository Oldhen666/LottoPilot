import { validRangeForSlot } from './positionPickTier';

describe('validRangeForSlot', () => {
  it('first slot uses full lower bound and leaves room for remaining picks', () => {
    const { lo, hi } = validRangeForSlot(0, [], 7, 1, 50);
    expect(lo).toBe(1);
    expect(hi).toBe(50 - 6);
  });

  it('after picking 5, second slot starts at 6 and respects upper room', () => {
    const { lo, hi } = validRangeForSlot(1, [5], 7, 1, 50);
    expect(lo).toBe(6);
    expect(hi).toBe(50 - 5);
  });
});
