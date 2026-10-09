import {
  PLAY_REVIEW_COOLDOWN_MS,
  PLAY_REVIEW_INSTALLED_MS,
  shouldRequestPlayReview,
  type PlayReviewSnapshot,
} from './playReviewPolicy';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 3);

function snapshot(overrides: Partial<PlayReviewSnapshot> = {}): PlayReviewSnapshot {
  return {
    now,
    installedAt: now - PLAY_REVIEW_INSTALLED_MS - DAY,
    openCount: 6,
    scanCount: 10,
    lastRequestedAt: null,
    ...overrides,
  };
}

describe('shouldRequestPlayReview', () => {
  it('requests when installed more than 7 days, opened more than 5 times, and 10 scans are done', () => {
    expect(shouldRequestPlayReview(snapshot())).toBe(true);
  });

  it('waits until the install is older than 7 days', () => {
    expect(shouldRequestPlayReview(snapshot({ installedAt: now - PLAY_REVIEW_INSTALLED_MS }))).toBe(false);
    expect(shouldRequestPlayReview(snapshot({ installedAt: now - 6 * DAY }))).toBe(false);
  });

  it('waits until the app has been opened more than 5 times', () => {
    expect(shouldRequestPlayReview(snapshot({ openCount: 5 }))).toBe(false);
    expect(shouldRequestPlayReview(snapshot({ openCount: 6 }))).toBe(true);
  });

  it('waits until 10 scans are complete', () => {
    expect(shouldRequestPlayReview(snapshot({ scanCount: 9 }))).toBe(false);
    expect(shouldRequestPlayReview(snapshot({ scanCount: 10 }))).toBe(true);
  });

  it('does not request again within 90 days of the last request', () => {
    expect(shouldRequestPlayReview(snapshot({ lastRequestedAt: now - PLAY_REVIEW_COOLDOWN_MS + 1 }))).toBe(false);
    expect(shouldRequestPlayReview(snapshot({ lastRequestedAt: now - 89 * DAY }))).toBe(false);
    expect(shouldRequestPlayReview(snapshot({ lastRequestedAt: now - PLAY_REVIEW_COOLDOWN_MS }))).toBe(true);
  });
});
