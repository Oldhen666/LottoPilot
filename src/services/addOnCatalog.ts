/**
 * Fetch add-on catalog from Supabase (game + jurisdiction)
 * Uses shared client to avoid multiple GoTrueClient instances.
 */
import { getSupabaseClient } from './supabase';
import type { AddOnCatalogItem } from '../types/addOn';

export async function fetchAddOnCatalog(
  gameCode: string,
  jurisdictionCode: string
): Promise<AddOnCatalogItem[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const jCode = jurisdictionCode || 'CA-ON';
  const country = jCode.split('-')[0];
  const nationalCode = `${country}-NATIONAL`;

  const { data: exactData } = await supabase
    .from('add_on_catalog')
    .select('*')
    .eq('game_code', gameCode)
    .eq('jurisdiction_code', jCode)
    .eq('is_enabled', true);

  const { data: nationalData } = await supabase
    .from('add_on_catalog')
    .select('*')
    .eq('game_code', gameCode)
    .eq('jurisdiction_code', nationalCode)
    .eq('is_enabled', true);

  const byCode = new Map<string, AddOnCatalogItem>();
  for (const i of (exactData || []) as AddOnCatalogItem[]) {
    byCode.set(i.add_on_code, i);
  }
  for (const i of (nationalData || []) as AddOnCatalogItem[]) {
    if (!byCode.has(i.add_on_code)) byCode.set(i.add_on_code, i);
  }
  return Array.from(byCode.values());
}

/** Add-ons that need user input (checkbox or number input) in CheckTicketScreen */
export function isUserSelectableAddOn(item: AddOnCatalogItem): boolean {
  if (item.add_on_type === 'BUILT_IN_COMPONENT') {
    return false; // MAXMILLIONS uses main numbers, not separate input
  }
  return ['EXTRA', 'ENCORE', 'TAG', 'POWER_PLAY', 'DOUBLE_PLAY'].includes(item.add_on_code);
}
