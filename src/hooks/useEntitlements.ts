import { useState, useEffect } from 'react';
import { getEntitlements, type UserPlan } from '../services/entitlements';
import { onPurchaseSuccess } from '../services/iap';
import { onAuthStateChange } from '../services/supabase';

/** Load entitlements (plan) and refresh on purchase or auth change. */
export function useEntitlements(): { plan: UserPlan } {
  const [plan, setPlan] = useState<UserPlan>('free');

  useEffect(() => {
    const load = async () => {
      const e = await getEntitlements();
      setPlan(e.plan);
    };
    load();
  }, []);

  useEffect(() => {
    const unsub = onPurchaseSuccess(() => {
      getEntitlements().then((e) => setPlan(e.plan));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChange(() => {
      getEntitlements().then((e) => setPlan(e.plan));
    });
    return unsub;
  }, []);

  return { plan };
}
