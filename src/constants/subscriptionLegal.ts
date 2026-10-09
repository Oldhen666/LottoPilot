/**
 * Google Play Subscriptions policy — billing disclosures (shown before purchase).
 * Keep in sync with Play Console base plan / free-trial offer copy.
 */

export const GOOGLE_PLAY_CANCEL_SUBSCRIPTIONS_PATH =
  'Google Play → Payments & subscriptions → Subscriptions → LottoPilot';

export const ASTRONAUT_TRIAL_MONTHS = 1;

/** Astronaut plan marketing bullets (no Compass / ad-free claims). */
export const ASTRONAUT_FEATURE_BULLETS = [
  'Unlimited Strategy Lab (Generate & Refine)',
  'Auto Pilot and advanced tuning features',
  'Ad-free Strategy Lab experience',
  'Ongoing model and feature updates',
] as const;

export function astronautTrialDisclosureLines(renewalPricePerMonth: string): string[] {
  const price = renewalPricePerMonth.trim() || '$0.99/month';
  return [
    `${ASTRONAUT_TRIAL_MONTHS}-month free trial for eligible new subscribers, then ${price} (price may vary by region).`,
    'Subscription renews automatically each month until you cancel.',
    `Cancel before the trial ends in ${GOOGLE_PLAY_CANCEL_SUBSCRIPTIONS_PATH} to avoid charges.`,
    'If you already subscribed on this Google account, you may not see a free trial (charged at the regular price).',
  ];
}

export function astronautPaidOnlyDisclosureLines(renewalPricePerMonth: string): string[] {
  const price = renewalPricePerMonth.trim() || '$0.99/month';
  return [
    `${price} billed monthly. Subscription renews automatically until you cancel.`,
    `Manage or cancel anytime in ${GOOGLE_PLAY_CANCEL_SUBSCRIPTIONS_PATH}.`,
  ];
}

export function pirateOneTimeDisclosureLines(localizedPrice: string): string[] {
  const price = localizedPrice.trim() || '$3.49';
  return [
    `One-time purchase: ${price} (localized in Google Play; typically about CA$3.99 in Canada or US$3.49 in the United States).`,
    'Unlocks unlimited Compass pick generation with no ads in Compass.',
    'Does not include Astronaut (Strategy Lab) subscription.',
    'Non-refundable except as required by law or Google Play policy.',
  ];
}
