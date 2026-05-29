import type { Product } from 'react-native-iap';

type PricingPhase = {
  formattedPrice?: string;
  priceAmountMicros?: number;
  billingPeriod?: string;
  billingCycleCount?: number;
};

function parseSubscriptionOfferDetails(product: Product | null): PricingPhase[] {
  if (!product) return [];
  const p = product as {
    subscriptionOfferDetails?: Array<{
      pricingPhases?: { pricingPhaseList?: PricingPhase[] };
    }> | string;
    subscriptionOfferDetailsAndroid?: string;
  };
  const phases: PricingPhase[] = [];

  const pushPhases = (list?: PricingPhase[]) => {
    if (Array.isArray(list)) phases.push(...list);
  };

  if (Array.isArray(p.subscriptionOfferDetails)) {
    for (const offer of p.subscriptionOfferDetails) {
      pushPhases(offer.pricingPhases?.pricingPhaseList);
    }
  }
  for (const key of ['subscriptionOfferDetailsAndroid', 'subscriptionOfferDetails'] as const) {
    const raw = p[key];
    if (typeof raw !== 'string') continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const arr = Array.isArray(parsed) ? parsed : (parsed as { subscriptionOfferDetails?: unknown[] })?.subscriptionOfferDetails;
      if (Array.isArray(arr)) {
        for (const offer of arr) {
          const o = offer as { pricingPhases?: { pricingPhaseList?: PricingPhase[] } };
          pushPhases(o.pricingPhases?.pricingPhaseList);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return phases;
}

function withMonthlySuffix(price: string): string {
  const t = price.trim();
  if (!t) return '$0.99/month';
  if (/\/|month|mo\b/i.test(t)) return t;
  return `${t}/month`;
}

/** Recurring price after free trial (last pricing phase, or highest non-zero phase). */
export function formatAstronautRenewalPrice(product: Product | null): string {
  const phases = parseSubscriptionOfferDetails(product);
  if (phases.length > 0) {
    const paid =
      [...phases].reverse().find((ph) => {
        const micros = ph.priceAmountMicros ?? 0;
        const label = (ph.formattedPrice ?? '').trim();
        if (micros > 0) return true;
        return label.length > 0 && !/^free$/i.test(label) && !/^[$€£]?\s*0([.,]00)?/i.test(label);
      }) ?? phases[phases.length - 1];
    if (paid?.formattedPrice) return withMonthlySuffix(paid.formattedPrice);
  }
  const p = product as { localizedPrice?: string; price?: string } | null;
  const fallback = p?.localizedPrice ?? p?.price;
  if (fallback) return withMonthlySuffix(fallback);
  return '$0.99/month';
}

/** @deprecated Prefer formatAstronautRenewalPrice — kept for call sites that expect /mo display */
export function formatAstronautPrice(product: Product | null): string {
  return formatAstronautRenewalPrice(product);
}

export function formatPiratePrice(product: Product | null, country?: 'CA' | 'US' | null): string {
  if (product) {
    const p = product as { localizedPrice?: string; price?: string };
    const localized = p.localizedPrice ?? p.price;
    if (localized) return localized;
  }
  if (country === 'CA') return 'CA$3.99';
  if (country === 'US') return 'US$3.49';
  return 'US$3.49';
}

export function astronautProductHasTrialOffer(product: Product | null): boolean {
  const phases = parseSubscriptionOfferDetails(product);
  if (phases.length < 2) return phases.some((ph) => (ph.priceAmountMicros ?? 0) === 0);
  const first = phases[0];
  const micros = first?.priceAmountMicros ?? 0;
  const label = (first?.formattedPrice ?? '').toLowerCase();
  return micros === 0 || label.includes('free') || /^[$€£]?\s*0/.test(label);
}
