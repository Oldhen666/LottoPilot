/** Google Play in-app review gates. Times are epoch milliseconds. */

export const PLAY_REVIEW_INSTALLED_MS = 7 * 24 * 60 * 60 * 1000;
export const PLAY_REVIEW_MIN_OPENS = 5;
export const PLAY_REVIEW_MIN_SCANS = 10;
export const PLAY_REVIEW_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

export type PlayReviewSnapshot = {
  now: number;
  installedAt: number | null;
  openCount: number;
  scanCount: number;
  lastRequestedAt: number | null;
};

/** True when we should call the Play in-app review API. */
export function shouldRequestPlayReview(snapshot: PlayReviewSnapshot): boolean {
  const { now, installedAt, openCount, scanCount, lastRequestedAt } = snapshot;
  if (installedAt == null || !Number.isFinite(installedAt)) return false;
  if (now - installedAt <= PLAY_REVIEW_INSTALLED_MS) return false;
  if (openCount <= PLAY_REVIEW_MIN_OPENS) return false;
  if (scanCount < PLAY_REVIEW_MIN_SCANS) return false;
  if (lastRequestedAt != null && now - lastRequestedAt < PLAY_REVIEW_COOLDOWN_MS) return false;
  return true;
}
