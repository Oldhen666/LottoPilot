/**
 * Fetch add-on catalog from Supabase (game + jurisdiction)
 * Uses direct REST to avoid Supabase client blocking.
 */
import { fetchAddOnCatalogDirect } from './supabase';
import type { AddOnCatalogItem } from '../types/addOn';

export async function fetchAddOnCatalog(
  gameCode: string,
  jurisdictionCode: string
): Promise<AddOnCatalogItem[]> {
  return fetchAddOnCatalogDirect(gameCode, jurisdictionCode);
}

/** Add-ons that need user input (checkbox or number input) in CheckTicketScreen */
export function isUserSelectableAddOn(item: AddOnCatalogItem): boolean {
  if (item.add_on_type === 'BUILT_IN_COMPONENT') {
    return false; // MAXMILLIONS uses main numbers, not separate input
  }
  return ['EXTRA', 'ENCORE', 'TAG', 'POWER_PLAY', 'DOUBLE_PLAY'].includes(item.add_on_code);
}
